"""Storage abstraction layer.

Uses local disk in development, designed to swap to Cloud Storage in production.
All file paths are relative to the storage root. Callers never deal with absolute paths.
"""

import os
import shutil
from pathlib import Path
from typing import Optional

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", str(_PROJECT_ROOT / ".local_app_data")))


def _full_path(relative: str) -> Path:
    """Resolve a relative path against the storage root. Prevents traversal."""
    full = (STORAGE_ROOT / relative).resolve()
    if not str(full).startswith(str(STORAGE_ROOT.resolve())):
        raise ValueError(f"Path traversal attempt: {relative}")
    return full


def ensure_dir(relative: str) -> Path:
    path = _full_path(relative)
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_file(relative: str, data: bytes) -> str:
    path = _full_path(relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return relative


def read_file(relative: str) -> bytes:
    path = _full_path(relative)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {relative}")
    return path.read_bytes()


def file_exists(relative: str) -> bool:
    return _full_path(relative).exists()


def get_absolute_path(relative: str) -> Path:
    path = _full_path(relative)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {relative}")
    return path


def delete_file(relative: str) -> bool:
    path = _full_path(relative)
    if path.exists():
        path.unlink()
        return True
    return False


def list_files(relative_dir: str, pattern: str = "*") -> list[str]:
    dir_path = _full_path(relative_dir)
    if not dir_path.exists():
        return []
    resolved_root = STORAGE_ROOT.resolve()
    return [
        str(p.resolve().relative_to(resolved_root))
        for p in dir_path.glob(pattern)
        if p.is_file()
    ]


def upload_dir(user_id: str, song_id: str) -> str:
    return f"uploads/{user_id}/{song_id}"


def upload_path(user_id: str, song_id: str, filename: str) -> str:
    return f"uploads/{user_id}/{song_id}/{filename}"


def artifact_dir(audio_hash: str) -> str:
    return f"artifacts/{audio_hash}"


def analysis_dir(analysis_id: str) -> str:
    return f"analyses/{analysis_id}"


def tmp_dir(job_id: str) -> str:
    return f"tmp/{job_id}"


def cleanup_tmp(job_id: str) -> None:
    path = _full_path(f"tmp/{job_id}")
    if path.exists():
        shutil.rmtree(path)


def is_youtube_source(song: dict) -> bool:
    return song.get("source") == "youtube"
