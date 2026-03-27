"""Explore feed: public song archive with search, sort, filter."""
from fastapi import APIRouter, Query
from typing import Optional
from api import firestore_client

router = APIRouter(prefix="/api/explore", tags=["explore"])


@router.get("")
async def explore_songs(
    order_by: str = Query("createdAt", description="Sort field"),
    song_type: Optional[str] = Query(None, description="Filter by song type"),
    limit: int = Query(50, description="Max results"),
):
    """List public songs for the explore feed."""
    songs = firestore_client.list_public_songs(
        order_by=order_by, song_type=song_type, limit=limit,
    )
    return {"songs": songs}
