"""Pydantic models for API request and response bodies."""
from typing import Optional
from pydantic import BaseModel

class UploadRequest(BaseModel):
    title: str
    source: str
    youtube_url: Optional[str] = None
    visibility: str = "private"
    song_type: Optional[str] = None
    tonic: Optional[str] = None
    raga: Optional[str] = None
    instrument: str = "vocal"
    vocalist_gender: Optional[str] = None

class ReanalyzeRequest(BaseModel):
    tonic: Optional[str] = None
    raga: Optional[str] = None
    instrument: str = "vocal"
    vocalist_gender: Optional[str] = None

class CommentRequest(BaseModel):
    text: str
    timestamp_seconds: float
    parent_comment_id: Optional[str] = None

class SongResponse(BaseModel):
    id: str
    title: str
    source: str
    youtube_video_id: Optional[str]
    visibility: str
    status: str
    song_type: Optional[str]
    view_count: int
    comment_count: int

class JobResponse(BaseModel):
    job_id: str
    song_id: str
    analysis_id: str
    status: str
