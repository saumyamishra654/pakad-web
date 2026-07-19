# Deployment (Plan 010 — split GPU topology)

This is the CPU host + Vercel frontend + remote-GPU stem service topology
described in `docs/ARCHITECTURE.md`. Read that first for the "why"; this doc
is the operator runbook for the "how".

## Components and where they go

| Component | Host | Notes |
|---|---|---|
| Next.js frontend | Vercel | `web/`, build with `output: standalone`; not part of this compose stack |
| FastAPI + worker | your CPU host (this repo's `docker-compose.yml`) | runs `driver.py detect\|analyze`; no GPU needed |
| Demucs stem service | RunPod Serverless | separate image, `stem-service/`; see Plan 008 |
| Cloudflare R2 | Cloudflare | transient audio bridge; see Plan 007 |
| Firestore | Firebase | metadata; unchanged |

## 1. CPU host sizing

No GPU required — Demucs runs remotely (or not at all if
`STEM_FALLBACK=fail`). Size for pitch extraction + analysis on long songs:

- Test with a real 1.5–2 hr file before going live; `driver.py`'s CPU steps
  (SwiftF0 pitch, histogram/GMM, phrase/motif analysis) scale with duration.
- Budget RAM generously for a 2 hr WAV/MP3 decode + pitch arrays in memory;
  4 GB+ free is a reasonable floor to start from, tune from observed peak.
- Disk: `/data` (the `app-data` volume) holds uploads + all analysis
  artifacts, keyed by audio hash — this grows with usage, monitor it.

## 2. Build and run the API image

```bash
docker build -f Dockerfile.api -t raga-api .
docker run --rm raga-api python driver.py --help
docker run --rm raga-api python -c "import torch, demucs, yt_dlp, boto3"
docker run --rm raga-api ls data/raga_list_final.csv tanpura/
```

All four should exit 0. The image installs CPU-only torch (no CUDA) — Demucs
still imports and runs on CPU for the `STEM_FALLBACK=local` path and local
dev, but real separation should go through the remote GPU service.

## 3. Configure `.env`

Copy `.env.example` to `.env` and fill in real values. Required for a minimal
CPU-only deploy: `FIREBASE_SERVICE_ACCOUNT_KEY`/`FIREBASE_KEY_FILE`,
`GOOGLE_CLOUD_PROJECT`, `CORS_ORIGINS` (your Vercel URL). Required to enable
GPU offload: the `R2_*` keys (Plan 007) and `USE_REMOTE_STEM_SEPARATION=true`
+ `STEM_SERVICE_URL`/`STEM_SERVICE_SECRET`/`RUNPOD_API_KEY` (Plans 008/009).
Never commit the filled-in `.env` or the service-account JSON.

## 4. RunPod endpoint setup (Plan 008)

1. Build and push `stem-service/` (`docker build -f stem-service/Dockerfile
   -t <registry>/pakad-stem:latest stem-service/ && docker push ...`).
2. Create a RunPod Serverless endpoint from that image; attach a network
   volume or enable model caching so htdemucs weights persist across
   invocations instead of re-downloading per cold start.
3. Set `STEM_SERVICE_URL` to the endpoint's base URL and generate a random
   `STEM_SERVICE_SECRET` — set the same value on both the API host and the
   RunPod endpoint's environment.
4. Smoke test: a short YouTube clip end-to-end (see Step 8 below) with
   `USE_REMOTE_STEM_SEPARATION=true` before trusting it for long songs.

## 5. `docker compose up`

```bash
docker compose config -q          # validates env substitution, no web service
docker compose up --build -d
```

- The `api` service binds to `127.0.0.1:8765` only — nginx is the sole public
  entry point (80/443).
- The Firebase key is bind-mounted read-only from `FIREBASE_KEY_FILE` (host
  path, set in `.env`) to `/secrets/firebase.json` in the container.
- `model-cache` is a named volume for local-fallback Demucs weights; `app-data`
  holds `/data` (uploads + artifacts) across restarts.
- There is no `web` service — the frontend deploys to Vercel separately.

## 6. TLS via certbot

`nginx.conf` ships an active port-80 server (proxies `/api/`, serves ACME
challenges) and a fully-written, commented-out port-443 server.

```bash
docker run --rm -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
```

To issue certs: point your domain's A record at the host, run certbot against
`./certbot/www` (webroot) with the running nginx serving the ACME challenge
location, then uncomment the 443 server block in `nginx.conf` with your real
`server_name`/`DOMAIN` and reload nginx. nginx does not expand env vars in
plain configs — edit the placeholders directly.

## 7. Frontend on Vercel

Deploy `web/` to Vercel. Set in the Vercel project's environment (not in a
committed file): `NEXT_PUBLIC_FIREBASE_*` (the same keys used in local dev's
`web/.env.local`) and `NEXT_PUBLIC_API_URL` pointing at your backend domain (e.g.
`https://api.yourdomain.com`) — see `web/.env.production` for the template.
On the backend, set `CORS_ORIGINS` to the exact Vercel URL(s) so the browser
can call the API cross-origin.

## 8. R2 lifecycle cleanup (backstop)

Both R2 prefixes (`handoff/` for the GPU job, `delivery/` for per-user audio
buffers) are already deleted by application code on the happy path and on
failure (`finally` blocks in `api/jobs.py`). Apply `docs/r2-lifecycle.json` as
a backstop so nothing lingers if a process is killed hard:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url "$R2_ENDPOINT" \
  --bucket "$R2_BUCKET" \
  --lifecycle-configuration file://docs/r2-lifecycle.json
```

## 9. Smoke test

1. Upload a short YouTube clip through the deployed frontend.
2. Confirm the job completes and the results page renders (pitch, histogram,
   raga scores).
3. Confirm audio playback works (delivered to IndexedDB, not served from the
   API for YouTube sources).
4. If `USE_REMOTE_STEM_SEPARATION=true`, confirm the job actually went through
   RunPod (check RunPod's request logs) rather than silently falling back.
