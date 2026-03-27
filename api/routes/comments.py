"""Timestamped comment routes."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from api.auth import get_current_user, get_optional_user
from api import firestore_client
from pydantic import BaseModel


class CommentCreate(BaseModel):
    text: str
    timestamp_seconds: float
    parent_comment_id: Optional[str] = None


router = APIRouter(prefix="/api/songs/{song_id}/comments", tags=["comments"])


@router.get("")
async def list_comments(song_id: str, user: Optional[dict] = Depends(get_optional_user)):
    song = firestore_client.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song["visibility"] == "private":
        if not user or user["uid"] != song["uploadedBy"]:
            raise HTTPException(status_code=403, detail="Access denied")
    comments = firestore_client.list_comments(song_id)
    return {"comments": comments}


@router.post("")
async def create_comment(song_id: str, body: CommentCreate, user: dict = Depends(get_current_user)):
    song = firestore_client.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    comment_id = firestore_client.create_comment(
        song_id=song_id,
        author_id=user["uid"],
        author_name=user.get("name") or user.get("email", "Anonymous"),
        text=body.text,
        timestamp_seconds=body.timestamp_seconds,
        parent_comment_id=body.parent_comment_id,
    )
    return {"commentId": comment_id}
