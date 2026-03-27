"""Results endpoint: serves all analysis data for a song as structured JSON."""

import csv
import io
import json
import glob
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from api.auth import get_optional_user
from api import storage, firestore_client

router = APIRouter(prefix="/api/results", tags=["results"])


def _read_csv_rows(filepath: str, max_rows: int = 5000) -> list[dict]:
    try:
        raw = Path(filepath).read_text()
        reader = csv.DictReader(io.StringIO(raw))
        return [row for i, row in enumerate(reader) if i < max_rows]
    except Exception:
        return []


def _read_json(filepath: str) -> Optional[dict]:
    try:
        return json.loads(Path(filepath).read_text())
    except Exception:
        return None


def _find_artifact_dir(audio_hash: str) -> Optional[str]:
    """Locate the deepest artifact directory containing detection results.

    The pipeline outputs into a nested structure like:
      .local_app_data/artifacts/{audio_hash}/htdemucs/audio/
    We glob for detection_report.meta.json and return its parent directory.
    Falls back to the base artifact dir if no meta file is found.
    """
    relative = storage.artifact_dir(audio_hash)
    try:
        base = str(storage.get_absolute_path(relative))
    except FileNotFoundError:
        # The artifact dir itself may not exist yet
        base = str(storage.STORAGE_ROOT / relative)
    nested = glob.glob(f"{base}/**/detection_report.meta.json", recursive=True)
    if nested:
        return str(Path(nested[0]).parent)
    return base


def _get_raga_info(raga_name: str) -> dict:
    """Look up aroha/avroh for a raga from the CSV database."""
    if not raga_name:
        return {}
    csv_path = Path(__file__).parent.parent.parent / "data" / "raga_list.csv"
    if not csv_path.exists():
        return {}
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("raga_name", "").lower() == raga_name.lower():
                return {
                    "name": row.get("raga_name", ""),
                    "aroha": row.get("Aroha", ""),
                    "avroh": row.get("Avroh", ""),
                }
    return {"name": raga_name}


def _compute_transition_matrix(transcription: list[dict]) -> dict:
    """Build a note-to-note transition count matrix from transcription rows."""
    sargam_notes = sorted(
        set(
            n["sargam"].rstrip("\u00b7").rstrip("'").rstrip(",")
            for n in transcription
            if n.get("sargam")
        )
    )
    if not sargam_notes:
        return {"notes": [], "matrix": []}
    matrix = [[0] * len(sargam_notes) for _ in range(len(sargam_notes))]
    note_index = {n: i for i, n in enumerate(sargam_notes)}
    prev = None
    for n in transcription:
        clean = n["sargam"].rstrip("\u00b7").rstrip("'").rstrip(",")
        if clean in note_index:
            if prev is not None and prev in note_index:
                matrix[note_index[prev]][note_index[clean]] += 1
            prev = clean
    return {"notes": sargam_notes, "matrix": matrix}


@router.get("/{song_id}")
async def get_results(
    song_id: str, user: Optional[dict] = Depends(get_optional_user)
):
    """Return all analysis data for a song as a single JSON payload."""
    song = firestore_client.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song.get("visibility") == "private":
        if not user or user["uid"] != song.get("uploadedBy"):
            raise HTTPException(status_code=403, detail="Access denied")

    audio_hash = song.get("audioHash", "")
    art_dir = _find_artifact_dir(audio_hash)

    # -- Detection metadata --
    detect_meta = _read_json(f"{art_dir}/detection_report.meta.json") or {}
    detected = detect_meta.get("detected", {})
    analysis_meta = _read_json(f"{art_dir}/analysis_report.meta.json") or {}

    # -- Candidates --
    candidates_raw = _read_csv_rows(f"{art_dir}/candidates.csv")
    candidates = []
    for row in candidates_raw[:20]:
        candidates.append({
            "raga": row.get("raga", ""),
            "tonic": row.get("tonic_name", ""),
            "score": float(row.get("fit_score", 0)),
            "rank": int(row.get("rank", 0)),
        })

    # -- Transcription --
    notes_raw = _read_csv_rows(f"{art_dir}/transcribed_notes.csv")
    transcription = []
    for row in notes_raw:
        transcription.append({
            "start": float(row.get("start", 0)),
            "end": float(row.get("end", 0)),
            "duration": float(row.get("duration", 0)),
            "sargam": row.get("sargam", ""),
            "pitchMidi": float(row.get("pitch_midi", 0)),
            "pitchHz": float(row.get("pitch_hz", 0)),
            "energy": float(row.get("energy", 0)),
        })

    # -- Raga info from database --
    raga_name = (
        detected.get("top_raga")
        or detected.get("selected_raga")
        or ""
    )
    raga_info = _get_raga_info(raga_name)

    # -- Image URLs --
    images = {}
    for name in [
        "histogram_melody",
        "histogram_accompaniment",
        "transition_matrix",
        "pitch_sargam",
        "gmm_overlay",
        "stationary_note_histogram_duration_weighted",
    ]:
        if Path(f"{art_dir}/{name}.png").exists():
            images[name] = f"/api/results/{song_id}/image/{name}.png"

    # -- Stem audio URLs --
    stems = {}
    for stem_name in ["vocals", "accompaniment"]:
        if Path(f"{art_dir}/{stem_name}.mp3").exists():
            stems[stem_name] = f"/api/results/{song_id}/audio/{stem_name}.mp3"

    # -- Histogram data --
    hist_rows = _read_csv_rows(
        f"{art_dir}/stationary_note_histogram_duration_weighted.csv"
    )
    histogram = []
    for row in hist_rows:
        histogram.append({
            "pitchClass": int(row.get("pitch_class", 0)),
            "sargam": row.get("sargam", ""),
            "weight": float(
                row.get("total_duration", 0)
                or row.get("weight", 0)
                or 0
            ),
        })

    # -- Transition matrix --
    transition_matrix = _compute_transition_matrix(transcription)

    return {
        "song": {
            "id": song.get("id"),
            "title": song.get("title"),
            "source": song.get("source"),
            "youtubeVideoId": song.get("youtubeVideoId"),
            "createdAt": str(song.get("createdAt", "")),
        },
        "detection": {
            "raga": detected.get("top_raga"),
            "tonic": detected.get("top_tonic_name"),
            "tonicMidi": detected.get("top_tonic"),
            "confidence": detected.get("confidence"),
        },
        "ragaInfo": raga_info,
        "candidates": candidates,
        "transcription": transcription,
        "images": images,
        "stems": stems,
        "histogram": histogram,
        "transitionMatrix": transition_matrix,
    }


@router.get("/{song_id}/audio/{filename}")
async def get_audio_file(
    song_id: str,
    filename: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    """Serve a stem audio file (e.g. vocals.mp3, accompaniment.mp3)."""
    from fastapi.responses import FileResponse

    song = firestore_client.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    audio_hash = song.get("audioHash", "")
    art_dir = _find_artifact_dir(audio_hash)
    filepath = f"{art_dir}/{filename}"
    if not Path(filepath).exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(filepath, media_type="audio/mpeg")


@router.get("/{song_id}/image/{filename}")
async def get_image_file(
    song_id: str,
    filename: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    """Serve an analysis image (histogram, transition matrix, etc.)."""
    from fastapi.responses import FileResponse

    song = firestore_client.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    audio_hash = song.get("audioHash", "")
    art_dir = _find_artifact_dir(audio_hash)
    filepath = f"{art_dir}/{filename}"
    if not Path(filepath).exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(filepath, media_type="image/png")


@router.get("/{song_id}/pitch/{stem}")
async def get_pitch_data(
    song_id: str,
    stem: str = "vocals",
    user: Optional[dict] = Depends(get_optional_user),
):
    """Return filtered pitch data points for a given stem."""
    song = firestore_client.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    audio_hash = song.get("audioHash", "")
    art_dir = _find_artifact_dir(audio_hash)
    csv_file = f"{art_dir}/{stem}_pitch_data.csv"
    if not Path(csv_file).exists():
        raise HTTPException(
            status_code=404,
            detail=f"Pitch data not found for stem: {stem}",
        )
    rows = _read_csv_rows(csv_file, max_rows=50000)
    points = []
    for row in rows:
        freq = float(row.get("pitch_hz", 0))
        conf = float(row.get("confidence", 0))
        if freq > 0 and conf > 0.5:
            points.append({
                "time": float(row.get("time", 0)),
                "frequency": freq,
                "confidence": conf,
            })
    return {"stem": stem, "points": points, "totalPoints": len(rows)}
