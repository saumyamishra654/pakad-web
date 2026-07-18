"""RunPod serverless handler: signed-URL in, signed-URL out."""
import os
import tempfile
import requests
import runpod
from separator import separate

SECRET = os.environ["STEM_SERVICE_SECRET"]


def handler(job):
    data = job.get("input", {})
    if data.get("secret") != SECRET:
        return {"error": "unauthorized"}

    input_url = data["input_url"]            # signed GET
    vocals_put = data["vocals_put_url"]      # signed PUT
    accomp_put = data["accompaniment_put_url"]
    model = data.get("model", "htdemucs")

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
