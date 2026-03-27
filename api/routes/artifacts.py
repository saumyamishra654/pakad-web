"""Artifact serving routes: audio files, pitch data, analysis data."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from typing import Optional
from api.auth import get_optional_user
from api import storage

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])

@router.get("/audio/{song_id}/{filename}")
async def get_audio(song_id: str, filename: str, user: Optional[dict] = Depends(get_optional_user)):
    from api.firestore_client import get_song
    song = get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    audio_hash = song.get("audioHash", "")
    rel_path = f"{storage.artifact_dir(audio_hash)}/{filename}"
    if storage.file_exists(rel_path):
        return FileResponse(str(storage.get_absolute_path(rel_path)), media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="Audio file not found")

@router.get("/pitch-data/{song_id}")
async def get_pitch_data(song_id: str, stem: str = "vocals", user: Optional[dict] = Depends(get_optional_user)):
    from api.firestore_client import get_song
    song = get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    audio_hash = song.get("audioHash", "")
    csv_path = f"{storage.artifact_dir(audio_hash)}/{stem}_pitch_data.csv"
    if not storage.file_exists(csv_path):
        raise HTTPException(status_code=404, detail="Pitch data not found")
    import csv, io
    raw = storage.read_file(csv_path)
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8")))
    points = []
    for row in reader:
        points.append({"time": float(row.get("time", 0)), "frequency": float(row.get("frequency", 0)), "confidence": float(row.get("confidence", 0))})
    return {"stem": stem, "points": points}

@router.get("/analysis-data/{song_id}/{analysis_id}/{filename}")
async def get_analysis_data(song_id: str, analysis_id: str, filename: str, user: Optional[dict] = Depends(get_optional_user)):
    rel_path = f"{storage.analysis_dir(analysis_id)}/{filename}"
    if not storage.file_exists(rel_path):
        raise HTTPException(status_code=404, detail="Analysis data not found")
    raw = storage.read_file(rel_path)
    if filename.endswith(".json"):
        import json
        return JSONResponse(content=json.loads(raw))
    elif filename.endswith(".csv"):
        return FileResponse(str(storage.get_absolute_path(rel_path)), media_type="text/csv")
    raise HTTPException(status_code=400, detail="Unsupported file type")
