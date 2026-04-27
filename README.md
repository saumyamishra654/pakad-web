# Pakad

Web application for Hindustani raga detection and analysis. Upload audio recordings or YouTube links, and get detailed raga identification with interactive pitch visualization, transcription, and pattern analysis.

## Architecture

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS
- **Backend**: FastAPI (Python)
- **Auth & Database**: Firebase Authentication + Cloud Firestore
- **Pipeline**: Raga detection pipeline (stem separation via Demucs, pitch extraction via SwiftF0, raga scoring)

```
pakad-web/
├── web/                    # Next.js frontend
├── api/                    # FastAPI backend
├── raga_pipeline/          # Detection/analysis pipeline (copied from raga-detection)
├── driver.py               # Pipeline entry point
├── data/                   # Raga database CSVs
├── docker-compose.yml      # Production deployment
├── nginx.conf              # Reverse proxy config
└── Dockerfile.api          # API container
```

## Prerequisites

- **Node.js** >= 18
- **Python** 3.10+ (Conda recommended)
- **ffmpeg** and **ffprobe** in PATH
- **Firebase project** with Authentication and Firestore enabled
- **yt-dlp** for YouTube downloads
- Optional: **torch** + **demucs** for stem separation, **swift-f0** for pitch extraction

## Setup

### 1. Install dependencies

```bash
# Frontend
cd web && npm install

# Backend
pip install -r requirements.txt
```

## Running locally

Start both servers in separate terminals:

```bash
# Terminal 1: Frontend (port 3000)
cd web && npm run dev

# Terminal 2: Backend (port 8765)
FIREBASE_SERVICE_ACCOUNT_KEY=/path/to/service-account-key.json uvicorn api.main:app --port 8765 --reload
```

Open http://localhost:3000

## Features

### Library (`/library`)
- Card grid and list view with toggle (persisted preference)
- Search and filter by status/source
- Drag-and-drop file upload
- Delete songs
- Auto-refresh while songs are processing

### Upload (`/upload`)
- Upload MP3/WAV/FLAC/M4A files or paste YouTube URLs
- YouTube thumbnail preview and title auto-fill
- YouTube dedup check (reuses existing analysis if available)
- Optional parameters: tonic, raga, instrument, vocalist gender, song type
- Collapsible advanced options (auto-generated from pipeline CLI schema)

### Results (`/song/[id]`)
- Raga hero with detected raga name and tonic
- Raga context: aroha/avroh from database
- Embedded YouTube player (for YouTube sources)
- Synced audio player with stem toggles (vocals/accompaniment) and speed controls
- Interactive scrolling pitch contour (60fps, sargam grid, note labels, phrase overlays, hover tooltip, click-to-seek)
- Karaoke transcription synced to playback
- Pattern analysis (common motifs, aaroh/avroh runs, conformance checker)
- 25-bin pitch histograms (vocals + accompaniment) with western notation
- CSS transition matrix
- Raga candidates table
- Correction bar: change tonic/raga and re-analyze with full advanced options
- Timestamped comments with threading

### Explore (`/explore`)
- Browse all public analyses
- Search, sort (recent/viewed), filter by song type

### Transcript Editor (`/song/[id]/edit`)
- Synced pitch contour + audio player
- Editable note grid with seek-on-click

### Community Features
- Fork public songs with different parameters
- Public/private visibility toggle
- Timestamped comments (click to seek audio)

## Pipeline

The `raga_pipeline/` directory contains the detection and analysis pipeline. Key modules:

| Module | Role |
|---|---|
| `config.py` | CLI parser, `PipelineConfig` dataclass |
| `audio.py` | Stem separation (Demucs), pitch extraction (SwiftF0) |
| `analysis.py` | Histogram construction, peak detection, GMM fitting |
| `raga.py` | Raga database, scoring algorithm |
| `transcription.py` | Note detection, stationary point analysis |
| `sequence.py` | Phrase segmentation, motif detection |
| `output.py` | Report generation |
| `cli_schema.py` | Schema introspection for dynamic UI generation |
