"""Tests for the GCS handoff helper (Plan 007)."""

import importlib
import pytest


def test_disabled_without_bucket(monkeypatch):
    monkeypatch.delenv("GCS_BUCKET", raising=False)
    import api.object_store as os_mod
    os_mod = importlib.reload(os_mod)
    assert os_mod.enabled() is False


def test_bucket_access_raises_when_unset(monkeypatch):
    monkeypatch.delenv("GCS_BUCKET", raising=False)
    import api.object_store as os_mod
    os_mod = importlib.reload(os_mod)
    with pytest.raises(RuntimeError):
        os_mod._bucket()


def _fake_storage(monkeypatch, os_mod, recorder):
    """Install a fake google.cloud.storage.Client onto the module."""
    class FakeBlob:
        def __init__(self, key): self.key = key
        def upload_from_filename(self, p, content_type=None):
            recorder.append(("upload", self.key, p, content_type))
        def download_to_filename(self, p):
            recorder.append(("download", self.key, p))
        def generate_signed_url(self, **kw):
            recorder.append(("sign", self.key, kw["method"]))
            return f"https://signed/{self.key}?m={kw['method']}"
    class FakeBucket:
        def blob(self, key): return FakeBlob(key)
    monkeypatch.setattr(os_mod, "_bucket", lambda: FakeBucket())


def test_signed_urls_and_transfers(monkeypatch, tmp_path):
    monkeypatch.setenv("GCS_BUCKET", "test-bucket")
    import api.object_store as os_mod
    os_mod = importlib.reload(os_mod)
    rec = []
    _fake_storage(monkeypatch, os_mod, rec)

    get_url = os_mod.signed_get_url("in/audio.mp3", expires_seconds=600)
    put_url = os_mod.signed_put_url("out/vocals.mp3", content_type="audio/mpeg")
    assert get_url.endswith("m=GET")
    assert put_url.endswith("m=PUT")

    f = tmp_path / "x.txt"; f.write_text("hi")
    os_mod.upload_file(str(f), "in/x.txt", content_type="text/plain")
    os_mod.download_file("out/y.txt", str(tmp_path / "y.txt"))

    methods = [r[0] for r in rec]
    assert methods == ["sign", "sign", "upload", "download"]
