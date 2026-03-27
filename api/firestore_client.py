"""Firestore client helpers for reading and writing song/analysis/comment data."""

import os
from datetime import datetime
from typing import Optional
import uuid

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.oauth2 import service_account

_db: Optional[firestore.Client] = None


def get_db() -> firestore.Client:
    """Get or create the Firestore client using the Firebase service account."""
    global _db
    if _db is None:
        cred_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
        if cred_path:
            creds = service_account.Credentials.from_service_account_file(cred_path)
            _db = firestore.Client(credentials=creds, project=creds.project_id)
        else:
            _db = firestore.Client()
    return _db


def create_song(
    title: str, source: str, uploaded_by: str, audio_hash: str,
    youtube_video_id: Optional[str] = None, visibility: str = "private",
    song_type: Optional[str] = None,
) -> str:
    db = get_db()
    song_id = str(uuid.uuid4())
    db.collection("songs").document(song_id).set({
        "title": title, "source": source, "youtubeVideoId": youtube_video_id,
        "audioHash": audio_hash, "uploadedBy": uploaded_by,
        "visibility": visibility, "status": "processing",
        "songType": song_type, "createdAt": datetime.utcnow(),
        "viewCount": 0, "commentCount": 0,
    })
    return song_id


def get_song(song_id: str) -> Optional[dict]:
    db = get_db()
    doc = db.collection("songs").document(song_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    data["id"] = doc.id
    return data


def update_song(song_id: str, **fields) -> None:
    db = get_db()
    db.collection("songs").document(song_id).update(fields)


def find_song_by_youtube_id(video_id: str) -> Optional[dict]:
    db = get_db()
    docs = (
        db.collection("songs")
        .where(filter=FieldFilter("youtubeVideoId", "==", video_id))
        .where(filter=FieldFilter("visibility", "==", "public"))
        .limit(1)
        .get()
    )
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        return data
    return None


def list_user_songs(user_id: str) -> list[dict]:
    db = get_db()
    docs = (
        db.collection("songs")
        .where(filter=FieldFilter("uploadedBy", "==", user_id))
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .get()
    )
    results = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        results.append(data)
    return results


def list_public_songs(
    order_by: str = "createdAt", song_type: Optional[str] = None, limit: int = 50,
) -> list[dict]:
    db = get_db()
    query = db.collection("songs").where(filter=FieldFilter("visibility", "==", "public"))
    if song_type:
        query = query.where(filter=FieldFilter("songType", "==", song_type))
    query = query.order_by(order_by, direction=firestore.Query.DESCENDING).limit(limit)
    docs = query.get()
    results = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        results.append(data)
    return results


def create_analysis(
    song_id: str, analysis_type: str, owner_id: str, params: dict,
    parent_analysis_id: Optional[str] = None,
) -> str:
    db = get_db()
    analysis_id = str(uuid.uuid4())
    db.collection("songs").document(song_id).collection("analyses").document(
        analysis_id
    ).set({
        "type": analysis_type, "ownerId": owner_id,
        "parentAnalysisId": parent_analysis_id, "params": params,
        "results": None, "artifactPaths": {}, "status": "processing",
        "createdAt": datetime.utcnow(),
    })
    return analysis_id


def get_analysis(song_id: str, analysis_id: str) -> Optional[dict]:
    db = get_db()
    doc = (
        db.collection("songs").document(song_id)
        .collection("analyses").document(analysis_id).get()
    )
    if not doc.exists:
        return None
    data = doc.to_dict()
    data["id"] = doc.id
    data["songId"] = song_id
    return data


def update_analysis(song_id: str, analysis_id: str, **fields) -> None:
    db = get_db()
    (
        db.collection("songs").document(song_id)
        .collection("analyses").document(analysis_id).update(fields)
    )


def get_canonical_analysis(song_id: str) -> Optional[dict]:
    db = get_db()
    # Try moderator first
    docs = (
        db.collection("songs").document(song_id)
        .collection("analyses").where(filter=FieldFilter("type", "==", "moderator"))
        .limit(1).get()
    )
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        data["songId"] = song_id
        return data
    # Fall back to canonical
    docs = (
        db.collection("songs").document(song_id)
        .collection("analyses").where(filter=FieldFilter("type", "==", "canonical"))
        .limit(1).get()
    )
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        data["songId"] = song_id
        return data
    return None


def create_comment(
    song_id: str, author_id: str, author_name: str, text: str,
    timestamp_seconds: float, parent_comment_id: Optional[str] = None,
) -> str:
    db = get_db()
    comment_id = str(uuid.uuid4())
    db.collection("songs").document(song_id).collection("comments").document(
        comment_id
    ).set({
        "authorId": author_id, "authorName": author_name, "text": text,
        "timestampSeconds": timestamp_seconds,
        "parentCommentId": parent_comment_id, "createdAt": datetime.utcnow(),
    })
    db.collection("songs").document(song_id).update({
        "commentCount": firestore.Increment(1)
    })
    return comment_id


def list_comments(song_id: str) -> list[dict]:
    db = get_db()
    docs = (
        db.collection("songs").document(song_id)
        .collection("comments").order_by("timestampSeconds").get()
    )
    results = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        data["songId"] = song_id
        results.append(data)
    return results
