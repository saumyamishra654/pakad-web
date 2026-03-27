"""Background job queue for pipeline execution."""

import threading
import queue
import uuid
import traceback
import subprocess
import os
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


def _run_pipeline(job: Job) -> None:
    song = firestore_client.get_song(job.song_id)
    if not song:
        raise ValueError(f"Song {job.song_id} not found")

    audio_hash = song.get("audioHash", "")
    source = song.get("source", "file")

    # Determine audio file path
    if source == "youtube":
        video_id = song.get("youtubeVideoId")
        if not video_id:
            raise ValueError("No YouTube video ID")
        tmp = storage.ensure_dir(storage.tmp_dir(job.id))
        audio_path = str(tmp / "audio.mp3")
        dl_result = subprocess.run(
            ["yt-dlp", "-x", "--audio-format", "mp3", "-o", audio_path,
             f"https://youtube.com/watch?v={video_id}"],
            capture_output=True, text=True, timeout=300,
        )
        if dl_result.returncode != 0:
            raise RuntimeError(f"YouTube download failed: {dl_result.stderr[:500]}")
    else:
        upload_base = storage.upload_dir(job.user_id, job.song_id)
        files = []
        for ext in ["*.mp3", "*.wav", "*.flac", "*.m4a"]:
            files.extend(storage.list_files(upload_base, ext))
        if not files:
            raise ValueError("No audio file found for this song")
        audio_path = str(storage.get_absolute_path(files[0]))

    analysis = firestore_client.get_analysis(job.song_id, job.analysis_id)
    params = analysis.get("params", {}) if analysis else {}

    artifact_base = str(storage.ensure_dir(storage.artifact_dir(audio_hash)))

    env = os.environ.copy()

    # Run detect
    cmd = ["python", "driver.py", "detect", "--audio", audio_path, "--output", artifact_base]
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

    _update_job(job.id, status="running", progress=0.1)
    print(f"[DEBUG] detect cmd: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=env)
    if result.returncode != 0:
        print(f"[DEBUG] detect stderr: {result.stderr[:2000]}")
        raise RuntimeError(f"Detect failed: {result.stderr[:1000]}")
    print(f"[DEBUG] detect completed successfully")

    _update_job(job.id, progress=0.6)

    # Run analyze
    cmd_analyze = ["python", "driver.py", "analyze", "--audio", audio_path, "--output", artifact_base]
    if params.get("tonic"):
        cmd_analyze += ["--tonic", params["tonic"]]
    if params.get("raga"):
        cmd_analyze += ["--raga", params["raga"]]

    print(f"[DEBUG] analyze cmd: {' '.join(cmd_analyze)}")
    result = subprocess.run(cmd_analyze, capture_output=True, text=True, timeout=3600, env=env)
    if result.returncode != 0:
        print(f"[DEBUG] analyze stderr: {result.stderr[:2000]}")
        raise RuntimeError(f"Analyze failed: {result.stderr[:1000]}")
    print(f"[DEBUG] analyze completed successfully")

    _update_job(job.id, progress=0.9)

    # Update Firestore
    firestore_client.update_song(job.song_id, status="complete")
    firestore_client.update_analysis(job.song_id, job.analysis_id, status="complete", artifactPaths={
        "outputDir": artifact_base,
    })

    # Cleanup YouTube temp files
    if source == "youtube":
        storage.cleanup_tmp(job.id)


def _worker() -> None:
    while True:
        job = _job_queue.get()
        try:
            _update_job(job.id, status="running", progress=0.0)
            _run_pipeline(job)
            _update_job(job.id, status="completed", progress=1.0)
        except Exception as e:
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
