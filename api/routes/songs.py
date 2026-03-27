"""Song CRUD routes: list, get, upload, YouTube dedup check."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import Optional
from api.auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/songs", tags=["songs"])

@router.get("")
async def list_songs(user: dict = Depends(get_current_user)):
    from api.firestore_client import list_user_songs
    songs = list_user_songs(user["uid"])
    return {"songs": songs}

@router.get("/{song_id}")
async def get_song(song_id: str, user: Optional[dict] = Depends(get_optional_user)):
    from api.firestore_client import get_song as fs_get_song
    song = fs_get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song["visibility"] == "private":
        if not user or user["uid"] != song["uploadedBy"]:
            raise HTTPException(status_code=403, detail="Access denied")
    return song

@router.patch("/{song_id}/visibility")
async def update_visibility(song_id: str, user: dict = Depends(get_current_user)):
    """Toggle song visibility between public and private. Owner only."""
    from api.firestore_client import get_song as fs_get_song, update_song as fs_update_song
    song = fs_get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song["uploadedBy"] != user["uid"]:
        raise HTTPException(status_code=403, detail="Only the owner can change visibility")
    new_visibility = "private" if song["visibility"] == "public" else "public"
    fs_update_song(song_id, visibility=new_visibility)
    return {"visibility": new_visibility}

@router.delete("/{song_id}")
async def delete_song(song_id: str, user: dict = Depends(get_current_user)):
    """Delete a song and its Firestore data. Only the owner can delete."""
    from api.firestore_client import get_song as fs_get_song, get_db
    song = fs_get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song["uploadedBy"] != user["uid"]:
        raise HTTPException(status_code=403, detail="Only the owner can delete this song")
    db = get_db()
    # Delete subcollections (analyses, comments)
    for sub in ["analyses", "comments"]:
        docs = db.collection("songs").document(song_id).collection(sub).get()
        for doc in docs:
            doc.reference.delete()
    # Delete the song document
    db.collection("songs").document(song_id).delete()
    return {"deleted": True}

@router.get("/youtube/check/{video_id}")
async def check_youtube_exists(video_id: str):
    from api.firestore_client import find_song_by_youtube_id
    existing = find_song_by_youtube_id(video_id)
    if existing:
        return {"exists": True, "songId": existing["id"], "title": existing["title"]}
    # Fetch title from YouTube for new videos
    title = _fetch_youtube_title(video_id)
    return {"exists": False, "title": title}


def _fetch_youtube_title(video_id: str) -> Optional[str]:
    """Fetch video title from YouTube using yt-dlp (no download)."""
    import subprocess, json
    try:
        result = subprocess.run(
            ["yt-dlp", "--dump-json", "--no-download", f"https://youtube.com/watch?v={video_id}"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            return data.get("title")
    except Exception:
        pass
    return None

@router.post("/upload-file")
async def upload_file(
    title: str = Form(...), visibility: str = Form("private"),
    song_type: Optional[str] = Form(None), tonic: Optional[str] = Form(None),
    raga: Optional[str] = Form(None), instrument: str = Form("vocal"),
    vocalist_gender: Optional[str] = Form(None),
    file: UploadFile = File(...), user: dict = Depends(get_current_user),
):
    import hashlib
    from api import storage, firestore_client
    content = await file.read()
    audio_hash = hashlib.sha256(content).hexdigest()[:16]
    song_id = firestore_client.create_song(
        title=title, source="file", uploaded_by=user["uid"],
        audio_hash=audio_hash, visibility=visibility, song_type=song_type,
    )
    filename = file.filename or f"{song_id}.mp3"
    rel_path = storage.upload_path(user["uid"], song_id, filename)
    storage.write_file(rel_path, content)
    analysis_id = firestore_client.create_analysis(
        song_id=song_id, analysis_type="canonical", owner_id=user["uid"],
        params={"tonic": tonic, "raga": raga, "instrument": instrument, "vocalistGender": vocalist_gender},
    )
    from api.jobs import submit_job
    job_id = submit_job(song_id, analysis_id, user["uid"], {
        "tonic": tonic, "raga": raga, "instrument": instrument, "vocalistGender": vocalist_gender,
    })
    return {"songId": song_id, "analysisId": analysis_id, "jobId": job_id, "status": "processing"}

@router.post("/upload-youtube")
async def upload_youtube(
    title: str = Form(...), youtube_url: str = Form(...),
    song_type: Optional[str] = Form(None), tonic: Optional[str] = Form(None),
    raga: Optional[str] = Form(None), instrument: str = Form("vocal"),
    vocalist_gender: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    import re
    from api import firestore_client
    match = re.search(r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})", youtube_url)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")
    video_id = match.group(1)
    existing = firestore_client.find_song_by_youtube_id(video_id)
    if existing:
        analysis_id = firestore_client.create_analysis(
            song_id=existing["id"], analysis_type="fork", owner_id=user["uid"],
            params={"tonic": tonic, "raga": raga, "instrument": instrument, "vocalistGender": vocalist_gender},
        )
        from api.jobs import submit_job
        job_id = submit_job(existing["id"], analysis_id, user["uid"], {
            "tonic": tonic, "raga": raga, "instrument": instrument, "vocalistGender": vocalist_gender,
        })
        return {"songId": existing["id"], "analysisId": analysis_id, "jobId": job_id, "status": "processing", "reusedExisting": True}
    audio_hash = f"yt_{video_id}"
    song_id = firestore_client.create_song(
        title=title, source="youtube", uploaded_by=user["uid"],
        audio_hash=audio_hash, youtube_video_id=video_id,
        visibility="public", song_type=song_type,
    )
    analysis_id = firestore_client.create_analysis(
        song_id=song_id, analysis_type="canonical", owner_id=user["uid"],
        params={"tonic": tonic, "raga": raga, "instrument": instrument, "vocalistGender": vocalist_gender},
    )
    from api.jobs import submit_job
    job_id = submit_job(song_id, analysis_id, user["uid"], {
        "tonic": tonic, "raga": raga, "instrument": instrument, "vocalistGender": vocalist_gender,
    })
    return {"songId": song_id, "analysisId": analysis_id, "jobId": job_id, "status": "processing"}
