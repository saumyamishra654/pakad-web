"""Multi-user FastAPI backend for the Raga Detection web app."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import songs, analysis, artifacts, jobs, results, explore, comments, transcription

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

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/api/ragas")
async def list_ragas():
    import csv
    from pathlib import Path
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
