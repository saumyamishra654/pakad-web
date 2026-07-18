"""GCS transfer helper for remote stem-separation handoff (Plan 007).

Opt-in: all functions require GCS_BUCKET to be set. The GPU worker never gets
standing credentials — the CPU host generates short-lived signed URLs instead.
Local artifact storage stays in api/storage.py; this module only moves the
audio input and the separated stems between the CPU host and the GPU worker.
"""

import os
from datetime import timedelta
from typing import Optional

_BUCKET = os.environ.get("GCS_BUCKET", "").strip()
_client = None  # lazily initialized google.cloud.storage.Client


def enabled() -> bool:
    """True when a bucket is configured and the SDK is importable."""
    if not _BUCKET:
        return False
    try:
        import google.cloud.storage  # noqa: F401
        return True
    except Exception:
        return False


def _bucket():
    global _client
    if not _BUCKET:
        raise RuntimeError("object_store: GCS_BUCKET is not set")
    if _client is None:
        from google.cloud import storage
        _client = storage.Client()
    return _client.bucket(_BUCKET)


def upload_file(local_path: str, key: str, content_type: Optional[str] = None) -> str:
    """Upload a local file to gs://<bucket>/<key>. Returns the gs:// URI."""
    blob = _bucket().blob(key)
    blob.upload_from_filename(local_path, content_type=content_type)
    return f"gs://{_BUCKET}/{key}"


def download_file(key: str, local_path: str) -> None:
    """Download gs://<bucket>/<key> to a local path."""
    os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
    self_blob = _bucket().blob(key)
    self_blob.download_to_filename(local_path)


def signed_get_url(key: str, expires_seconds: int = 3600) -> str:
    """Short-lived signed GET URL for an existing object."""
    return _bucket().blob(key).generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=expires_seconds),
        method="GET",
    )


def signed_put_url(key: str, expires_seconds: int = 3600,
                   content_type: str = "application/octet-stream") -> str:
    """Short-lived signed PUT URL for uploading an object.

    The uploader MUST send the same Content-Type header it signs with.
    """
    return _bucket().blob(key).generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=expires_seconds),
        method="PUT",
        content_type=content_type,
    )


def delete_prefix(prefix: str) -> int:
    """Delete every object under a prefix (handoff cleanup). Returns count."""
    n = 0
    for blob in _bucket().list_blobs(prefix=prefix):
        blob.delete()
        n += 1
    return n
