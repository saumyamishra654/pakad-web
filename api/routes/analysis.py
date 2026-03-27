"""Analysis routes: get results, re-analyze, fork."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from api.auth import get_current_user, get_optional_user
from api.schemas import ReanalyzeRequest

router = APIRouter(prefix="/api/songs/{song_id}/analysis", tags=["analysis"])

@router.get("")
async def get_analysis(song_id: str, user: Optional[dict] = Depends(get_optional_user)):
    from api.firestore_client import get_song, get_canonical_analysis
    song = get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song["visibility"] == "private":
        if not user or user["uid"] != song["uploadedBy"]:
            raise HTTPException(status_code=403, detail="Access denied")
    analysis = get_canonical_analysis(song_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="No analysis found")
    return analysis

@router.post("/reanalyze")
async def reanalyze(song_id: str, request: ReanalyzeRequest, user: dict = Depends(get_current_user)):
    from api.firestore_client import get_song, get_canonical_analysis, create_analysis
    song = get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    canonical = get_canonical_analysis(song_id)
    if not canonical:
        raise HTTPException(status_code=400, detail="No canonical analysis to fork from")
    analysis_id = create_analysis(
        song_id=song_id, analysis_type="fork", owner_id=user["uid"],
        params={"tonic": request.tonic, "raga": request.raga, "instrument": request.instrument, "vocalistGender": request.vocalist_gender},
        parent_analysis_id=canonical["id"],
    )
    return {"analysisId": analysis_id, "status": "processing"}
