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


def _gaussian_smooth(values: list[float], sigma: float = 0.8) -> list[float]:
    """Apply circular Gaussian smoothing to a 1D list (wraps at octave boundary)."""
    import math
    n = len(values)
    if n == 0:
        return []
    radius = max(1, int(3 * sigma))
    kernel = [math.exp(-0.5 * (x / sigma) ** 2) for x in range(-radius, radius + 1)]
    k_sum = sum(kernel)
    kernel = [k / k_sum for k in kernel]
    result = []
    for i in range(n):
        total = 0.0
        for j, k in enumerate(kernel):
            idx = (i + j - radius) % n  # circular wrap
            total += values[idx] * k
        result.append(total)
    return result


def _find_pitch_csv(art_dir: str, stem: str) -> Optional[str]:
    """Find pitch data CSV, trying with and without extractor suffix."""
    for name in [f"{stem}_pitch_data.csv", f"{stem}_pitch_data_swiftf0.csv"]:
        path = f"{art_dir}/{name}"
        if Path(path).exists():
            return path
    return None


def _compute_dual_histogram(pitch_csv_path: str, min_confidence: float = 0.5, bias_cents: float = 0.0) -> dict:
    """Compute dual-resolution smoothed histograms from raw pitch data CSV.

    Returns {highRes: [...], lowRes: [...]} with raw and smoothed weights.
    High-res: 100 bins (12 cents each). Low-res: 33 bins (~36 cents each).
    """
    import math
    NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    empty = {"highRes": [], "lowRes": []}

    if not pitch_csv_path or not Path(pitch_csv_path).exists():
        return empty

    rows = _read_csv_rows(pitch_csv_path, max_rows=100000)
    if not rows:
        return empty

    cent_values = []
    for row in rows:
        hz = float(row.get("pitch_hz", 0))
        conf = float(row.get("confidence", 0))
        if hz > 0 and conf >= min_confidence:
            midi = 12 * math.log2(hz / 440) + 69
            cents = ((midi % 12) * 100.0 - bias_cents) % 1200.0
            cent_values.append(cents)

    if not cent_values:
        return empty

    # High-res: 100 bins, 12 cents each
    high_n = 100
    high_w = 1200.0 / high_n
    high_hist = [0.0] * high_n
    for c in cent_values:
        high_hist[min(int(c / high_w), high_n - 1)] += 1
    high_total = sum(high_hist) or 1
    high_hist = [h / high_total for h in high_hist]
    high_smoothed = _gaussian_smooth(high_hist, sigma=0.8)

    # Low-res: 33 bins, ~36.4 cents each
    low_n = 33
    low_w = 1200.0 / low_n
    low_hist = [0.0] * low_n
    for c in cent_values:
        low_hist[min(int(c / low_w), low_n - 1)] += 1
    low_total = sum(low_hist) or 1
    low_hist = [l / low_total for l in low_hist]
    low_smoothed = _gaussian_smooth(low_hist, sigma=0.8)

    high_res = []
    for i in range(high_n):
        high_res.append({
            "cents": round((i + 0.5) * high_w, 1),
            "weight": round(high_hist[i], 6),
            "smoothed": round(high_smoothed[i], 6),
        })

    low_res = []
    for i in range(low_n):
        center = (i + 0.5) * low_w
        note_idx = int(round(center / 100)) % 12
        low_res.append({
            "cents": round(center, 1),
            "weight": round(low_hist[i], 6),
            "smoothed": round(low_smoothed[i], 6),
            "label": NOTE_NAMES[note_idx],
        })

    return {"highRes": high_res, "lowRes": low_res}


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


_SARGAM_ORDER = {
    'Sa': 0, 're': 1, 'Re': 2, 'ga': 3, 'Ga': 4,
    'ma': 5, 'Ma': 6, 'Pa': 7, 'dha': 8, 'Dha': 9,
    'ni': 10, 'Ni': 11,
}

def _compute_transition_matrix(transcription: list[dict]) -> dict:
    """Build a note-to-note transition count matrix from transcription rows."""
    unique = set(
        n["sargam"].rstrip("\u00b7").rstrip("'").rstrip(",")
        for n in transcription
        if n.get("sargam")
    )
    sargam_notes = sorted(unique, key=lambda s: _SARGAM_ORDER.get(s, 99))
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

    # -- Histogram candidates (always from candidates.csv) --
    histogram_candidates = []
    candidates_raw = _read_csv_rows(f"{art_dir}/candidates.csv")
    for row in candidates_raw[:20]:
        histogram_candidates.append({
            "raga": row.get("raga", ""),
            "tonic": row.get("tonic_name", ""),
            "score": float(row.get("fit_score", 0)),
            "rank": int(row.get("rank", 0)),
        })

    # -- LM-reranked candidates (combined histogram + LM scoring) --
    candidates = []
    lm_candidates_raw = _read_csv_rows(f"{art_dir}/lm_candidates.csv")
    if lm_candidates_raw:
        for row in lm_candidates_raw:
            score = float(row.get("combined_score", -999))
            if score <= -900:
                continue
            candidates.append({
                "raga": row.get("raga", ""),
                "tonic": row.get("tonic_name", ""),
                "score": round(score, 4),
                "rank": int(row.get("lm_rank", 0)),
            })
        candidates = candidates[:20]
    else:
        candidates = histogram_candidates

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
        detected.get("selected_raga")
        or detected.get("top_raga")
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

    # -- Original audio (file uploads only, not YouTube) --
    if song.get("source") != "youtube":
        uploaded_by = song.get("uploadedBy", "")
        upload_base = storage.upload_dir(uploaded_by, song_id)
        for ext in ["*.mp3", "*.wav", "*.flac", "*.m4a"]:
            original_files = storage.list_files(upload_base, ext)
            if original_files:
                stems["original"] = f"/api/results/{song_id}/audio/original"
                break

    # -- Pitch histograms (dual-resolution, smoothed, bias-corrected) --
    bias_cents = detected.get("gmm_bias_cents") or 0.0
    vocals_csv = _find_pitch_csv(art_dir, "vocals")
    accomp_csv = _find_pitch_csv(art_dir, "accompaniment")
    vocals_histogram = _compute_dual_histogram(vocals_csv, bias_cents=bias_cents)
    accompaniment_histogram = _compute_dual_histogram(accomp_csv, bias_cents=bias_cents)

    # -- Transition matrix --
    transition_matrix = _compute_transition_matrix(transcription)

    # -- Analysis stats (correction summary, pattern analysis) from meta JSON --
    analysis_stats = analysis_meta.get("stats", {})
    correction_summary = analysis_stats.get("correction_summary", {})
    pattern_analysis = analysis_stats.get("pattern_analysis", {})

    return {
        "song": {
            "id": song.get("id"),
            "title": song.get("title"),
            "source": song.get("source"),
            "youtubeVideoId": song.get("youtubeVideoId"),
            "createdAt": str(song.get("createdAt", "")),
            "uploadedBy": song.get("uploadedBy"),
            "visibility": song.get("visibility", "private"),
        },
        "detection": {
            "raga": detected.get("selected_raga") or detected.get("top_raga"),
            "tonic": detected.get("top_tonic_name"),
            "tonicMidi": detected.get("selected_tonic") or detected.get("top_tonic"),
            "confidence": detected.get("confidence"),
        },
        "ragaInfo": raga_info,
        "candidates": candidates,
        "histogramCandidates": histogram_candidates,
        "transcription": transcription,
        "images": images,
        "stems": stems,
        "vocalsHistogram": vocals_histogram,
        "accompanimentHistogram": accompaniment_histogram,
        "transitionMatrix": transition_matrix,
        "correctionSummary": correction_summary,
        "patternAnalysis": pattern_analysis,
    }


@router.get("/{song_id}/audio/{filename}")
async def get_audio_file(
    song_id: str,
    filename: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    """Serve a stem audio file (e.g. vocals.mp3, accompaniment.mp3, or original)."""
    from fastapi.responses import FileResponse

    song = firestore_client.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    # Handle "original" — serve from uploads dir
    if filename == "original":
        uploaded_by = song.get("uploadedBy", "")
        upload_base = storage.upload_dir(uploaded_by, song_id)
        for ext in ["*.mp3", "*.wav", "*.flac", "*.m4a"]:
            files = storage.list_files(upload_base, ext)
            if files:
                return FileResponse(
                    str(storage.get_absolute_path(files[0])),
                    media_type="audio/mpeg",
                )
        raise HTTPException(status_code=404, detail="Original audio not found")

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
    # Map "original" to "composite" pitch data
    csv_stem = "composite" if stem == "original" else stem
    csv_file = _find_pitch_csv(art_dir, csv_stem)
    if not csv_file:
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
