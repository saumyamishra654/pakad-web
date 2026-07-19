# Pakad — Architecture: what changed and where we are now

_Last updated 2026-07-19. Authored during the Shape-2 hosting migration._

This document explains (1) the architecture we started from, (2) the exact set
of changes we made and why, and (3) the precise layout of the system now.

---

## 0. TL;DR

We went from a **single-machine app** (one box downloads audio, runs Demucs,
extracts pitch, scores ragas, and serves everything off local disk) to a
**split, GPU-accelerated system**:

- **Frontend** hosted separately (Vercel).
- **Backend API + CPU work** (pitch, analysis, raga scoring) on one always-on host.
- **Demucs stem separation offloaded to a remote GPU** (RunPod Serverless).
- **Cloudflare R2** as the transient bridge for audio between those machines.
- **YouTube audio is never retained server-side** — analysis is shared; audio is
  delivered to the requesting user's own device (browser IndexedDB).

The driver of all this: real songs are **30 min – 2 hr**, which makes CPU Demucs
infeasible, and YouTube-derived stems are copyrighted, which makes server-side
retention a legal liability.

---

## 1. The original architecture (baseline)

Three layers on **one machine**:

```
Browser ──► Next.js (SSR) ──► FastAPI ──► driver.py (subprocess)
                                 │                │
                                 │                ├─ Demucs (stem separation)  ← in-process
                                 │                ├─ SwiftF0 (pitch)
                                 │                └─ histogram / GMM / raga scoring
                                 │
                                 ├─ Firestore  (song/analysis/comment metadata)
                                 └─ local disk (.local_app_data/): uploads + all artifacts
```

Key properties of the baseline:

- **Pipeline runs as a subprocess** of the API (`api/jobs.py` → `python driver.py
  detect|analyze`). The CLI is the contract, not Python imports.
- **Demucs ran in-process** inside `driver.py` on whatever machine ran Python.
- **Storage was local disk** (`api/storage.py`, `STORAGE_ROOT`), artifacts keyed
  by `audioHash`.
- **Job queue is in-memory** (`queue.Queue` + one daemon thread).
- **All media served from local disk**, including original audio and separated stems.
- **A 1-hour hard cap** on each pipeline subprocess (`timeout=3600`).

This works for short clips on a beefy box, but breaks for our real workload and
our hosting/legal constraints.

---

## 2. What we changed, and why

| # | Change | Why | Where |
|---|--------|-----|-------|
| 1 | **Enforce visibility on every media endpoint** + filename allowlist | Any guessed `song_id` could stream a private song's audio/stems/pitch/transcription; `filename` was interpolated into paths unchecked | `api/routes/results.py`, `artifacts.py`, `transcription.py` (`require_song_access`, `_safe_filename`) |
| 2 | **Sync the vendored pipeline to source** | Web analyses silently differed from the CLI (missing RMS-primary phrase splitting) | `raga_pipeline/`, `driver.py` |
| 3 | **Split topology (Shape 2)**: frontend on Vercel, API/CPU on one host, **Demucs on a remote GPU** | 30 min–2 hr songs make CPU Demucs an outage risk; GPU is the only step that truly needs acceleration | new `stem-service/`, `api/stem_client.py`, `api/jobs.py` |
| 4 | **Object storage (Cloudflare R2) as the GPU handoff** | CPU host and GPU worker can't share a disk; R2 moves audio in / stems out via presigned URLs. R2 chosen over GCS for a real free tier + zero egress | `api/object_store.py` (boto3/S3) |
| 5 | **Uncap the long-song timeout** | The 1-hour cap killed 2-hour jobs regardless of GPU | `api/jobs.py` (`_pipeline_timeout`, env `PIPELINE_TIMEOUT_SECONDS`) |
| 6 | **YouTube audio stays on-device** | Downloaded/separated YouTube audio is copyrighted; the server processes it transiently and never retains/redistributes it | `api/jobs.py` (`_deliver_youtube_audio`, `_purge_youtube_local`), `api/routes/results.py` (`_resolve_audio_delivery`), `web/src/lib/localAudio.ts` |
| 7 | **Per-user, on-demand audio** | Shared songs show analysis to all, but audio only to whoever supplied/regenerated it; a viewer can regenerate audio to their own device | `audio_only` job mode; `POST /api/songs/{id}/audio-job`; frontend "Generate audio" |
| 8 | **Security hardening** | The GPU endpoint is public; a shared secret alone isn't enough | `stem-service/handler.py`: constant-time secret compare, model allowlist, URL-host allowlist (SSRF guard) |
| 9 | **Slim GPU image** | 008's `-devel-` CUDA base was ~8 GB+; we only run, never compile | `stem-service/Dockerfile` → `runtime` CUDA base + ffmpeg + matched torchaudio |

### Two invariants these changes establish

- **Legal / retention:** *no YouTube-derived audio persists server-side.* Enforced
  on every exit path — best-effort delivery upload with a guaranteed local delete
  (`finally`), plus a worker-`finally` purge so a failed job can't leave stems behind.
- **Privacy / per-user:** *audio is delivered to the requesting user only.* Files land
  at `delivery/{audioHash}/{userId}/…`; the results endpoint mints presigned GET URLs
  **only for the caller's own prefix**. A public song's analysis is world-readable, but
  its audio is not.

---

## 3. The architecture now

### 3.1 Components and where they run

| Component | Runs on | Responsibility | State |
|-----------|---------|----------------|-------|
| **Next.js frontend** | Vercel (separate) | UI, Firebase auth, local-first audio playback | Browser IndexedDB holds YouTube audio |
| **FastAPI backend + worker** | one always-on CPU host (Docker) | uploads, auth, job queue, runs `driver.py` (detect/analyze) on CPU, serves analysis | local disk: uploads + analysis artifacts (not YouTube audio) |
| **Stem service** | RunPod Serverless (GPU) | Demucs separation only; signed-URL in, signed-URL out | stateless; no standing creds |
| **Cloudflare R2** | Cloudflare | transient audio bridge | `handoff/…` (GPU) + `delivery/…` (browser); lifecycle-purged |
| **Firestore** | Firebase (unchanged) | song / analysis / comment metadata | external, authoritative for metadata |

```
                 ┌──────────────────────────┐
   Browser ─────►│  Next.js on Vercel        │
   (IndexedDB    │  NEXT_PUBLIC_API_URL ──────────────┐
    holds YT     └──────────────────────────┘         │  Firebase ID token
    audio)                                             ▼
                                        ┌──────────────────────────────┐
                                        │  FastAPI + worker (CPU host)  │
                                        │  • routes + in-memory queue   │
                                        │  • driver.py detect/analyze   │─── Firestore (metadata)
                                        │  • local disk: uploads +      │
                                        │    analysis artifacts         │
                                        └───────┬───────────────┬───────┘
                    presigned PUT/GET (handoff) │               │ presigned GET (delivery)
                                                ▼               ▼
                                   ┌────────────────────────────────────┐
                                   │        Cloudflare R2 (S3)          │
                                   │  handoff/{job}/…   delivery/{hash}/│
                                   │                       {user}/…     │
                                   └───────┬────────────────────────────┘
                    signed GET in / PUT out │
                                            ▼
                                 ┌────────────────────────┐
                                 │ RunPod Serverless (GPU) │
                                 │  stem-service: Demucs   │
                                 └────────────────────────┘
```

### 3.2 The two R2 prefixes (both transient)

- **`handoff/{job_id}/…`** — CPU host uploads the input audio; GPU writes
  `vocals.mp3` / `accompaniment.mp3`; CPU downloads them; the prefix is deleted at
  the end of the job (and by a bucket lifecycle rule as a backstop).
- **`delivery/{audioHash}/{userId}/…`** — per-user audio buffer for YouTube songs.
  The results endpoint mints short-TTL GET URLs for the caller's own prefix; the
  browser pulls the bytes into IndexedDB. Lifecycle-purged.

### 3.3 Request / data flows

**A. File upload → analysis**
1. Browser uploads file → API stores it on local disk → enqueues a job.
2. Worker: if `USE_REMOTE_STEM_SEPARATION` → upload audio to `handoff/`, call RunPod,
   download stems, **pre-seed the pipeline's stem cache** (so `separate_stems` skips
   Demucs). Else → local CPU Demucs (or `--skip-separation` fallback).
3. `driver.py detect` then `analyze` run on CPU → analysis artifacts written locally.
4. Original + stems are **kept on the server** (uploads are the user's own content)
   and served via the existing artifact endpoints.

**B. YouTube URL → analysis (audio never retained)**
1. Browser submits URL → API enqueues.
2. Worker: `yt-dlp` downloads to a **temp** dir → offload separation to the GPU via
   R2 (as in A) → `detect`/`analyze` on CPU.
3. Persist **analysis only** (pitch CSVs, meta, images, transcription, raga).
4. `_deliver_youtube_audio`: upload original+stems to `delivery/{hash}/{uploader}/…`,
   then **delete every local audio-bearing file**; the temp download is purged.
5. Results endpoint, on read, mints the uploader's delivery URLs → browser stores them
   in IndexedDB → **local-first playback**.
6. If anything fails, the worker-`finally` purge guarantees no audio is left on disk.

**C. A different user opens an already-analyzed YouTube song**
1. `GET /api/results/{id}` returns the full analysis (world-readable if public) and
   `audioDelivery.available = false` (that user has no buffer of their own).
2. Frontend shows **"Generate audio"** → `POST /api/songs/{id}/audio-job` enqueues an
   `audio_only` job.
3. Worker re-downloads + re-separates (GPU), delivers to `delivery/{hash}/{thisUser}/…`,
   **skips detect/analyze** (analysis is cached). Results then mints *their* URLs →
   IndexedDB → playback.

### 3.4 Configuration flags

| Env | Effect |
|-----|--------|
| `USE_REMOTE_STEM_SEPARATION` | `true` → offload Demucs to the GPU (needs `STEM_SERVICE_URL`/`_SECRET`); otherwise inert |
| `STEM_FALLBACK` | `fail` (don't silently run multi-hour CPU Demucs) or `local` |
| `PIPELINE_TIMEOUT_SECONDS` | empty = no cap (long songs); or an int |
| `AUDIO_DELIVERY_TTL_SECONDS` | signed-GET lifetime for the delivery buffer (default 24h) |
| `R2_BUCKET` / `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 handoff (blank = disabled) |
| `CORS_ORIGINS` | admits the Vercel frontend origin (Plan 010) |

---

## 4. What stayed the same

- **Firestore** for metadata — untouched, still authoritative.
- **The pipeline CLI** (`driver.py detect|analyze`) — still the contract; offload works
  by pre-seeding its stem cache, not by changing the pipeline.
- **In-memory job queue** — single worker, lost on restart. Deliberately deferred;
  Redis/RQ is the next step when CPU concurrency becomes real.
- **Uploads** — still stored and served server-side (only YouTube audio is on-device).

---

## 5. Status / what's still pending

- **Code complete:** media auth, pipeline sync, R2 object store, stem service,
  offload + long-song, on-device audio (+ per-user privacy fix). ~55 backend tests green.
- **Plan 010 (deploy hardening):** CPU-only API Docker image, env CORS, nginx/TLS,
  consolidated `.env.example`, `web/.env.production`, R2 lifecycle rule — **not yet done**.
- **Operator gates:** activate R2 + create bucket/token; RunPod credit + create the
  Serverless endpoint from the pushed image; then a full GPU e2e run.
- **Deferred (post first deploy):** full object-storage for *all* artifacts (stateless
  horizontal CPU scale), Redis/RQ job queue, client-side (in-browser) separation.
```
