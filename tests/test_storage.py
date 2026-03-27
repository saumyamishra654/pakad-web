"""Tests for the storage abstraction layer."""

import os
import tempfile
import unittest

_tmpdir = tempfile.mkdtemp()
os.environ["STORAGE_ROOT"] = _tmpdir

from api.storage import (
    write_file, read_file, file_exists, delete_file, list_files,
    ensure_dir, upload_path, upload_dir, artifact_dir, analysis_dir,
    tmp_dir, cleanup_tmp, is_youtube_source,
)


class TestStorage(unittest.TestCase):
    def test_write_and_read(self):
        path = write_file("test/hello.txt", b"hello world")
        self.assertEqual(path, "test/hello.txt")
        self.assertEqual(read_file("test/hello.txt"), b"hello world")

    def test_file_exists(self):
        write_file("test/exists.txt", b"yes")
        self.assertTrue(file_exists("test/exists.txt"))
        self.assertFalse(file_exists("test/nope.txt"))

    def test_delete_file(self):
        write_file("test/delete_me.txt", b"bye")
        self.assertTrue(delete_file("test/delete_me.txt"))
        self.assertFalse(file_exists("test/delete_me.txt"))
        self.assertFalse(delete_file("test/delete_me.txt"))

    def test_list_files(self):
        write_file("listdir/a.txt", b"a")
        write_file("listdir/b.txt", b"b")
        write_file("listdir/c.csv", b"c")
        txt_files = list_files("listdir", "*.txt")
        self.assertEqual(len(txt_files), 2)

    def test_path_traversal_blocked(self):
        with self.assertRaises(ValueError):
            write_file("../../etc/passwd", b"nope")

    def test_path_helpers(self):
        self.assertEqual(upload_path("u1", "s1", "song.mp3"), "uploads/u1/s1/song.mp3")
        self.assertEqual(upload_dir("u1", "s1"), "uploads/u1/s1")
        self.assertEqual(artifact_dir("abc123"), "artifacts/abc123")
        self.assertEqual(analysis_dir("a1"), "analyses/a1")
        self.assertEqual(tmp_dir("j1"), "tmp/j1")

    def test_cleanup_tmp(self):
        write_file("tmp/testjob/audio.mp3", b"fake audio")
        write_file("tmp/testjob/vocals.mp3", b"fake vocals")
        self.assertTrue(file_exists("tmp/testjob/audio.mp3"))
        cleanup_tmp("testjob")
        self.assertFalse(file_exists("tmp/testjob/audio.mp3"))

    def test_is_youtube_source(self):
        self.assertTrue(is_youtube_source({"source": "youtube"}))
        self.assertFalse(is_youtube_source({"source": "file"}))

    def test_ensure_dir(self):
        path = ensure_dir("new/nested/dir")
        self.assertTrue(path.exists())
        self.assertTrue(path.is_dir())


if __name__ == "__main__":
    unittest.main()
