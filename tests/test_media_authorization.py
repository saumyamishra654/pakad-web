"""Authorization tests for media/pitch/image/transcription/artifact endpoints.

Verifies plan 001: private songs are only served to their owner, and filename
path params are validated against an allowlist.
"""

import os
import tempfile

# Isolate storage so no real artifacts are touched.
os.environ.setdefault("STORAGE_ROOT", tempfile.mkdtemp())

import pytest
from fastapi.testclient import TestClient

import api.main
from api import firestore_client
from api.auth import get_optional_user
from api.routes.results import _safe_filename, require_song_access
from fastapi import HTTPException


OWNER = "owner-uid"
OTHER = "other-uid"

PRIVATE_SONG = {"visibility": "private", "uploadedBy": OWNER, "audioHash": "hash123"}
PUBLIC_SONG = {"visibility": "public", "uploadedBy": OWNER, "audioHash": "hash123"}

# (path template) for the three results.py media endpoints.
ENDPOINTS = [
    "/api/results/{sid}/audio/vocals.mp3",
    "/api/results/{sid}/image/histogram.png",
    "/api/results/{sid}/pitch/vocals",
]


@pytest.fixture
def client():
    return TestClient(api.main.app)


def _set_user(user):
    """Override get_optional_user to return the given user dict (or None)."""
    api.main.app.dependency_overrides[get_optional_user] = lambda: user


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    api.main.app.dependency_overrides.clear()


@pytest.fixture
def song(monkeypatch):
    """Return a setter that installs a get_song stub returning `value`."""
    def _install(value):
        monkeypatch.setattr(firestore_client, "get_song", lambda sid: value)
    return _install


# ---- Authorization matrix (parametrized over the three endpoints) ----

@pytest.mark.parametrize("url", ENDPOINTS)
def test_private_no_user_forbidden(client, song, url):
    song(PRIVATE_SONG)
    _set_user(None)
    assert client.get(url.format(sid="s1")).status_code == 403


@pytest.mark.parametrize("url", ENDPOINTS)
def test_private_non_owner_forbidden(client, song, url):
    song(PRIVATE_SONG)
    _set_user({"uid": OTHER})
    assert client.get(url.format(sid="s1")).status_code == 403


@pytest.mark.parametrize("url", ENDPOINTS)
def test_private_owner_allowed(client, song, url):
    song(PRIVATE_SONG)
    _set_user({"uid": OWNER})
    # Owner passes the guard; file is missing so a 404 is acceptable, but never 403.
    assert client.get(url.format(sid="s1")).status_code != 403


@pytest.mark.parametrize("url", ENDPOINTS)
def test_public_no_user_allowed(client, song, url):
    song(PUBLIC_SONG)
    _set_user(None)
    assert client.get(url.format(sid="s1")).status_code != 403


@pytest.mark.parametrize("url", ENDPOINTS)
def test_missing_song_404(client, song, url):
    song(None)
    _set_user({"uid": OWNER})
    assert client.get(url.format(sid="s1")).status_code == 404


# ---- Filename allowlist (case 5) ----

def test_safe_filename_rejects_traversal():
    for bad in ["../../etc/passwd", "..", "foo/bar", "foo$bar", "a b", ""]:
        with pytest.raises(HTTPException) as exc:
            _safe_filename(bad)
        assert exc.value.status_code == 400


def test_safe_filename_allows_normal_names():
    for good in ["vocals.mp3", "histogram.png", "accompaniment_pitch_data.csv", "original"]:
        assert _safe_filename(good) == good


def test_invalid_filename_returns_400(client, song):
    """End-to-end: an invalid char in the filename segment yields 400, not 403/404."""
    song(PUBLIC_SONG)
    _set_user({"uid": OWNER})
    # '$' is outside the allowlist and stays a single path segment.
    assert client.get("/api/results/s1/audio/bad$name.mp3").status_code == 400


# ---- require_song_access unit coverage ----

def test_require_song_access_public_no_user(song):
    song(PUBLIC_SONG)
    assert require_song_access("s1", None) == PUBLIC_SONG


def test_require_song_access_private_owner(song):
    song(PRIVATE_SONG)
    assert require_song_access("s1", {"uid": OWNER}) == PRIVATE_SONG
