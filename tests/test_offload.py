"""Tests for Plan 009: offload wiring, timeout, and YouTube on-device audio.

stem_client and object_store are mocked throughout -- no network, GPU, or
subprocess calls to the real driver are made.
"""

import os
from types import SimpleNamespace

import pytest

from api import jobs


def _job(job_id="job-1", user_id="user-1", song_id="song-1", analysis_id="analysis-1"):
    return SimpleNamespace(id=job_id, user_id=user_id, song_id=song_id, analysis_id=analysis_id)


# ---------------------------------------------------------------------------
# _stem_dir
# ---------------------------------------------------------------------------

def test_stem_dir():
    from api.jobs import _stem_dir
    assert _stem_dir("/a/artifacts/h", "/tmp/x/audio.mp3", "htdemucs") == \
        "/a/artifacts/h/htdemucs/audio"


def test_stem_dir_default_model():
    assert jobs._stem_dir("/base", "/tmp/song.wav") == "/base/htdemucs/song"


# ---------------------------------------------------------------------------
# _pipeline_timeout
# ---------------------------------------------------------------------------

def test_pipeline_timeout_unset(monkeypatch):
    monkeypatch.delenv("PIPELINE_TIMEOUT_SECONDS", raising=False)
    assert jobs._pipeline_timeout() is None


def test_pipeline_timeout_set(monkeypatch):
    monkeypatch.setenv("PIPELINE_TIMEOUT_SECONDS", "7200")
    assert jobs._pipeline_timeout() == 7200


def test_pipeline_timeout_blank(monkeypatch):
    monkeypatch.setenv("PIPELINE_TIMEOUT_SECONDS", "  ")
    assert jobs._pipeline_timeout() is None


def test_no_hardcoded_timeout_in_source():
    import inspect
    src = inspect.getsource(jobs)
    assert "timeout=3600" not in src


# ---------------------------------------------------------------------------
# _offload_stems
# ---------------------------------------------------------------------------

class FakeStemClient:
    def __init__(self, is_enabled=True, raises=None):
        self._enabled = is_enabled
        self._raises = raises
        self.calls = []

    def enabled(self):
        return self._enabled

    def separate(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises:
            raise self._raises


class FakeObjectStore:
    def __init__(self, is_enabled=True):
        self._enabled = is_enabled
        self.uploaded = []
        self.downloaded = []
        self.deleted_prefixes = []
        self.signed_get_calls = []
        self.signed_put_calls = []

    def enabled(self):
        return self._enabled

    def upload_file(self, local_path, key, content_type=None):
        self.uploaded.append((local_path, key, content_type))
        return f"gs://bucket/{key}"

    def download_file(self, key, local_path):
        self.downloaded.append((key, local_path))
        # Simulate the download actually landing a file, like the real GCS client.
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(b"fake-audio")

    def signed_get_url(self, key, expires_seconds=3600):
        self.signed_get_calls.append((key, expires_seconds))
        return f"https://signed/{key}?get"

    def signed_put_url(self, key, expires_seconds=3600, content_type="application/octet-stream"):
        self.signed_put_calls.append((key, expires_seconds, content_type))
        return f"https://signed/{key}?put"

    def delete_prefix(self, prefix):
        self.deleted_prefixes.append(prefix)
        return 0


def test_offload_disabled_makes_no_calls(monkeypatch, tmp_path):
    fake_stem = FakeStemClient(is_enabled=False)
    fake_store = FakeObjectStore(is_enabled=True)
    monkeypatch.setattr(jobs, "stem_client", fake_stem)
    monkeypatch.setattr(jobs, "object_store", fake_store)

    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"data")
    artifact_base = str(tmp_path / "artifacts" / "h")

    jobs._offload_stems(_job(), str(audio), artifact_base, {})

    assert fake_stem.calls == []
    assert fake_store.uploaded == []
    assert fake_store.downloaded == []
    assert fake_store.deleted_prefixes == []


def test_offload_enabled_uploads_separates_downloads_and_cleans_up(monkeypatch, tmp_path):
    fake_stem = FakeStemClient(is_enabled=True)
    fake_store = FakeObjectStore(is_enabled=True)
    monkeypatch.setattr(jobs, "stem_client", fake_stem)
    monkeypatch.setattr(jobs, "object_store", fake_store)

    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"data")
    artifact_base = str(tmp_path / "artifacts" / "h")

    job = _job(job_id="job-42")
    jobs._offload_stems(job, str(audio), artifact_base, {})

    # One upload (input audio), one separate call, two downloads (vocals + accompaniment)
    assert len(fake_store.uploaded) == 1
    assert fake_store.uploaded[0][1] == "handoff/job-42/input.mp3"
    assert len(fake_stem.calls) == 1
    assert len(fake_store.downloaded) == 2
    downloaded_keys = {k for k, _ in fake_store.downloaded}
    assert downloaded_keys == {"handoff/job-42/vocals.mp3", "handoff/job-42/accompaniment.mp3"}

    # Handoff cleanup always runs
    assert fake_store.deleted_prefixes == ["handoff/job-42/"]

    # Stems actually landed in the expected cache dir
    stem_dir = jobs._stem_dir(artifact_base, str(audio), "htdemucs")
    assert os.path.exists(os.path.join(stem_dir, "vocals.mp3"))
    assert os.path.exists(os.path.join(stem_dir, "accompaniment.mp3"))


def test_offload_remote_failure_fallback_local(monkeypatch, tmp_path):
    fake_stem = FakeStemClient(is_enabled=True, raises=RuntimeError("boom"))
    fake_store = FakeObjectStore(is_enabled=True)
    monkeypatch.setattr(jobs, "stem_client", fake_stem)
    monkeypatch.setattr(jobs, "object_store", fake_store)
    monkeypatch.setenv("STEM_FALLBACK", "local")

    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"data")
    artifact_base = str(tmp_path / "artifacts" / "h")

    # Should not raise -- swallowed, falls back to local separation.
    jobs._offload_stems(_job(job_id="job-99"), str(audio), artifact_base, {})

    assert fake_store.deleted_prefixes == ["handoff/job-99/"]
    # No stems downloaded since separate() raised before download calls.
    assert fake_store.downloaded == []


def test_offload_remote_failure_stem_fallback_fail_raises(monkeypatch, tmp_path):
    fake_stem = FakeStemClient(is_enabled=True, raises=RuntimeError("boom"))
    fake_store = FakeObjectStore(is_enabled=True)
    monkeypatch.setattr(jobs, "stem_client", fake_stem)
    monkeypatch.setattr(jobs, "object_store", fake_store)
    monkeypatch.setenv("STEM_FALLBACK", "fail")

    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"data")
    artifact_base = str(tmp_path / "artifacts" / "h")

    with pytest.raises(RuntimeError, match="Remote stem separation failed"):
        jobs._offload_stems(_job(job_id="job-100"), str(audio), artifact_base, {})

    # Handoff is still cleaned up even though we raised.
    assert fake_store.deleted_prefixes == ["handoff/job-100/"]


def test_offload_object_store_disabled_makes_no_calls(monkeypatch, tmp_path):
    fake_stem = FakeStemClient(is_enabled=True)
    fake_store = FakeObjectStore(is_enabled=False)
    monkeypatch.setattr(jobs, "stem_client", fake_stem)
    monkeypatch.setattr(jobs, "object_store", fake_store)

    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"data")
    artifact_base = str(tmp_path / "artifacts" / "h")

    jobs._offload_stems(_job(), str(audio), artifact_base, {})

    assert fake_stem.calls == []
    assert fake_store.uploaded == []


# ---------------------------------------------------------------------------
# _deliver_youtube_audio
# ---------------------------------------------------------------------------

def test_deliver_youtube_audio_uploads_and_deletes_local_files(monkeypatch, tmp_path):
    fake_store = FakeObjectStore(is_enabled=True)
    monkeypatch.setattr(jobs, "object_store", fake_store)

    updates = []
    monkeypatch.setattr(
        jobs.firestore_client, "update_analysis",
        lambda song_id, analysis_id, **fields: updates.append((song_id, analysis_id, fields)),
    )

    artifact_base = str(tmp_path / "artifacts" / "h")
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"orig")
    stem_dir = tmp_path / "artifacts" / "h" / "htdemucs" / "audio"
    stem_dir.mkdir(parents=True)
    (stem_dir / "vocals.mp3").write_bytes(b"voc")
    (stem_dir / "accompaniment.mp3").write_bytes(b"acc")

    job = _job(job_id="job-yt", user_id="user-yt", song_id="song-yt", analysis_id="an-yt")
    jobs._deliver_youtube_audio(job, str(audio_path), artifact_base, {}, "hash123")

    # All three audio-bearing files uploaded
    uploaded_keys = {k for _, k, _ in fake_store.uploaded}
    assert uploaded_keys == {
        "delivery/hash123/user-yt/original.mp3",
        "delivery/hash123/user-yt/vocals.mp3",
        "delivery/hash123/user-yt/accompaniment.mp3",
    }

    # Stems deleted locally (audio_path itself is left for the existing
    # cleanup_tmp() call to remove -- see to_deliver's "path != audio_path" guard)
    assert not (stem_dir / "vocals.mp3").exists()
    assert not (stem_dir / "accompaniment.mp3").exists()
    assert audio_path.exists()

    # Firestore updated with audioDelivery
    assert len(updates) == 1
    song_id, analysis_id, fields = updates[0]
    assert song_id == "song-yt"
    assert analysis_id == "an-yt"
    delivery = fields["audioDelivery"]
    assert delivery["available"] is True
    assert delivery["source"] == "youtube"
    assert set(delivery["urls"].keys()) == {"original", "vocals", "accompaniment"}


def test_deliver_youtube_audio_object_store_disabled_still_updates_firestore(monkeypatch, tmp_path):
    fake_store = FakeObjectStore(is_enabled=False)
    monkeypatch.setattr(jobs, "object_store", fake_store)

    updates = []
    monkeypatch.setattr(
        jobs.firestore_client, "update_analysis",
        lambda song_id, analysis_id, **fields: updates.append((song_id, analysis_id, fields)),
    )

    artifact_base = str(tmp_path / "artifacts" / "h")
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"orig")

    job = _job(job_id="job-yt2", user_id="user-yt2", song_id="song-yt2", analysis_id="an-yt2")
    jobs._deliver_youtube_audio(job, str(audio_path), artifact_base, {}, "hash456")

    assert fake_store.uploaded == []
    delivery = updates[0][2]["audioDelivery"]
    assert delivery["available"] is False
    assert delivery["urls"] == {}
