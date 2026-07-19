"""Tests for the S3-compatible (Cloudflare R2) handoff helper (Plan 007)."""

import importlib
import pytest


def _reload():
    import api.object_store as os_mod
    return importlib.reload(os_mod)


def test_disabled_without_config(monkeypatch):
    monkeypatch.delenv("R2_BUCKET", raising=False)
    monkeypatch.delenv("R2_ENDPOINT", raising=False)
    assert _reload().enabled() is False


def test_disabled_with_bucket_but_no_endpoint(monkeypatch):
    monkeypatch.setenv("R2_BUCKET", "b")
    monkeypatch.delenv("R2_ENDPOINT", raising=False)
    assert _reload().enabled() is False


def test_s3_access_raises_when_unset(monkeypatch):
    monkeypatch.delenv("R2_BUCKET", raising=False)
    monkeypatch.delenv("R2_ENDPOINT", raising=False)
    with pytest.raises(RuntimeError):
        _reload()._s3()


class _FakeS3:
    def __init__(self, recorder, pages=None):
        self.rec = recorder
        self._pages = pages or []

    def upload_file(self, filename, bucket, key, ExtraArgs=None):
        self.rec.append(("upload", bucket, key, ExtraArgs))

    def download_file(self, bucket, key, filename):
        self.rec.append(("download", bucket, key, filename))

    def generate_presigned_url(self, op, Params=None, ExpiresIn=None):
        self.rec.append(("sign", op, Params, ExpiresIn))
        return f"https://signed/{op}/{Params['Key']}"

    def get_paginator(self, name):
        pages = self._pages
        rec = self.rec

        class _Pag:
            def paginate(self, **kw):
                rec.append(("paginate", kw.get("Prefix")))
                return iter(pages)
        return _Pag()

    def delete_objects(self, Bucket=None, Delete=None):
        self.rec.append(("delete_objects", Bucket, [o["Key"] for o in Delete["Objects"]]))


def _configured(monkeypatch, pages=None):
    monkeypatch.setenv("R2_BUCKET", "test-bucket")
    monkeypatch.setenv("R2_ENDPOINT", "https://acct.r2.cloudflarestorage.com")
    os_mod = _reload()
    rec = []
    monkeypatch.setattr(os_mod, "_s3", lambda: _FakeS3(rec, pages))
    return os_mod, rec


def test_presigned_urls_and_transfers(monkeypatch, tmp_path):
    os_mod, rec = _configured(monkeypatch)

    get_url = os_mod.signed_get_url("in/audio.mp3", expires_seconds=600)
    put_url = os_mod.signed_put_url("out/vocals.mp3", content_type="audio/mpeg")
    assert get_url == "https://signed/get_object/in/audio.mp3"
    assert put_url == "https://signed/put_object/out/vocals.mp3"

    f = tmp_path / "x.txt"; f.write_text("hi")
    uri = os_mod.upload_file(str(f), "in/x.txt", content_type="text/plain")
    assert uri == "s3://test-bucket/in/x.txt"
    os_mod.download_file("out/y.txt", str(tmp_path / "y.txt"))

    ops = [r[0] for r in rec]
    assert ops == ["sign", "sign", "upload", "download"]
    # PUT presign carries the ContentType so the uploader can match it.
    put_sign = next(r for r in rec if r[0] == "sign" and r[1] == "put_object")
    assert put_sign[2]["ContentType"] == "audio/mpeg"


def test_delete_prefix_paginates_and_deletes(monkeypatch):
    pages = [
        {"Contents": [{"Key": "handoff/j/input.mp3"}, {"Key": "handoff/j/vocals.mp3"}]},
        {"Contents": [{"Key": "handoff/j/accompaniment.mp3"}]},
        {},  # empty page -> no delete call
    ]
    os_mod, rec = _configured(monkeypatch, pages=pages)
    assert os_mod.delete_prefix("handoff/j/") == 3
    deletes = [r for r in rec if r[0] == "delete_objects"]
    assert len(deletes) == 2  # empty page skipped
