"""Multi-user FastAPI backend for the Raga Detection web app."""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from api.routes import songs, analysis, artifacts, jobs, results, explore, comments, transcription, schema

app = FastAPI(title="Raga Detection API", version="1.0.0", description="Multi-user raga detection and analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(songs.router)
app.include_router(analysis.router)
app.include_router(artifacts.router)
app.include_router(jobs.router)
app.include_router(results.router)
app.include_router(explore.router)
app.include_router(comments.router)
app.include_router(transcription.router)
app.include_router(schema.router)

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/api/ragas")
async def list_ragas():
    import json
    from pathlib import Path
    # Prefer ragas from the trained LM model (30 CompMusic ragas)
    model_path = Path(__file__).parent.parent / "raga_pipeline" / "models" / "compmusic_ngram_model.json"
    if model_path.exists():
        with open(model_path) as f:
            model = json.load(f)
        return {"ragas": sorted(model.get("ragas", {}).keys())}
    # Fallback to full CSV
    import csv
    csv_path = Path(__file__).parent.parent / "data" / "raga_list.csv"
    if not csv_path.exists():
        return {"ragas": []}
    ragas = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("raga_name") or row.get("name") or ""
            if name:
                ragas.append(name)
    return {"ragas": sorted(set(ragas))}

@app.get("/api/tanpura-tracks")
async def tanpura_tracks():
    from raga_pipeline.audio import list_tanpura_tracks
    tracks = list_tanpura_tracks(require_exists=True)
    return {"tracks": [{"key": t["key"], "label": t["label"]} for t in tracks]}

@app.get("/api/tanpura-audio/{key}")
async def tanpura_audio(key: str):
    from raga_pipeline.audio import resolve_tanpura_track_path
    try:
        path = resolve_tanpura_track_path(key, require_exists=True)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    return FileResponse(path, media_type="audio/mpeg")
