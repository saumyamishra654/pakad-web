"""Tests for Plan 009: offload wiring, timeout, and YouTube on-device audio.

stem_client and object_store are mocked throughout -- no network, GPU, or
subprocess calls to the real driver are made.
"""

import os
from pathlib import Path
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

def test_deliver_youtube_audio_uploads_to_per_user_prefix_and_deletes_local(monkeypatch, tmp_path):
    fake_store = FakeObjectStore(is_enabled=True)
    monkeypatch.setattr(jobs, "object_store", fake_store)

    # Delivery must NOT write URLs to the shared analysis doc (that leaked one
    # user's audio to every viewer). If it does, fail loudly.
    monkeypatch.setattr(
        jobs.firestore_client, "update_analysis",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("delivery must not write audioDelivery")),
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

    # All three files uploaded under THIS user's private prefix.
    uploaded_keys = {k for _, k, _ in fake_store.uploaded}
    assert uploaded_keys == {
        "delivery/hash123/user-yt/original.mp3",
        "delivery/hash123/user-yt/vocals.mp3",
        "delivery/hash123/user-yt/accompaniment.mp3",
    }
    # No presigned URLs minted at delivery time (results endpoint mints them
    # per-request for the matching user only).
    assert fake_store.signed_get_calls == []

    # Stems deleted locally; audio_path left for cleanup_tmp.
    assert not (stem_dir / "vocals.mp3").exists()
    assert not (stem_dir / "accompaniment.mp3").exists()
    assert audio_path.exists()


def test_deliver_youtube_audio_object_store_disabled_uploads_nothing(monkeypatch, tmp_path):
    fake_store = FakeObjectStore(is_enabled=False)
    monkeypatch.setattr(jobs, "object_store", fake_store)

    artifact_base = str(tmp_path / "artifacts" / "h")
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"orig")
    stem_dir = tmp_path / "artifacts" / "h" / "htdemucs" / "audio"
    stem_dir.mkdir(parents=True)
    (stem_dir / "vocals.mp3").write_bytes(b"voc")

    job = _job(job_id="job-yt2", user_id="user-yt2")
    jobs._deliver_youtube_audio(job, str(audio_path), artifact_base, {}, "hash456")

    # Nothing uploaded, but local stems still purged (no server-side retention).
    assert fake_store.uploaded == []
    assert not (stem_dir / "vocals.mp3").exists()


def test_deliver_youtube_audio_deletes_local_stems_even_when_upload_fails(monkeypatch, tmp_path):
    """Legal invariant: a failed delivery upload must NOT leave a YouTube stem
    on disk, and must NOT fail the analysis job."""
    class RaisingStore(FakeObjectStore):
        def upload_file(self, local_path, key, content_type=None):
            raise RuntimeError("network blip")

    fake_store = RaisingStore(is_enabled=True)
    monkeypatch.setattr(jobs, "object_store", fake_store)

    artifact_base = str(tmp_path / "artifacts" / "h")
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"orig")
    stem_dir = tmp_path / "artifacts" / "h" / "htdemucs" / "audio"
    stem_dir.mkdir(parents=True)
    (stem_dir / "vocals.mp3").write_bytes(b"voc")
    (stem_dir / "accompaniment.mp3").write_bytes(b"acc")

    # Must not raise -- delivery is best-effort.
    jobs._deliver_youtube_audio(_job(), str(audio_path), artifact_base, {}, "h")

    # Stems are gone despite the upload failure -- no server-side audio left.
    assert not (stem_dir / "vocals.mp3").exists()
    assert not (stem_dir / "accompaniment.mp3").exists()


# ---------------------------------------------------------------------------
# results._resolve_audio_delivery: per-user privacy (no cross-user audio leak)
# ---------------------------------------------------------------------------

class _DeliveryStore:
    """Object store where only `owner_uid`'s prefix has delivered objects."""
    def __init__(self, owner_uid):
        self.owner_uid = owner_uid

    def enabled(self):
        return True

    def exists(self, key):
        return f"/{self.owner_uid}/" in key

    def signed_get_url(self, key, expires_seconds=3600):
        return f"https://signed/{key}"


def test_resolve_audio_delivery_owner_gets_own_urls(monkeypatch):
    from api.routes import results
    monkeypatch.setattr(results, "object_store", _DeliveryStore("owner-1"))
    song = {"source": "youtube", "uploadedBy": "owner-1"}
    out = results._resolve_audio_delivery(song, "hashX", {"uid": "owner-1"})
    assert out["available"] is True
    assert set(out["urls"].keys()) == {"original", "vocals", "accompaniment"}


def test_resolve_audio_delivery_other_user_gets_nothing(monkeypatch):
    """The core privacy fix: a different viewer of a (public) YouTube song must
    NOT receive the uploader's audio."""
    from api.routes import results
    monkeypatch.setattr(results, "object_store", _DeliveryStore("owner-1"))
    song = {"source": "youtube", "uploadedBy": "owner-1"}
    out = results._resolve_audio_delivery(song, "hashX", {"uid": "someone-else"})
    assert out["available"] is False
    assert out["urls"] == {}


def test_resolve_audio_delivery_unauthenticated_gets_nothing(monkeypatch):
    from api.routes import results
    monkeypatch.setattr(results, "object_store", _DeliveryStore("owner-1"))
    song = {"source": "youtube", "uploadedBy": "owner-1"}
    out = results._resolve_audio_delivery(song, "hashX", None)
    assert out["available"] is False


def test_resolve_audio_delivery_non_youtube_is_empty(monkeypatch):
    from api.routes import results
    monkeypatch.setattr(results, "object_store", _DeliveryStore("owner-1"))
    song = {"source": "file", "uploadedBy": "owner-1"}
    out = results._resolve_audio_delivery(song, "hashX", {"uid": "owner-1"})
    assert out["available"] is False


def test_purge_youtube_local_removes_all_audio_files_and_is_idempotent(monkeypatch, tmp_path):
    artifact_base = str(tmp_path / "artifacts" / "h")
    stem_dir = tmp_path / "artifacts" / "h" / "htdemucs" / "audio"
    stem_dir.mkdir(parents=True)
    for name in ("vocals.mp3", "accompaniment.mp3", "original.mp3"):
        (stem_dir / name).write_bytes(b"x")

    job = _job(job_id="job-purge")
    jobs._purge_youtube_local(job, str(tmp_path / "audio.mp3"), artifact_base, {})

    for name in ("vocals.mp3", "accompaniment.mp3", "original.mp3"):
        assert not (stem_dir / name).exists()
    # Idempotent: a second call on already-clean state does not raise.
    jobs._purge_youtube_local(job, str(tmp_path / "audio.mp3"), artifact_base, {})


# ---------------------------------------------------------------------------
# _run_pipeline: mode == "audio_only" (Plan 011) takes the no-analyze branch
# ---------------------------------------------------------------------------

def test_run_pipeline_audio_only_skips_detect_and_analyze(monkeypatch, tmp_path):
    """A viewer requesting audio regeneration for an already-analyzed YouTube
    song must get separation + delivery only -- detect/analyze must never run,
    and no subprocess should be spawned."""
    from api.jobs import Job

    job = Job(id="job-audio-only", song_id="song-1", analysis_id="analysis-1", user_id="user-2", params={"mode": "audio_only"})

    song = {"id": "song-1", "title": "Some Bandish", "audioHash": "hash123", "source": "youtube", "youtubeVideoId": "abc123"}
    monkeypatch.setattr(jobs.firestore_client, "get_song", lambda song_id: song)
    monkeypatch.setattr(jobs.firestore_client, "get_analysis", lambda song_id, analysis_id: {"params": {"mode": "audio_only"}})

    # Storage: avoid touching real disk -- return deterministic relative-ish paths.
    monkeypatch.setattr(jobs.storage, "tmp_dir", lambda job_id: str(tmp_path / "tmp" / job_id))
    monkeypatch.setattr(jobs.storage, "ensure_dir", lambda relative: tmp_path / "resolved" / relative if isinstance(relative, str) else relative)
    monkeypatch.setattr(jobs.storage, "artifact_dir", lambda audio_hash: f"artifacts/{audio_hash}")
    cleanup_calls = []
    monkeypatch.setattr(jobs.storage, "cleanup_tmp", lambda job_id: cleanup_calls.append(job_id))

    # YouTube download: stub out, don't actually hit the network.
    import raga_pipeline.audio as audio_mod
    fake_audio_path = str(tmp_path / "audio.mp3")
    Path(fake_audio_path).write_bytes(b"fake")
    monkeypatch.setattr(audio_mod, "download_youtube_audio", lambda **kwargs: fake_audio_path)

    # _offload_stems and _deliver_youtube_audio: reuse Plan 009 helpers but
    # verify they were called with the no-analyze branch's expected args.
    offload_calls = []
    deliver_calls = []
    monkeypatch.setattr(jobs, "_offload_stems", lambda job_, audio_path, artifact_base, params: offload_calls.append((audio_path, artifact_base, params)))
    monkeypatch.setattr(jobs, "_deliver_youtube_audio", lambda job_, audio_path, artifact_base, params, audio_hash: deliver_calls.append((audio_path, artifact_base, params, audio_hash)))

    # If detect/analyze ran, subprocess.run would be invoked -- fail loudly if so.
    def _unexpected_subprocess_run(*args, **kwargs):
        raise AssertionError("subprocess.run must not be called for mode=='audio_only'")
    monkeypatch.setattr(jobs.subprocess, "run", _unexpected_subprocess_run)

    jobs._run_pipeline(job)

    assert len(offload_calls) == 1
    assert len(deliver_calls) == 1
    assert deliver_calls[0][3] == "hash123"
    assert cleanup_calls == ["job-audio-only"]


def test_run_pipeline_audio_only_upload_source_no_delivery(monkeypatch, tmp_path):
    """For a file-upload song, audio_only has nothing to deliver (uploads
    already serve from the server) -- it should offload and return without
    calling the YouTube delivery block or any subprocess."""
    from api.jobs import Job

    job = Job(id="job-audio-only-2", song_id="song-2", analysis_id="analysis-2", user_id="user-3", params={"mode": "audio_only"})

    song = {"id": "song-2", "title": "Uploaded Song", "audioHash": "hash789", "source": "file"}
    monkeypatch.setattr(jobs.firestore_client, "get_song", lambda song_id: song)
    monkeypatch.setattr(jobs.firestore_client, "get_analysis", lambda song_id, analysis_id: {"params": {"mode": "audio_only"}})

    upload_file = tmp_path / "upload" / "audio.mp3"
    upload_file.parent.mkdir(parents=True)
    upload_file.write_bytes(b"fake")
    monkeypatch.setattr(jobs.storage, "upload_dir", lambda user_id, song_id: "uploads/rel")
    monkeypatch.setattr(jobs.storage, "list_files", lambda relative_dir, pattern="*": [str(upload_file)] if pattern == "*.mp3" else [])
    monkeypatch.setattr(jobs.storage, "get_absolute_path", lambda relative: Path(relative))
    monkeypatch.setattr(jobs.storage, "ensure_dir", lambda relative: tmp_path / "resolved" / relative)
    monkeypatch.setattr(jobs.storage, "artifact_dir", lambda audio_hash: f"artifacts/{audio_hash}")

    offload_calls = []
    monkeypatch.setattr(jobs, "_offload_stems", lambda job_, audio_path, artifact_base, params: offload_calls.append(audio_path))
    monkeypatch.setattr(jobs, "_deliver_youtube_audio", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("must not deliver for upload source")))

    def _unexpected_subprocess_run(*args, **kwargs):
        raise AssertionError("subprocess.run must not be called for mode=='audio_only'")
    monkeypatch.setattr(jobs.subprocess, "run", _unexpected_subprocess_run)

    jobs._run_pipeline(job)

    assert len(offload_calls) == 1
