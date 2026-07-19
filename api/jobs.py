"""Background job queue for pipeline execution."""

import threading
import queue
import uuid
import traceback
import subprocess
import os
from pathlib import Path
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field

from api import storage, firestore_client, object_store, stem_client


def _pipeline_timeout():
    raw = os.environ.get("PIPELINE_TIMEOUT_SECONDS", "").strip()
    return int(raw) if raw else None


def _stem_dir(artifact_base: str, audio_path: str, model: str = "htdemucs") -> str:
    basename = os.path.splitext(os.path.basename(audio_path))[0]
    return os.path.join(artifact_base, model, basename)


def _offload_stems(job: "Job", audio_path: str, artifact_base: str, params: dict) -> None:
    """Pre-seed the local stem cache from the remote GPU worker (Plan 008).

    No-op unless both stem_client and object_store are enabled. On failure,
    cleans up the GCS handoff prefix and either swallows the error (falling
    back to local separation inside driver.py) or re-raises, depending on
    STEM_FALLBACK.
    """
    model = params.get("demucs_model", "htdemucs")
    if not (stem_client.enabled() and object_store.enabled()):
        return
    _log(job.id, "[1b/4 Offload] Requesting remote stem separation")
    _update_job(job.id, step="Separating stems (GPU)")
    stem_dir = _stem_dir(artifact_base, audio_path, model)
    os.makedirs(stem_dir, exist_ok=True)
    ext = os.path.splitext(audio_path)[1] or ".mp3"
    in_key = f"handoff/{job.id}/input{ext}"
    voc_key = f"handoff/{job.id}/vocals.mp3"
    acc_key = f"handoff/{job.id}/accompaniment.mp3"
    try:
        object_store.upload_file(audio_path, in_key)
        stem_client.separate(
            input_url=object_store.signed_get_url(in_key),
            vocals_put_url=object_store.signed_put_url(voc_key, content_type="audio/mpeg"),
            accompaniment_put_url=object_store.signed_put_url(acc_key, content_type="audio/mpeg"),
            model=model,
        )
        object_store.download_file(voc_key, os.path.join(stem_dir, "vocals.mp3"))
        object_store.download_file(acc_key, os.path.join(stem_dir, "accompaniment.mp3"))
        _log(job.id, f"[1b/4 Offload] Stems cached at {stem_dir}")
    except Exception as e:
        if os.environ.get("STEM_FALLBACK", "local") == "fail":
            raise RuntimeError(f"Remote stem separation failed: {e}")
        _log(job.id, f"[1b/4 Offload] FAILED ({e}); falling back to local separation")
    finally:
        object_store.delete_prefix(f"handoff/{job.id}/")


def _deliver_youtube_audio(job: "Job", audio_path: str, artifact_base: str, params: dict,
                            audio_hash: str) -> None:
    """Upload audio-bearing files to the REQUESTING USER's private delivery
    prefix (delivery/{hash}/{user_id}/...) and remove them from local disk.

    URLs are minted per-request in the results endpoint for the matching user
    only (see results._resolve_audio_delivery), so one user's audio is never
    exposed to another -- critical for public songs, where anyone can read the
    analysis but only the person who supplied the source may get the audio.
    No audio persists server-side outside this per-user buffer (legal posture,
    decided 2026-07-13).
    """
    stem_dir = _stem_dir(artifact_base, audio_path, params.get("demucs_model", "htdemucs"))
    to_deliver = {
        "original": audio_path,
        "vocals": os.path.join(stem_dir, "vocals.mp3"),
        "accompaniment": os.path.join(stem_dir, "accompaniment.mp3"),
    }
    delivered = []
    for label, path in to_deliver.items():
        try:
            if object_store.enabled() and os.path.exists(path):
                key = f"delivery/{audio_hash}/{job.user_id}/{label}.mp3"
                object_store.upload_file(path, key, content_type="audio/mpeg")
                delivered.append(label)
        except Exception as e:
            # Delivery is best-effort; the user can regenerate audio on demand
            # (Plan 011). A failed upload must NOT fail the analysis job.
            _log(job.id, f"[4/4 Finalize] WARN: delivery upload failed for {label}: {e}")
        finally:
            # ALWAYS remove the local stem, even if the upload raised, so no
            # YouTube-derived audio persists server-side. (audio_path is the temp
            # download, purged separately by cleanup_tmp / _purge_youtube_local.)
            if path != audio_path and os.path.exists(path):
                os.remove(path)
    _log(job.id, f"[4/4 Finalize] Delivered {delivered} to user {job.user_id[:8]}'s buffer")


def _purge_youtube_local(job: "Job", audio_path: str, artifact_base: str, params: dict) -> None:
    """Guarantee no YouTube-derived audio remains on the server, on ANY exit
    path -- success, early return, or mid-pipeline failure. Idempotent; called
    from the worker's finally so a failed job cannot leave seeded stems behind.
    """
    stem_dir = _stem_dir(artifact_base, audio_path, params.get("demucs_model", "htdemucs"))
    for name in ("vocals.mp3", "accompaniment.mp3", "original.mp3"):
        p = os.path.join(stem_dir, name)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass
    storage.cleanup_tmp(job.id)


@dataclass
class Job:
    id: str
    song_id: str
    analysis_id: str
    user_id: str
    params: dict
    status: str = "queued"
    progress: float = 0.0
    step: str = ""
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    # Set during _run_pipeline so the worker's finally can purge YouTube audio
    # even if the pipeline raises before reaching the finalize/delivery step.
    source: Optional[str] = None
    audio_path: Optional[str] = None
    artifact_base: Optional[str] = None


_job_queue: queue.Queue = queue.Queue()
_jobs: dict[str, Job] = {}
_lock = threading.Lock()
_worker_started = False


def _update_job(job_id: str, **fields) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            for k, v in fields.items():
                setattr(job, k, v)
            # Sync step to Firestore so the library UI can show it
            if "step" in fields:
                try:
                    firestore_client.update_song(job.song_id, processingStep=fields["step"])
                except Exception:
                    pass


def _log(job_id: str, msg: str) -> None:
    print(f"[JOB {job_id[:8]}] {msg}")


def _run_pipeline(job: Job) -> None:
    _log(job.id, f"Starting pipeline for song={job.song_id[:8]}, analysis={job.analysis_id[:8]}")

    song = firestore_client.get_song(job.song_id)
    if not song:
        raise ValueError(f"Song {job.song_id} not found")

    title = song.get("title", "untitled")
    audio_hash = song.get("audioHash", "")
    source = song.get("source", "file")
    _log(job.id, f"Song: \"{title}\" | source={source} | hash={audio_hash}")

    # Fetch analysis params early (needed for YouTube trimming)
    analysis = firestore_client.get_analysis(job.song_id, job.analysis_id)
    params = analysis.get("params", {}) if analysis else {}

    # Determine audio file path
    if source == "youtube":
        video_id = song.get("youtubeVideoId")
        if not video_id:
            raise ValueError("No YouTube video ID")
        tmp = storage.ensure_dir(storage.tmp_dir(job.id))
        yt_url = f"https://youtube.com/watch?v={video_id}"
        start_time = params.get("start_time")
        end_time = params.get("end_time")
        _log(job.id, f"[1/4 YouTube Download] Downloading video {video_id} (start={start_time}, end={end_time})...")
        _update_job(job.id, status="running", progress=0.05, step="Downloading audio")
        from raga_pipeline.audio import download_youtube_audio
        try:
            audio_path = download_youtube_audio(
                yt_url=yt_url,
                audio_dir=str(tmp),
                filename_base="audio",
                start_time=start_time,
                end_time=end_time,
            )
        except Exception as e:
            _log(job.id, f"[1/4 YouTube Download] FAILED: {e}")
            raise RuntimeError(f"YouTube download failed: {e}")
        _log(job.id, f"[1/4 YouTube Download] Complete -> {audio_path}")
    else:
        upload_base = storage.upload_dir(job.user_id, job.song_id)
        files = []
        for ext in ["*.mp3", "*.wav", "*.flac", "*.m4a", "*.webm", "*.ogg", "*.mp4"]:
            files.extend(storage.list_files(upload_base, ext))
        if not files:
            raise ValueError("No audio file found for this song")
        audio_path = str(storage.get_absolute_path(files[0]))
        _log(job.id, f"[1/4 Audio Source] Using uploaded file: {audio_path}")

    _log(job.id, f"Analysis params: tonic={params.get('tonic', 'auto')}, raga={params.get('raga', 'auto')}, instrument={params.get('instrument', 'vocal')}")

    artifact_base = str(storage.ensure_dir(storage.artifact_dir(audio_hash)))
    _log(job.id, f"Artifact output dir: {artifact_base}")

    # Record for the worker's finally-purge (guarantees no YouTube audio lingers
    # server-side even if the pipeline raises below).
    job.source = source
    job.audio_path = audio_path
    job.artifact_base = artifact_base

    # Offload stem separation to the remote GPU worker (Plan 008), if enabled.
    _offload_stems(job, audio_path, artifact_base, params)

    if params.get("mode") == "audio_only":
        # Separation-only regeneration (Plan 011): a viewer of an already-
        # analyzed song wants audio on their device. Detect/analyze already
        # ran (and are cached in the canonical analysis); do not re-run them.
        _log(job.id, "[audio_only] Delivering audio to requesting user (no re-analysis)")
        _update_job(job.id, progress=0.5, step="Separating stems")
        if source == "youtube":
            _deliver_youtube_audio(job, audio_path, artifact_base, params, audio_hash)
            storage.cleanup_tmp(job.id)
        _update_job(job.id, progress=1.0, step="Finalizing")
        _log(job.id, f"[audio_only] Complete for \"{title}\"")
        return

    env = os.environ.copy()

    # Build detect command
    raga_db = str(Path(__file__).parent.parent / "data" / "raga_list_final.csv")
    cmd = ["python", "driver.py", "detect", "--audio", audio_path, "--output", artifact_base, "--raga-db", raga_db]
    if params.get("tonic"):
        cmd += ["--tonic", params["tonic"]]
    if params.get("raga"):
        cmd += ["--raga", params["raga"]]
    instrument = params.get("instrument", "vocal")
    if instrument and instrument != "vocal":
        cmd += ["--source-type", "instrumental", "--instrument-type", instrument]
    elif instrument == "vocal":
        cmd += ["--source-type", "vocal"]
    if params.get("vocalistGender"):
        cmd += ["--vocalist-gender", params["vocalistGender"]]

    # Pass all additional advanced params as CLI flags
    HANDLED_PARAMS = {"tonic", "raga", "instrument", "vocalistGender", "vocalist_gender", "start_time", "end_time"}
    for key, value in params.items():
        if key in HANDLED_PARAMS or value is None or value == "":
            continue
        flag = f"--{key.replace('_', '-')}"
        if isinstance(value, bool):
            if value:
                cmd.append(flag)
        else:
            cmd += [flag, str(value)]

    # Run detect
    _update_job(job.id, status="running", progress=0.1, step="Running distribution analysis")
    _log(job.id, f"[2/4 Detect] Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=_pipeline_timeout(), env=env)
    if result.stdout:
        for line in result.stdout.strip().split("\n"):
            _log(job.id, f"[2/4 Detect] stdout: {line}")
    if result.returncode != 0:
        _log(job.id, f"[2/4 Detect] FAILED (exit code {result.returncode})")
        if result.stderr:
            for line in result.stderr.strip().split("\n")[:20]:
                _log(job.id, f"[2/4 Detect] stderr: {line}")
        raise RuntimeError(f"Detect failed: {result.stderr[:1000]}")
    _log(job.id, f"[2/4 Detect] Complete")

    _update_job(job.id, progress=0.5)

    # Parse detect results from meta.json to get tonic/raga for analyze
    import json, glob
    meta_files = glob.glob(f"{artifact_base}/**/detection_report.meta.json", recursive=True)
    detected_tonic = params.get("tonic")
    detected_raga = params.get("raga")
    if meta_files:
        with open(meta_files[0]) as f:
            meta = json.load(f)
        det = meta.get("detected", {})
        _log(job.id, f"[2/4 Detect] Meta detected: {json.dumps(det)}")
        if not detected_tonic:
            detected_tonic = det.get("top_tonic_name")
        if not detected_raga:
            detected_raga = det.get("selected_raga") or det.get("top_raga")
    _log(job.id, f"[2/4 Detect] Resolved tonic={detected_tonic}, raga={detected_raga}")

    # If no tonic/raga detected, we can't run analyze
    if not detected_tonic or not detected_raga:
        _log(job.id, f"[3/4 Analyze] SKIPPED - no tonic/raga detected. User must specify manually.")
        _update_job(job.id, progress=0.9, step="Finalizing")
        firestore_client.update_song(job.song_id, status="complete")
        firestore_client.update_analysis(job.song_id, job.analysis_id,
            status="complete",
            results={"detectedRaga": detected_raga, "detectedTonic": detected_tonic,
                     "confidence": 0, "candidateRagas": [], "needsManualInput": True},
            artifactPaths={"outputDir": artifact_base})
        return

    _update_job(job.id, progress=0.6, step="Running structural analysis")

    # Build analyze command
    cmd_analyze = ["python", "driver.py", "analyze", "--audio", audio_path, "--output", artifact_base,
                   "--tonic", detected_tonic, "--raga", detected_raga]
    # Pass advanced params to analyze too
    for key, value in params.items():
        if key in HANDLED_PARAMS or value is None or value == "":
            continue
        flag = f"--{key.replace('_', '-')}"
        if isinstance(value, bool):
            if value:
                cmd_analyze.append(flag)
        else:
            cmd_analyze += [flag, str(value)]

    # Run analyze
    _log(job.id, f"[3/4 Analyze] Running: {' '.join(cmd_analyze)}")
    result = subprocess.run(cmd_analyze, capture_output=True, text=True, timeout=_pipeline_timeout(), env=env)
    if result.stdout:
        for line in result.stdout.strip().split("\n"):
            _log(job.id, f"[3/4 Analyze] stdout: {line}")
    if result.returncode != 0:
        _log(job.id, f"[3/4 Analyze] FAILED (exit code {result.returncode})")
        if result.stderr:
            for line in result.stderr.strip().split("\n")[:20]:
                _log(job.id, f"[3/4 Analyze] stderr: {line}")
        raise RuntimeError(f"Analyze failed: {result.stderr[:1000]}")
    _log(job.id, f"[3/4 Analyze] Complete")

    _update_job(job.id, progress=0.9, step="Finalizing")

    # Update Firestore
    _log(job.id, f"[4/4 Finalize] Updating Firestore status -> complete")
    firestore_client.update_song(job.song_id, status="complete")
    firestore_client.update_analysis(job.song_id, job.analysis_id,
        status="complete",
        results={"detectedRaga": detected_raga, "detectedTonic": detected_tonic},
        artifactPaths={"outputDir": artifact_base})

    if source == "youtube":
        # YouTube on-device audio (legal posture, decided 2026-07-13): never
        # persist audio-bearing artifacts server-side. Deliver via a short-TTL
        # GCS buffer instead, then delete local audio-bearing files.
        _log(job.id, f"[4/4 Finalize] Delivering YouTube audio on-device (no server-side retention)")
        _deliver_youtube_audio(job, audio_path, artifact_base, params, audio_hash)

        # Cleanup YouTube temp files
        _log(job.id, f"[4/4 Finalize] Cleaning up temp YouTube audio")
        storage.cleanup_tmp(job.id)
    else:
        # Uploads: copy original audio into the artifact dir so it can be
        # served as the "original" track. Stems remain in place (unchanged).
        import shutil
        art_dir_for_original = glob.glob(f"{artifact_base}/**/vocals.mp3", recursive=True)
        if art_dir_for_original:
            stem_output_dir = str(Path(art_dir_for_original[0]).parent)
            original_dest = os.path.join(stem_output_dir, "original.mp3")
            if not os.path.exists(original_dest):
                try:
                    shutil.copy2(audio_path, original_dest)
                    _log(job.id, f"[4/4 Finalize] Copied original audio to {original_dest}")
                except Exception as e:
                    _log(job.id, f"[4/4 Finalize] WARN: failed to copy original audio: {e}")

    _log(job.id, f"Pipeline finished successfully for \"{title}\"")


def _worker() -> None:
    while True:
        job = _job_queue.get()
        _log(job.id, f"Job dequeued, starting execution")
        try:
            _update_job(job.id, status="running", progress=0.0, step="Starting")
            _run_pipeline(job)
            _update_job(job.id, status="completed", progress=1.0)
            _log(job.id, f"Job completed successfully")
        except Exception as e:
            _log(job.id, f"Job FAILED: {e}")
            _update_job(job.id, status="failed", error=str(e))
            try:
                firestore_client.update_song(job.song_id, status="failed")
                firestore_client.update_analysis(job.song_id, job.analysis_id, status="failed")
            except Exception:
                pass
            traceback.print_exc()
        finally:
            # Legal invariant: no YouTube-derived audio may linger server-side,
            # whether the job succeeded, returned early, or failed mid-pipeline.
            try:
                if job.source == "youtube" and job.audio_path and job.artifact_base:
                    _purge_youtube_local(job, job.audio_path, job.artifact_base, job.params)
            except Exception:
                pass
            _job_queue.task_done()


def _ensure_worker() -> None:
    global _worker_started
    if not _worker_started:
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        _worker_started = True


def submit_job(song_id: str, analysis_id: str, user_id: str, params: dict) -> str:
    _ensure_worker()
    job_id = str(uuid.uuid4())
    job = Job(id=job_id, song_id=song_id, analysis_id=analysis_id, user_id=user_id, params=params)
    with _lock:
        _jobs[job_id] = job
    _job_queue.put(job)
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        return {
            "id": job.id, "songId": job.song_id, "analysisId": job.analysis_id,
            "status": job.status, "progress": job.progress, "step": job.step,
            "error": job.error, "createdAt": job.created_at,
        }
