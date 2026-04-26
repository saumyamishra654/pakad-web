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

from api import storage, firestore_client


@dataclass
class Job:
    id: str
    song_id: str
    analysis_id: str
    user_id: str
    params: dict
    status: str = "queued"
    progress: float = 0.0
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


_job_queue: queue.Queue = queue.Queue()
_jobs: dict[str, Job] = {}
_lock = threading.Lock()
_worker_started = False


def _update_job(job_id: str, **fields) -> None:
    with _lock:
        if job_id in _jobs:
            for k, v in fields.items():
                setattr(_jobs[job_id], k, v)


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
        _update_job(job.id, status="running", progress=0.05)
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
    _update_job(job.id, status="running", progress=0.1)
    _log(job.id, f"[2/4 Detect] Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=env)
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
        _update_job(job.id, progress=0.9)
        firestore_client.update_song(job.song_id, status="complete")
        firestore_client.update_analysis(job.song_id, job.analysis_id,
            status="complete",
            results={"detectedRaga": detected_raga, "detectedTonic": detected_tonic,
                     "confidence": 0, "candidateRagas": [], "needsManualInput": True},
            artifactPaths={"outputDir": artifact_base})
        return

    _update_job(job.id, progress=0.6)

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
    result = subprocess.run(cmd_analyze, capture_output=True, text=True, timeout=3600, env=env)
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

    _update_job(job.id, progress=0.9)

    # Update Firestore
    _log(job.id, f"[4/4 Finalize] Updating Firestore status -> complete")
    firestore_client.update_song(job.song_id, status="complete")
    firestore_client.update_analysis(job.song_id, job.analysis_id,
        status="complete",
        results={"detectedRaga": detected_raga, "detectedTonic": detected_tonic},
        artifactPaths={"outputDir": artifact_base})

    # Cleanup YouTube temp files
    if source == "youtube":
        _log(job.id, f"[4/4 Finalize] Cleaning up temp YouTube audio")
        storage.cleanup_tmp(job.id)

    _log(job.id, f"Pipeline finished successfully for \"{title}\"")


def _worker() -> None:
    while True:
        job = _job_queue.get()
        _log(job.id, f"Job dequeued, starting execution")
        try:
            _update_job(job.id, status="running", progress=0.0)
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
            "status": job.status, "progress": job.progress, "error": job.error,
            "createdAt": job.created_at,
        }
