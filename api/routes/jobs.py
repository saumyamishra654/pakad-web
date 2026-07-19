"""Job status routes."""
from fastapi import APIRouter, Depends, HTTPException
from api.auth import get_current_user
from api import jobs

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}")
async def get_job_status(job_id: str, user: dict = Depends(get_current_user)):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# Separate router (still exported from this module per Plan 011 Step 5) for
# POST /api/songs/{song_id}/audio-job -- mounted under the songs prefix so the
# route lives at the right URL despite this module's own /api/jobs prefix.
audio_job_router = APIRouter(prefix="/api/songs/{song_id}", tags=["jobs"])


@audio_job_router.post("/audio-job")
async def request_audio_job(song_id: str, user: dict = Depends(get_current_user)):
    """Regenerate audio for an already-analyzed song, delivered to the
    requesting user's device only (Plan 011). Runs a separation-only job:
    detect/analyze are skipped since the canonical analysis is cached.
    """
    from api.firestore_client import get_song, get_canonical_analysis

    song = get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song.get("visibility") == "private" and user["uid"] != song.get("uploadedBy"):
        raise HTTPException(status_code=403, detail="Access denied")

    canonical = get_canonical_analysis(song_id)
    if not canonical:
        raise HTTPException(status_code=400, detail="No analysis found for this song")

    job_id = jobs.submit_job(song_id, canonical["id"], user["uid"], {"mode": "audio_only"})
    return {"jobId": job_id, "status": "processing"}
