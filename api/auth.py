"""Firebase ID token verification middleware for FastAPI."""

import os
from typing import Optional

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials
from fastapi import Depends, HTTPException, Request

_cred_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
if _cred_path:
    _cred = credentials.Certificate(_cred_path)
else:
    _cred = credentials.ApplicationDefault()

if not firebase_admin._apps:
    firebase_admin.initialize_app(_cred)


def _extract_token(request: Request) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return None


async def get_current_user(request: Request) -> dict:
    """Dependency that verifies Firebase ID token and returns user info.
    Raises 401 if token is missing or invalid."""
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    try:
        decoded = firebase_auth.verify_id_token(token)
        return decoded
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authentication token")


async def get_optional_user(request: Request) -> Optional[dict]:
    """Returns user info if authenticated, None otherwise."""
    token = _extract_token(request)
    if not token:
        return None
    try:
        return firebase_auth.verify_id_token(token)
    except Exception:
        return None
