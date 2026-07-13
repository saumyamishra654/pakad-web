# Changelog

Web-app-level changes. Pipeline-internal history lives in `raga_pipeline/CHANGELOG.md`.

## 2026-07-13

- **Synced `raga_pipeline/` and `driver.py` from `raga-detection` `496d84f`.** RMS-primary
  phrase splitting (`phrase_method`, `detect_phrases_by_silence`) is now active in web
  analyses, so results match the CLI. Removed the stale `split_phrases_by_silence` path
  and the `raga_pipeline/DOCUMENTATION.md` doc that no longer exists upstream. (Plan 002)
