"""S3-compatible object store for remote stem-separation handoff (Plan 007).

Backed by Cloudflare R2 (or any S3-compatible store) via boto3. Opt-in: every
function requires R2_BUCKET + R2_ENDPOINT to be set, so dev and tests run with
zero config. The GPU worker never gets standing credentials -- the CPU host
generates short-lived presigned URLs instead. Local artifact storage stays in
api/storage.py; this module only moves the audio input and separated stems
between the CPU host and the GPU worker.

The public interface (enabled, upload_file, download_file, signed_get_url,
signed_put_url, delete_prefix) is deliberately backend-agnostic -- it was GCS
before and is R2 now; callers (api/jobs.py, api/stem_client.py) do not change.
"""

import os
from typing import Optional

_BUCKET = os.environ.get("R2_BUCKET", "").strip()
_ENDPOINT = os.environ.get("R2_ENDPOINT", "").strip()
_ACCESS_KEY = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
_SECRET_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
_REGION = os.environ.get("R2_REGION", "auto").strip() or "auto"

_client = None  # lazily initialized boto3 S3 client


def enabled() -> bool:
    """True when a bucket + endpoint are configured and boto3 is importable."""
    if not (_BUCKET and _ENDPOINT):
        return False
    try:
        import boto3  # noqa: F401
        return True
    except Exception:
        return False


def _s3():
    global _client
    if not (_BUCKET and _ENDPOINT):
        raise RuntimeError("object_store: R2_BUCKET / R2_ENDPOINT are not set")
    if _client is None:
        import boto3
        from botocore.config import Config
        _client = boto3.client(
            "s3",
            endpoint_url=_ENDPOINT,
            aws_access_key_id=_ACCESS_KEY or None,
            aws_secret_access_key=_SECRET_KEY or None,
            region_name=_REGION,
            config=Config(signature_version="s3v4"),
        )
    return _client


def upload_file(local_path: str, key: str, content_type: Optional[str] = None) -> str:
    """Upload a local file to s3://<bucket>/<key>. Returns the s3:// URI."""
    extra = {"ContentType": content_type} if content_type else None
    _s3().upload_file(local_path, _BUCKET, key, ExtraArgs=extra)
    return f"s3://{_BUCKET}/{key}"


def download_file(key: str, local_path: str) -> None:
    """Download s3://<bucket>/<key> to a local path."""
    os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
    _s3().download_file(_BUCKET, key, local_path)


def exists(key: str) -> bool:
    """True if an object exists at the key (used to resolve per-user delivery)."""
    try:
        _s3().head_object(Bucket=_BUCKET, Key=key)
        return True
    except Exception:
        return False


def signed_get_url(key: str, expires_seconds: int = 3600) -> str:
    """Short-lived presigned GET URL for an existing object."""
    return _s3().generate_presigned_url(
        "get_object",
        Params={"Bucket": _BUCKET, "Key": key},
        ExpiresIn=expires_seconds,
    )


def signed_put_url(key: str, expires_seconds: int = 3600,
                   content_type: str = "application/octet-stream") -> str:
    """Short-lived presigned PUT URL for uploading an object.

    The uploader MUST send the same Content-Type header it signs with.
    """
    return _s3().generate_presigned_url(
        "put_object",
        Params={"Bucket": _BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=expires_seconds,
    )


def delete_prefix(prefix: str) -> int:
    """Delete every object under a prefix (handoff cleanup). Returns count."""
    s3 = _s3()
    n = 0
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=_BUCKET, Prefix=prefix):
        objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
        if objs:
            s3.delete_objects(Bucket=_BUCKET, Delete={"Objects": objs})
            n += len(objs)
    return n
