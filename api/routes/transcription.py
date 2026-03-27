"""Transcription editing routes."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel
from api.auth import get_current_user, get_optional_user
from api import firestore_client

class TranscriptionSave(BaseModel):
    notes: list[dict]
    phrases: list[dict]

router = APIRouter(prefix="/api/songs/{song_id}/transcription", tags=["transcription"])

@router.get("")
async def get_transcription(song_id: str, user: Optional[dict] = Depends(get_optional_user)):
    """Get the current transcription from the results endpoint data."""
    from api.routes.results import _find_artifact_dir, _read_csv_rows
    song = firestore_client.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    audio_hash = song.get("audioHash", "")
    art_dir = _find_artifact_dir(audio_hash)
    rows = _read_csv_rows(f"{art_dir}/transcribed_notes.csv")
    notes = []
    for row in rows:
        notes.append({
            "start": float(row.get("start", 0)),
            "end": float(row.get("end", 0)),
            "duration": float(row.get("duration", 0)),
            "sargam": row.get("sargam", ""),
            "pitchMidi": float(row.get("pitch_midi", 0)),
            "pitchHz": float(row.get("pitch_hz", 0)),
            "energy": float(row.get("energy", 0)),
        })
    return {"notes": notes}

@router.get("/edits")
async def list_edits(song_id: str, user: dict = Depends(get_current_user)):
    """List user's saved transcription edits for this song."""
    db = firestore_client.get_db()
    docs = (
        db.collection("songs").document(song_id)
        .collection("transcriptionEdits")
        .where("ownerId", "==", user["uid"])
        .order_by("createdAt")
        .get()
    )
    edits = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        edits.append(data)
    return {"edits": edits}

@router.post("/edits")
async def save_edit(song_id: str, body: TranscriptionSave, user: dict = Depends(get_current_user)):
    """Save a new transcription edit version."""
    import uuid
    from datetime import datetime
    db = firestore_client.get_db()
    edit_id = str(uuid.uuid4())
    db.collection("songs").document(song_id).collection("transcriptionEdits").document(edit_id).set({
        "ownerId": user["uid"],
        "notes": body.notes,
        "phrases": body.phrases,
        "createdAt": datetime.utcnow(),
    })
    return {"editId": edit_id}

@router.delete("/edits/{edit_id}")
async def delete_edit(song_id: str, edit_id: str, user: dict = Depends(get_current_user)):
    """Delete a transcription edit."""
    db = firestore_client.get_db()
    doc_ref = db.collection("songs").document(song_id).collection("transcriptionEdits").document(edit_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Edit not found")
    if doc.to_dict().get("ownerId") != user["uid"]:
        raise HTTPException(status_code=403, detail="Not your edit")
    doc_ref.delete()
    return {"deleted": True}
