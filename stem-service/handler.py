"""RunPod serverless handler: signed-URL in, signed-URL out."""
import hmac
import os
import tempfile
from urllib.parse import urlparse

import requests
import runpod
from separator import separate

SECRET = os.environ["STEM_SERVICE_SECRET"]
# Only fetch/upload from the object store we hand out signed URLs for.
# Default is Cloudflare R2; override for S3/GCS (e.g. "amazonaws.com").
ALLOWED_URL_HOST_SUFFIX = os.environ.get("ALLOWED_URL_HOST_SUFFIX", "r2.cloudflarestorage.com")
ALLOWED_MODELS = {"htdemucs", "htdemucs_ft", "htdemucs_6s", "mdx_extra", "mdx_extra_q"}


def _allowed_url(url: str) -> bool:
    """Accept only https URLs whose host is in the configured object store."""
    try:
        p = urlparse(url)
    except Exception:
        return False
    return p.scheme == "https" and p.hostname is not None and (
        p.hostname == ALLOWED_URL_HOST_SUFFIX or p.hostname.endswith("." + ALLOWED_URL_HOST_SUFFIX)
    )


def handler(job):
    data = job.get("input", {})
    # Constant-time comparison so a wrong secret can't be timing-guessed.
    if not hmac.compare_digest(str(data.get("secret") or ""), SECRET):
        return {"error": "unauthorized"}

    input_url = data["input_url"]            # signed GET
    vocals_put = data["vocals_put_url"]      # signed PUT
    accomp_put = data["accompaniment_put_url"]
    model = data.get("model", "htdemucs")

    if model not in ALLOWED_MODELS:
        return {"error": f"unsupported model: {model}"}
    for url in (input_url, vocals_put, accomp_put):
        if not _allowed_url(url):
            return {"error": "url host not allowed"}

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, "input")
        r = requests.get(input_url, timeout=600)
        r.raise_for_status()
        with open(in_path, "wb") as f:
            f.write(r.content)

        vocals_path, accomp_path = separate(in_path, tmp, model)

        for path, url in [(vocals_path, vocals_put), (accomp_path, accomp_put)]:
            with open(path, "rb") as f:
                put = requests.put(url, data=f,
                                   headers={"Content-Type": "audio/mpeg"},
                                   timeout=600)
                put.raise_for_status()

    return {"status": "ok", "model": model}


runpod.serverless.start({"handler": handler})
