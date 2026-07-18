# stem-service

Standalone RunPod Serverless worker that runs Demucs stem separation and
produces the same two output files as the pipeline's
`raga_pipeline/audio.py::separate_stems`: `vocals.mp3` and
`accompaniment.mp3` (where `accompaniment = drums + bass + other`).

The worker is provider-agnostic in spirit: it only reads a signed input URL
and writes to signed output URLs. It does not talk to Firestore, the API, or
any object-store SDK directly — `api/jobs.py` (Plan 009) is expected to
generate the signed URLs (Plan 007) and call this endpoint.

## Input schema

RunPod invokes `handler(job)` with the request body at `job["input"]`:

```json
{
  "secret": "shared-secret-string",
  "input_url": "https://.../input.wav?signature=...",
  "vocals_put_url": "https://.../vocals.mp3?signature=...",
  "accompaniment_put_url": "https://.../accompaniment.mp3?signature=...",
  "model": "htdemucs"
}
```

| Field | Required | Description |
|---|---|---|
| `secret` | yes | Must match the `STEM_SERVICE_SECRET` env var configured on the endpoint. Requests with a missing/incorrect secret return `{"error": "unauthorized"}` and do no work. |
| `input_url` | yes | Signed GET URL for the source audio file. Downloaded in full before separation starts. |
| `vocals_put_url` | yes | Signed PUT URL the worker uploads `vocals.mp3` to. |
| `accompaniment_put_url` | yes | Signed PUT URL the worker uploads `accompaniment.mp3` to. |
| `model` | no (default `htdemucs`) | Demucs model name, passed through to `demucs.pretrained.get_model`. |

### Response

```json
{"status": "ok", "model": "htdemucs"}
```

or, on a bad secret:

```json
{"error": "unauthorized"}
```

Any other failure (bad download, demucs error, failed upload) raises and
surfaces as a RunPod job error/exception — the caller should treat a
non-`ok` response as a failure and retry/report per its own policy.

## Environment

- `STEM_SERVICE_SECRET` — shared secret the caller must pass in `input.secret`.
  Required at process start; the handler will fail to import if unset.
  **Never commit this value.** Set it via the RunPod endpoint's environment
  variable configuration.

## Local development

```bash
cd stem-service
pip install -r requirements.txt
python -m py_compile handler.py separator.py   # syntax/contract check, no GPU needed
```

`local_smoke.py` runs the separator directly on a local file, bypassing
RunPod entirely, for CPU parity checks against the pipeline:

```bash
python local_smoke.py path/to/short.wav
# writes smoke_out/vocals.mp3 and smoke_out/accompaniment.mp3
```

Compare the output against a pipeline run (`raga_pipeline/audio.py::separate_stems`,
or `driver.py detect` on the same clip) to confirm parity: same file names,
same drums+bass+other combination. Bit-exactness is not required.

## Build

```bash
docker build -t pakad-stem stem-service/
```

The base image (`runpod/pytorch:2.2.0-py3.10-cuda12.1.1-devel-ubuntu22.04`)
ships torch/torchaudio compiled for CUDA 12.1; only `demucs`, `runpod`, and
`requests` are installed on top.

## Deploy to RunPod Serverless

1. Build and push the image to a registry RunPod can pull from:
   ```bash
   docker build -t <registry>/<repo>:pakad-stem stem-service/
   docker push <registry>/<repo>:pakad-stem
   ```
2. In the RunPod dashboard (or via the RunPod API), create a new Serverless
   endpoint pointing at the pushed image.
3. Set the endpoint's environment variables:
   - `STEM_SERVICE_SECRET` = a generated shared secret (also configured on
     the caller side, e.g. `api/jobs.py` once Plan 009 lands).
4. Configure worker scaling per the cost/latency tradeoff documented in
   `plans/README.md` (Shape-2 section): set `min_workers`/`cold_workers` >= 1
   if cold-start latency (model download + CUDA init) is unacceptable for
   your traffic pattern; otherwise leave at 0 to avoid idle GPU cost.
5. Attach a RunPod network volume (or enable RunPod's model caching) for the
   htdemucs weights so they are downloaded once and reused across worker
   invocations rather than re-fetched from the demucs model hub on every
   cold start. The Dockerfile intentionally does not bake the weights into
   the image, to keep the image lean and avoid re-pulling it on every model
   update.
6. Send a test job with signed URLs pointed at a scratch bucket/container and
   confirm the response is `{"status": "ok", ...}` and that `vocals.mp3` /
   `accompaniment.mp3` land at the target URLs.

## Parity requirement

This service MUST keep producing the same two files, same combination
(`accompaniment = drums + bass + other`), as
`raga_pipeline/audio.py::separate_stems` / `_separate_demucs`. If the
pipeline's separation logic changes (new model, different stem combination),
re-sync `separator.py` — see the maintenance note in
`plans/008-runpod-stem-service.md`.
