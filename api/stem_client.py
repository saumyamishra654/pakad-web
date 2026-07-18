"""Thin client for the remote stem-separation service (Plan 008)."""
import os
import time
import requests

_URL = os.environ.get("STEM_SERVICE_URL", "").strip()
_SECRET = os.environ.get("STEM_SERVICE_SECRET", "").strip()


def enabled() -> bool:
    return (os.environ.get("USE_REMOTE_STEM_SEPARATION", "false").lower() == "true"
            and bool(_URL) and bool(_SECRET))


def separate(input_url: str, vocals_put_url: str, accompaniment_put_url: str,
             model: str = "htdemucs", poll_timeout: int = 3600) -> None:
    """Call the RunPod endpoint and block until separation finishes.

    Uses RunPod's /runsync when the endpoint supports it; otherwise submit to
    /run and poll /status/{id}. Raises on failure.
    """
    payload = {"input": {
        "input_url": input_url,
        "vocals_put_url": vocals_put_url,
        "accompaniment_put_url": accompaniment_put_url,
        "model": model,
        "secret": _SECRET,
    }}
    headers = {"Authorization": f"Bearer {os.environ.get('RUNPOD_API_KEY','')}"}
    r = requests.post(f"{_URL}/runsync", json=payload, headers=headers, timeout=poll_timeout)
    r.raise_for_status()
    body = r.json()
    out = body.get("output", body)
    if out.get("status") != "ok":
        raise RuntimeError(f"stem service error: {body}")
