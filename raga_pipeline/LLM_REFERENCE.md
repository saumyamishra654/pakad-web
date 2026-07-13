# IMPORTANT: READ THIS FILE FIRST BEFORE READING CODE

> **For LLM Agents:** This file contains all essential information about the `raga_pipeline` package. **Always read this file instead of repeatedly reading the source code.** When making code changes, **update this file immediately** to keep it synchronized. Crucially, NEVER USE EMOJIS, AT ALL, IN THE CODE, OR IN THE FRONTEND.

> **CHANGELOG Requirement:** After ANY code change, update `CHANGELOG.md` with a dated entry. Create a new date section (format: `## YYYY-MM-DD`) if one doesn't exist for today. Keep entries concise. This provides a complete work history of the project.

> **Running the Pipeline:** Prefer `./run_pipeline.sh` for CLI runs. It supports configurable activation via `RAGA_CONDA_SH`, `RAGA_CONDA_ENV`, `RAGA_SKIP_ENV_ACTIVATE`, and `RAGA_PYTHON_BIN`.

---

## Related Documentation Files

| File | Purpose |
|------|---------|
| `LLM_REFERENCE.md` | This file - quick reference for understanding the codebase |
| `CHANGELOG.md` | Daily work log - update after every change |
| `NOTEBOOK_VS_PIPELINE_COMPARISON.md` | Feature comparison with original notebooks |
| `DOCUMENTATION.md` | User-facing documentation |
| `../autoresearch_transcription_repo/README.md` | Standalone autonomous transcription-parameter tuning scaffold |

---

# Raga Pipeline - Quick Reference for LLMs

**Last Updated:** 2026-06-11

## Table of Contents

1. [System Overview](#system-overview)
2. [Repository Structure & Key Files](#repository-structure--key-files)
3. [Code Navigation: Where To Edit What](#code-navigation-where-to-edit-what)
4. [Architecture & Data Flow](#architecture--data-flow)
5. [Module Breakdown](#module-breakdown)
6. [Key Data Structures](#key-data-structures)
7. [Main Pipeline Execution](#main-pipeline-execution)
8. [Configuration Parameters](#configuration-parameters)
9. [Common Operations](#common-operations)
10. [Output Files & Caching](#output-files--caching)
11. [Important Implementation Details](#important-implementation-details)
12. [Troubleshooting Guide](#troubleshooting-guide)

---

## System Overview

**Purpose:** End-to-end raga detection and analysis for Hindustani classical music.

**Three Pipeline Modes:**
1. **Preprocess Mode**: Ingest YouTube or recorded audio to local MP3 and print next-step detect command
2. **Detect Mode** (default): Histogram-based raga detection
3. **Analyze Mode**: Note sequence analysis with known tonic/raga

**Preprocess Ingest Variants:**
- `--ingest yt`: requires `--yt`, supports `--start-time/--end-time`.
- `--ingest recording`: supports `--recorded-audio` or interactive CLI mic capture.
- `--ingest tanpura_recording`: requires `--tanpura-key`; tanpura-assisted recording ingest.
- Legacy aliases (`youtube`, `record`, `tanpura_vocal`) are normalized to the canonical values above.

**Three Source Types:**
1. **mixed** (default): Uses stem separation, all tonics considered
2. **instrumental**: Always runs stem separation (for accompaniment) + instrument bias. Melody can be sourced from separated stem or original mix.
3. **vocal**: Runs stem separation + gender-specific tonic bias (does NOT skip separation)

**Detect Skip-Separation Mode (`--skip-separation`):**
- Detect-only optimization that bypasses stem separation and uses original audio directly for melody analysis.
- Requires `--tonic` in detect mode.
- Auto-forces `melody_source=composite`.
- Intended for clean recordings where denoising via separation is optional.

**Key Technologies:**
- **Stem Separation:** Demucs (default) or Spleeter
- **Pitch Extraction:** SwiftF0 (default) or pYIN (via librosa)
  - `--pitch-extractor {swiftf0,pyin}` selects backend
  - `--pitch-hop-ms` controls frame hop for pyin (0 = extractor default: ~23ms)
  - SwiftF0 has fixed 16ms hop / 64ms window; pYIN offers configurable hop for drut passages
  - Cache CSV filenames include extractor suffix: `{prefix}_pitch_data_{extractor}.csv` (swiftf0 uses legacy `{prefix}_pitch_data.csv`)
  - **Extractor-specific confidence defaults** (`EXTRACTOR_CONFIDENCE_DEFAULTS` in `config.py`): CLI `--vocal-confidence`/`--accomp-confidence` default to `None` (auto-resolved per extractor). SwiftF0=0.95/0.80, pYIN=0.15/0.05. Explicit overrides take precedence. `PipelineConfig` dataclass retains 0.95/0.80 for the programmatic `create_config()` API.
  - **Voicing consistency:** `extract_pitch()` bakes the confidence threshold into the `voicing` array in PitchData so that `voiced_mask`, `voiced_times`, and `midi_vals` are always consistent. Raw voicing is still persisted to CSV for cache reload (where `apply_confidence_threshold()` re-applies the filter).
  - **Compare mode** (`--compare-extractors`, analyze only): Runs both SwiftF0 and pYIN, binary-searches confidence thresholds so both produce the same raw note count, then runs full transcription pipeline for each. Report includes toggle buttons to switch between extractor results (karaoke, transcription, patterns, correction). `ExtractorTranscription` dataclass in `output.py` stores per-extractor results; `_run_compare_extractors()` in `driver.py` implements calibration.
- **SwiftF0 Runtime Controls (env):** `RAGA_SWIFTF0_PROVIDER`, `RAGA_SWIFTF0_STRICT_PROVIDER`, `RAGA_SWIFTF0_PROVIDER_LOGS`
- **Visualization:** Matplotlib (static) + Plotly (interactive)

---

---

## Repository Structure & Key Files

**Pipeline Entry Point:**
- **`run_pipeline.sh`**: Environment-aware wrapper script around `driver.py` with configurable Conda activation.
- **`driver.py`**: The internal Python orchestration script. Loaded by `run_pipeline.sh`.
- **`run_local_app.sh`**: Launches local FastAPI UI (`http://127.0.0.1:8765/app`) for parameter-tuned reruns.

**Core Package (`raga_pipeline/`):**
- **`config.py`**: Configuration logic and CLI parsing.
- **`cli_schema.py`**: Converts argparse definitions to UI-ready per-mode schemas.
- **`cli_args.py`**: Converts structured UI params into CLI-style argv.
- **`audio.py`**: Stem separation (Demucs) and pitch extraction (SwiftF0).
- **`raga.py`**: Raga database, candidate scoring logic, and aaroh/avroh directional pattern database utilities.
- **`analysis.py`**: **Phase 1 (Detect)** logic. Computes histograms, detects peaks, and fits GMMs.
- **`transcription.py`**: **Phase 2 (Analyze)** logic. Unified note transcription (stationary + inflection points).
- **`sequence.py`**: Phrase analysis, clustering, pattern recognition (Motifs, Aroha/Avroha), and aaroh/avroh conformance checking.
- **`output.py`**: Visualization and HTML report generation.
- **`batch.py`**: Batch processing script.
- **`language_model/`**: Per-raga n-gram language models. `NgramModel` stores raw counts per raga (order 1..N), applies add-k smoothing with linear interpolation at scoring time, and serialises to/from JSON. Public API: `add_sequence`, `finalize`, `ragas`, `get_counts`, `vocabulary_size`, `log_prob`, `score_sequence`, `rank_ragas`, `to_dict`, `from_dict`. `train_model(ground_truth, results_dir, output, order, smoothing, smoothing_k, lambdas, min_recordings, transcription_source, quiet)` builds an NgramModel from a labeled corpus: reads GT CSV + discovers transcription CSVs via `motifs._discover_candidates`, tokenizes each recording via `_load_notes_from_csv` -> `sequence.tokenize_notes_for_lm`, prunes ragas below `min_recordings`, and writes a JSON model with provenance metadata. Helpers: `_TONIC_MAP`, `_tonic_name_to_midi(tonic) -> float`, `_load_notes_from_csv(csv_path, tonic_midi) -> List[str]`, `_load_note_timestamps_from_csv(csv_path) -> List[Tuple[float, float]]`. `score_transcription(model_path, transcription_path, tonic, segments, segment_window, top_k, output) -> Dict` loads a trained model JSON, tokenizes the transcription, and returns ranked ragas with scores (`{"rankings": [{"raga", "score", "rank"}, ...]}`). With `segments=True`, slides a token window (50% overlap, size `segment_window`) over the sequence and includes per-segment top-3 raga scores with `start_time`/`end_time`/`token_range`. Optional `output` path writes JSON. Returns `{"error": ...}` when no tokens are extracted. CLI entry point (`raga_pipeline/language_model/__main__.py`): `python -m raga_pipeline.language_model train|score|evaluate ...`. Subcommands: `train` (--gt, --results-dir, --output, --order, --smoothing, --smoothing-k, --min-recordings, --lambdas, --quiet), `score` (--model, --transcription, --tonic, --segments, --segment-window, --top-k, --output), `evaluate` (--gt, --results-dir, --output, --order, --smoothing, --smoothing-k, --min-recordings, --lambdas, --sweep-orders, --quiet). `main(argv)` returns int exit code (0 = success). `_build_parser()` creates the argparse tree; `_parse_lambdas(raw, order)` converts a comma-separated string to a float list, raising `ValueError` on wrong count. Tests in `tests/test_lm_cli.py`. `evaluate_model(ground_truth, results_dir, output, order, smoothing, smoothing_k, lambdas, min_recordings, transcription_source, sweep_orders, quiet) -> Dict` runs leave-one-out cross-validation: tokenizes all recordings once, then for each held-out recording builds a fresh NgramModel from all others (pruning ragas below `min_recordings` within the fold) and scores via `rank_ragas`. Returns summary with `top1_accuracy`, `top3_accuracy`, `mrr`, `total`; with `sweep_orders` also includes `"sweep_results"` list of per-order dicts. Writes per-recording CSV via `_write_eval_csv` (columns: filename, true_raga, predicted_raga, correct, true_raga_rank, score_top1/2/3, raga_top1/2/3). Helpers: `_run_leave_one_out`, `_compute_summary`, `_write_eval_csv`.

**Offline Experiment Scripts (`scripts/`):**
- **`sweep_saturation_calibration.py`** (Exp 16): Replays histogram scorer on cached pitch CSVs, sweeps fit-score calibration variants (clip thresholds, band-pass weights). Resume-safe `results/saturation_calibration/progress.csv`.
- **`sweep_truncation.py`** (Exp 15): Slices cached pitch/transcription CSVs to time windows, evaluates tonic detection + LM raga accuracy per window. Resume-safe `results/truncation_sweep/progress.csv`.
- **`sweep_confusion_pairs.py`**: Builds confusion-pair diagnostics from a calibration progress CSV -- confusion matrix and top confused raga pairs.
- **`sweep_positional_pch.py`** (Exp 18): Evaluates three positional pitch-class histogram features (nyas/phrase-ending, phrase-start, octave-stratified 36-dim) as standalone raga discriminators via LOO cosine similarity. Sweeps `phrase_gap_sec`. Reports GT-tonic and detected-tonic accuracy. Resume-safe `results/positional_pch/progress.csv`.
- **`sweep_gmm_fingerprint.py`** (Exp 20): Extracts per-swara within-note features (width, shruti offset, skew) from raw f0 frames and GMM fits. 60 features (5 per PC x 12 PCs): `dev_frame`, `sigma_frame`, `frame_count` (frame-level) + `sigma_hist`, `dev_hist`, `skew_hist` (GMM). C1: Welch t-test + BH correction on confused pairs from `results/confusion_analysis/top_pairs.csv`. C2 (conditional on C1 significance): LOO weighted-distance classification using `exp(-distance)` similarity. Resume-safe `results/gmm_fingerprint/fingerprints.csv`.
- **`sweep_cadence_lm.py`** (Exp 21): Trains per-raga trigram LM on cadential phrases only (last 4 notes before each return to Sa). LOO evaluation with token-count-based model tier selection (trigram >= 20 tokens, bigram backoff 10-20 tokens, skip < 10). Outputs top-1/top-3 accuracy and cadence trigram examples. Resume-safe `results/cadence_lm/progress.csv`.
- **`sweep_pipeline_loo.py`** (Exp 23, 23b, 24): Full pipeline LOO: histogram + n-gram LM + combined scoring. Supports `--stems-root`, `--transcription-root` (separate pitch/transcription dirs), `--train-corrected` (apply GT raga correction to training data). Exp 23b uses `--stems-root nocorrection` for verified uncorrected baseline (88.9% best result).
- **`sweep_perhyp_v2_loo.py`** (Exp 26): Per-hypothesis correction LOO. Corrects uncorrected transcription under each candidate raga, scores with corrected-trained LM. Penalty terms: W_DEL, W_SNAP. Result: 85.5% (beaten by simpler Exp 23b).
- **`sweep_alignment_loo.py`** (Exp 28): Noisy-channel alignment LM with beam DP. Corrected-train, uncorrected-test. Key finding: sub_fraction is discriminative, not lm_per_token. Best: 66.7%.
- **`sweep_top3_rerank_loo.py`** (Exp 29): Top-K histogram candidates at detected/given tonic, per-hyp corrected, LM rerank. Auto 70.7%, given 72.7%. Negative result: top-3 too aggressive.

**Other Directories:**
- **`pretrained_models/`**: Stores ML models/weights for scoring.
- **`local_app/`**: Local FastAPI app (`server.py`, `jobs.py`, templates/static) for interactive runs.
  - UI parses printed next-step commands from logs to auto-load next-mode parameters.
  - Preprocess UI uses backend `ffmpeg` mic capture (same ingest path as CLI recording) and stores saved takes into `--recorded-audio`.
  - Tanpura catalog is exposed at `/api/tanpura-tracks` and used for in-app playback during tanpura-vocal recording mode.
  - Report serving rewrites relative asset links to `/local-files/...`; large embedded `data:` URIs are fast-skipped during rewrite to keep analyze report loads stable.
  - Analyze workspace includes an embedded analyze-report iframe plus in-app transcription editor (versioned save/load/default/regenerate/delete) driven by `/api/transcription-edits/...`.
  - The editor initializes from report metadata payload (`analysis_report.meta.json` -> `transcription_edit_payload`) via `/api/transcription-edits/{dir_token}/{report_name}/base`; legacy reports without this payload require rerunning analyze.
- **`autoresearch_transcription_repo/`**: Contains both (a) Optuna sweep mode (`run_study.py`, `src/autoresearch_tuner/study.py`) and (b) true LLM autoresearch mode (`run_llm_autoresearch.py`, `src/autoresearch_tuner/llm_loop.py`) that performs propose-evaluate-keep/discard iteration using `program.md` instructions and JSON parameter proposals from a chat-completions API endpoint. Both modes use analyze `--transcription-only --skip-raga-correction` evaluation via the shared evaluator. Fixed reusable prompt also lives at `autoresearch_transcription_repo/prompts/system_prompt.md`.
- **Raga correction logging toggle:** `get_raga_notes(...)` in `raga_pipeline/raga.py` now prints per-recording raga-match info only when `RAGA_LOG_RAGA_MATCHES=1` is set. Default behavior is silent to avoid log spam in long batch/tuning runs.

---

## Code Navigation: Where To Edit What

Use this section as the fast routing table when implementing changes.

### A) Pipeline orchestration and step order

**Primary file:** `driver.py`

Edit here when you need to change:
- preprocess/detect/analyze sequencing and phase boundaries
- cache-load behavior (especially analyze-mode fallback logic)
- cross-module data plumbing (what gets passed into transcription/reporting)
- printed next-step command suggestions and timer/progress output

Key anchors:
- `run_pipeline(config, ...)`
- detect-only early return path (`detection_report.html` generation)
- analyze path (`transcribe_to_notes` + phrase/pattern/report flow)

### B) CLI arguments, defaults, and validation contracts

**Primary file:** `raga_pipeline/config.py`

Edit here when you need to change:
- any flag name/default/help text
- mode-specific required args
- parser-to-config mapping behavior (`argparse` -> `PipelineConfig`)
- validation constraints (`--skip-separation`, preprocess ingest rules, strict-raga bounds)

Key anchors:
- `PipelineConfig` dataclass defaults
- `build_cli_parser()`
- `_config_from_parsed_args(...)`

### C) Audio ingest, separation, and pitch extraction

**Primary file:** `raga_pipeline/audio.py`

Edit here when you need to change:
- YouTube/recorded ingest behavior and trim validation
- demucs/spleeter separation invocation details
- SwiftF0 configuration/provider behavior
- pitch CSV caching and energy-track derivation

Key anchors:
- `download_youtube_audio(...)`
- `ingest_recorded_audio_file(...)` / `record_microphone_audio_interactive(...)`
- `separate_stems(...)`
- `extract_pitch(...)`

### D) Detect-phase signal analysis and scoring inputs

**Primary files:** `raga_pipeline/analysis.py`, `raga_pipeline/raga.py`

Edit in `analysis.py` when changing:
- histogram construction and smoothing
- peak detection thresholds/cross-validation rules
- GMM fitting and bias estimation internals

Edit in `raga.py` when changing:
- tonic bias candidate sets by source/instrument/gender
- candidate generation/scoring pipeline
- raga DB loading and aaroh/avroh pattern utilities
- post-transcription raga correction behavior

Key anchors:
- `compute_cent_histograms(...)`, `detect_peaks(...)`, `fit_gmm_to_peaks(...)`
- `get_tonic_candidates(...)`, `RagaScorer.score(...)`, `apply_raga_correction_to_notes(...)`

### E) Analyze-phase transcription and phrase logic

**Primary files:** `raga_pipeline/transcription.py`, `raga_pipeline/sequence.py`

Edit in `transcription.py` when changing:
- stationary/inflection note extraction
- energy gating semantics
- snapping behavior (chromatic/raga modes, bias-adjusted pitch)

Edit in `sequence.py` when changing:
- phrase detection (RMS silence primary, gap fallback)
- phrase clustering and transition matrix prep
- motif/directional pattern analysis and aaroh/avroh conformance checks

Key anchors:
- `transcribe_to_notes(...)`, `detect_stationary_events(...)`
- `detect_phrases_by_silence(...)` (primary when `phrase_method=rms`), `detect_phrases(...)` (gap fallback), `analyze_raga_patterns(...)`

### F) HTML reports, plots, and interactive frontend behavior

**Primary file:** `raga_pipeline/output.py`

Edit here when you need to change:
- static plot generation and export naming
- analyze/detect report HTML sections and JS interactions
- scrollable pitch plot behavior (cursor sync, click-to-seek, hover inspector)
- report metadata sidecar payload used by local-app transcription editor

Key anchors:
- `generate_detection_report(...)`, `generate_analysis_report(...)`
- `create_scrollable_pitch_plot_html(...)`
- `_generate_karaoke_section(...)`

### G) Local app backend/UI wiring (parameter-tuning app)

**Primary files:** `local_app/server.py`, `local_app/jobs.py`, `local_app/schemas.py`, `raga_pipeline/cli_schema.py`, `raga_pipeline/cli_args.py`

Edit in `local_app/server.py` for:
- API endpoints and artifact-discovery behavior
- report serving and asset URL rewriting
- transcription-edit API lifecycle (save/load/default/regenerate/delete)

Edit in `local_app/jobs.py` for:
- queue semantics, status/progress updates, cancellation policy
- run invocation path from structured params to pipeline execution

Edit in schema/argv adapters for:
- parser-driven frontend form shape and grouping
- stable conversion between UI payloads and CLI argument vectors

### H) Tests by responsibility (quick map)

- CLI/schema contracts: `tests/test_cli_schema_args.py`
- driver detect/analyze/preprocess behavior: `tests/test_driver_*.py`
- local app APIs/jobs/editor endpoints: `tests/test_local_app.py`
- report JS/HTML regressions: `tests/test_output_*.py`
- transcription and sequence correctness: `tests/test_transcription_*.py`, `tests/test_sequence_*.py`
- raga correction behavior: `tests/test_raga_correction_rounding.py`

### I) Safe edit workflow for high-confidence changes

1. Update parser/defaults first in `config.py` if behavior is CLI-configurable.
2. Update `driver.py` data flow only if module boundaries/inputs changed.
3. Update module internals (`audio.py`, `analysis.py`, `transcription.py`, `raga.py`, `sequence.py`, `output.py`).
4. Sync local app adapters (`cli_schema.py`, `cli_args.py`, `local_app/server.py`) when flags or output contracts change.
5. Add/update focused tests before broader runs.
6. Update `LLM_REFERENCE.md` + `CHANGELOG.md` in the same change set.

---

## Architecture & Data Flow

```
INPUT: local audio file (MP3/WAV/FLAC)
    ↑
[0] OPTIONAL PREPROCESS (audio.py)
    ↑ YouTube URL OR recorded audio/mic capture
download_youtube_audio OR ingest_recorded_audio_file OR record_microphone_audio_interactive
    -> <audio-dir>/<filename>.mp3
    (YouTube path supports optional trim with duration validation)
    ↓
[1] STEM SEPARATION (audio.py)
    ↓ demucs/spleeter (or skipped when detect uses --skip-separation)
    ├─→ vocals.mp3
    └─→ accompaniment.mp3
    ↓
[2] PITCH EXTRACTION (audio.py)
    ↓ SwiftF0
    ├─→ PitchData(vocals)    [cached: vocals_pitch_data.csv or melody_pitch_data.csv]
    ├─→ PitchData(accomp)    [cached: accompaniment_pitch_data.csv]
    └─→ PitchData(composite) [cached: composite_pitch_data.csv] (ALWAYS computed)
    ↓
    ├───────────────────────┬───────────────────────┐
    │                       │                       │
[3a] HISTOGRAM PATH    [3b] SEQUENCE PATH     [shared]
    │                       │                       │
    ↓                       ↓                       ↓
compute_cent_histograms  transcribe_to_notes  (uses PitchData)
    ↓
detect_stationary_events (detect mode only; vocal SwiftF0)
    ↓
stationary_note_histogram_duration_weighted.png / .csv (octave-wrapped 12-note duration-weighted totals)
    ↓                       ↓
HistogramData           List[Note]
    ↓                       ↓
detect_peaks            detect_phrases_by_silence (default, phrase_method=rms)
    ↓                       OR detect_phrases (gap fallback / --phrase-method gap)
PeakData                    ↓
 pitch_classes (Set)     List[Phrase]
    ↓                       ↓
generate_candidates     cluster_phrases
    ↓
List[Candidate]             ↓
    ↓                   compute_transition_matrix
List[Candidate]             ↓
    ↓                   analyze_raga_patterns
    ↓                   check_aaroh_avroh_conformance (if reference pattern exists)
pd.DataFrame (ranked)       ↓
    │                   Motifs, Aaroh/Avroh runs
    └───────────────────────┘
                ↓
[4] OUTPUT GENERATION (output.py)
                ↓
    ├─→ report.html (interactive)
    ├─→ analysis_report.html (Analyze mode)
    ├─→ histogram_vocals.png
    ├─→ stationary_note_histogram_duration_weighted.png (Detect mode)
    ├─→ stationary_note_histogram_duration_weighted.csv (Detect mode)
    ├─→ transcribed_notes.csv (Phase 2)
    ├─→ note_segments.png
    ├─→ transition_matrix.png
    └─→ candidates.csv
```

---

## Troubleshooting Guide

- If `analyze` fails before loading cached pitch data, verify `melody_pitch_data.csv` or `vocals_pitch_data.csv` exists in the stem directory. For skip-separation detects, analyze now falls back to `composite_pitch_data.csv` when stem pitch cache is absent.

---

## Type Checking

- Local static type checks are run with `mypy` using repository config in `mypy.ini`.
- Command:
  - `mypy driver.py raga_pipeline`
- The current setup ignores missing third-party stubs so internal pipeline typing issues are emphasized.
- Dataclass defaults in `analysis.py` and `output.py` use explicit typed helper functions for `default_factory` to improve compatibility with Pyright/Pylance overload resolution.

---

## Module Breakdown

### 1. `config.py` - Configuration Management

**Main Class:** `PipelineConfig` (dataclass)

**Key Fields (CLI defaults):**
| Field | Default | Description |
|-------|---------|-------------|
| `output_dir` | `"batch_results"` | Parent output directory (stems/reports written under `<output>/<engine>/<audio_filename>/`) |
| `mode` | `"detect"` | `"preprocess"`, `"detect"`, or `"analyze"` |
| `preprocess_ingest` | `None` (required in preprocess) | `"yt"`, `"recording"`, or `"tanpura_recording"` |
| `preprocess_tanpura_key` | `None` | Canonical tanpura key (`A,Bb,B,C,Db,D,Eb,E,F,Gb,G,Ab`); required for `tanpura_recording` |
| `preprocess_recorded_audio` | `None` | Existing recording path; if omitted in `recording`/`tanpura_recording` ingest, CLI captures mic audio |
| `source_type` | `"mixed"` | `"mixed"`, `"instrumental"`, `"vocal"` |
| `melody_source` | `"separated"` | `"separated"`, `"composite"` (use original mix for melody) |
| `vocalist_gender` | `None` | `"male"`, `"female"` (for vocal source) |
| `instrument_type` | `"autodetect"` | `"sitar"`, `"sarod"`, `"bansuri"`, `"slide_guitar"` |
| `bias_rotation` | `True` | Rotate histograms by median GMM deviation before scoring/plots (enabled by default; CLI flag disables) |
| `tonic_override` | `None` | Optional tonic constraint. Detect mode accepts comma-separated tonics. |
| `raga_override` | `None` | Optional raga constraint in detect; required in analyze. |
| `use_ml_model` | `False` | ML scoring disabled by default |
| `use_lm_scoring` | `True` | N-gram LM re-ranking enabled by default in detect mode |
| `lm_skip_correction` | `True` | Score chromatic transcription without per-hypothesis raga correction (matches uncorrected training) |

If `vocalist_gender` is provided via CLI, `source_type` is auto-set to `vocal`.

**Important Methods:**
- `build_cli_parser()` → Canonical parser factory used by both CLI and local app schema extraction.
- `parse_config_from_argv(argv)` → Parse `PipelineConfig` from explicit argument list.
- Local UI treats optional fields as blank-able (parser defaults apply) and conditionally shows dependent fields (e.g., `vocalist_gender` only for `source_type=vocal`).
- `load_config_from_cli()` → Parse command-line args
- `create_config(audio_path, output_dir, **kwargs)` → Programmatic config

---

### 2. `audio.py` - Audio Processing

**Main Classes:**
- `PitchData`: Container for pitch extraction results

**Key Functions:**

#### Preprocess ingest utilities
- `download_youtube_audio(...)`: YouTube download + optional trim.
- `ingest_recorded_audio_file(recorded_audio_path, audio_dir, filename_base)`: copy/convert an existing recorded file into preprocess MP3 output.
- `record_microphone_audio_interactive(audio_dir, filename_base, tanpura_key=None)`: interactive macOS CLI mic recording (`Enter` to start/stop) with optional tanpura playback.
- `play_tanpura_loop(tanpura_key)`: ffplay-based looping tanpura playback.
- `list_tanpura_tracks(...)` / `resolve_tanpura_track_path(...)`: canonical tanpura registry and path resolution.

#### `separate_stems(audio_path, output_dir, engine, model, device)`
- **Engines:** `'demucs'` (default) or `'spleeter'`
- **Returns:** `(vocals_path, accompaniment_path)`

#### `extract_pitch(audio_path, output_dir, prefix, fmin, fmax, confidence_threshold, force_recompute, energy_metric='rms')`
- **Pitch extractor:** SwiftF0 (deep learning-based)
- **Default range (CLI):** `G1` (~49 Hz) to `C6` (~1046 Hz)
- **Energy metric:** `'rms'` (peak-normalized) or `'log_amp'` (dBFS, percentile-normalized)
- **Returns:** `PitchData`

SwiftF0 provider behavior:
- `audio.py` builds SwiftF0 with fork-style kwargs when supported:
  - `execution_provider` (`auto|coreml|cpu`)
  - `provider_options` (currently `None`)
  - `fallback_to_cpu` (disabled only when `RAGA_SWIFTF0_STRICT_PROVIDER=1`)
  - `verbose_provider_logs` (from `RAGA_SWIFTF0_PROVIDER_LOGS`)
- If installed `swift_f0` does not support these kwargs yet, `audio.py` falls back to legacy constructor.

---

### 3. `analysis.py` - Histogram & Peak Detection

**Main Classes:**
- `HistogramData`: Dual-resolution cent histograms
- `PeakData`: Detected peaks with pitch class mapping

**Key Functions:**

#### `compute_cent_histograms(pitch_data, bins_high=100, bins_low=33, sigma=0.8)`
- **Purpose:** Build pitch class distribution histograms (100 bins and 33 bins).

#### `detect_peaks(histogram, ...)`
- **Cross-validation:** Peaks must appear in both high-res AND low-res histograms.

---

### 4. `transcription.py` - Note Detection (Newer)

#### `transcribe_to_notes(pitch_hz, timestamps, voicing_mask, tonic, ...)` (Unified)
- **Purpose:** Primary transcription entry point.
- **Algorithm:** Combines Stationary Points + Inflection Points.
- **Stationary Points:** Detects stable pitch regions (dp/dt < threshold).
- **Inflection Points:** Detects turning points in pitch (murkis, tans).
- **Filtering:** Applies minimum duration checks and single-pass energy gating inside transcription for both stationary and inflection notes.
- **Inflection Energy:** Inflection notes sample nearest-frame energy from aligned pitch timestamps before thresholding.
- **Snapping:** Always snaps to the nearest chromatic target by default. In raga mode, if the nearest chromatic target is outside the raga, the second-closest target is used if it is inside the raga; otherwise the note is skipped.
- **Returns:** List of `Note` objects.
- **Bias Rotation:** Optional `bias_cents` rotates pitch before snapping so transcription can align with histogram/GMM bias correction.

#### `detect_stationary_events(...)`
- **Logic:** Gaussian smoothing → Derivative → Stable region segmentation.
- **Bias Rotation:** Supports optional `bias_cents` pre-snap adjustment.

#### `detect_pitch_inflection_points(...)`
- **Logic:** Finds zero-crossings of the first derivative to capture note peaks/valleys.

---

### 5. `sequence.py` - Note & Phrase Data Structures

**Main Classes:**
- `Note`: A detected musical note with timing, pitch, confidence, sargam label
- `Phrase`: Group of consecutive notes

**Key Constants:**
```python
OFFSET_TO_SARGAM = {
    0: "Sa", 1: "re", 2: "Re", 3: "ga", 4: "Ga",
    5: "ma", 6: "Ma", 7: "Pa", 8: "dha", 9: "Dha",
    10: "ni", 11: "Ni"
}
```

#### `tokenize_notes_for_lm(notes, tonic_midi, phrase_gap_sec=0.25, include_direction=False, phrases=None) -> List[List[str]]`
- **Purpose:** Shared tokenizer for n-gram language models. Converts notes to octave-marked sargam tokens with `<BOS>` phrase boundaries.
- **Token format:** middle octave = bare (`Sa`, `Re`); one below = `'` suffix (`Ni'`); one above = `''` suffix (`Sa''`); extremes clipped to boundary octave.
- **Phrase boundaries (two modes):**
  - If `phrases` (`List[Phrase]`) is provided: uses pre-computed phrase boundaries directly. `notes` and `phrase_gap_sec` are ignored.
  - Otherwise: gaps > `phrase_gap_sec` (default 0.25 s) between consecutive notes insert a `<BOS>` token.
- **Empty input:** returns `[]`.

#### `analyze_raga_patterns(phrases, tonic, expected_aaroh=None, expected_avroh=None)`
- **Purpose:** Comprehensive pattern aggregator (Motifs + Aaroh/Avroh runs).
- **Checker Integration:** If expected directional vectors are provided, adds `aaroh_avroh_checker` results to pattern output.

#### `check_aaroh_avroh_conformance(phrases, tonic, expected_aaroh, expected_avroh, min_edges_per_note=3)`
- **Purpose:** Compare observed directional incoming-edge usage with expected aaroh/avroh note presence.
- **Output:** score, mismatch lists (missing/unexpected note-direction usage), and per-note edge evidence.

### `raga.py` directional utilities
- `build_aaroh_avroh_subset(aaroh_avroh_csv_path, raga_db_csv_path, output_csv_path)`: Creates aligned subset with canonical raga names from `raga_list_final.csv`.
- `load_aaroh_avroh_patterns(csv_path)`: Parses textual Aroha/Avroh notation into 12-note directional vectors.
- `get_aaroh_avroh_pattern_for_raga(raga_name, pattern_lookup)`: Resolves expected pattern for detected raga name.

#### `detect_phrases_by_silence(notes, energy, timestamps, silence_threshold, silence_min_duration, min_phrase_duration, min_notes_in_phrase)`
- **Purpose:** Primary phrase detection using RMS energy silence regions. Takes flat `List[Note]` and returns `List[Phrase]`.
- **When used:** Default phrase method (`config.phrase_method == "rms"`) when energy data is available and `silence_threshold > 0`.
- **Fallback:** If energy is unavailable, `silence_threshold <= 0`, or `--phrase-method gap`, driver uses gap-based `detect_phrases()` instead.
- **Default:** `silence_threshold=0.10`, `silence_min_duration=0.25`, `min_phrase_duration=0.2`, `min_notes_in_phrase=1`.

#### `detect_phrases(notes, max_gap, min_length, min_phrase_duration)`
- **Purpose:** Legacy inter-note gap phrase detection (KMeans on temporal gaps).
- **When used:** Fallback when RMS silence detection is inactive (`--phrase-method gap`, missing energy, or `silence_threshold <= 0`).

*Historical note:* An older two-stage flow (`detect_phrases` then `split_phrases_by_silence`) was replaced by the single dispatch above. `split_phrases_by_silence` is being removed as dead code.

---

### 6. `output.py` - Visualization & Reports

#### `generate_html_report(results, output_path)`
- **Comprehensive interactive report** with synchronized Plotly charts and audio player.
- Audio playback is single-active in report players (starting one pauses others).

#### `generate_analysis_report(results, stats, output_dir)`
- **Analyze mode report** with pattern analysis, aaroh/avroh checker summary, raga correction, energy plots, RMS overlay, top Phrase Karaoke scrolling view with note-level cumulative highlighting (sung notes stay lit), playback-speed buttons (`1x`, `0.5x`, `0.25x`) for slower transcription verification, and single-active audio playback (playing one track pauses the others).
- Report transcription labels are normalized for readability using a recording-relative median Sa anchor; octave markers are suppressed in normal range and only shown for notes 3+ octaves below that anchor.
- Includes a note-duration distribution visualization (`note_duration_histogram.png`) in the detailed visualizations section when transcribed notes are available.
- Report is now read-only for transcription edits; edit workflow lives in local app Analyze workspace (embedded report + editor panel).

#### `plot_note_duration_histogram(notes, output_path, title="Note Duration Distribution")`
- Plots a histogram of transcribed note durations (seconds).
- Adds mean and median reference lines for quick phrase/tempo spread inspection.
- Used in analyze mode after note-merge cleanup.

#### `_generate_karaoke_section(phrases, tonic, audio_element_ids)`
- Generates the top Phrase Karaoke UI used in analyze reports.
- Note timeline highlights are cumulative within phrase rows: completed notes keep the `sung` style and current note gets `current`.
- The karaoke UI intentionally omits the older horizontal ticker strip; only phrase-wise scrolling rows are shown.
- To keep seeking responsive on long transcriptions, cumulative sung-note updates are applied in animation-frame chunks, and sync updates are coalesced through a single frame scheduler (`latest pending update wins`) with instant phrase-list scroll jumps on seek events.

#### `create_scrollable_pitch_plot_html(...)`
- Uses explicit plot x-axis bounds and margin-aware time mapping for click-to-seek.
- Uses active-audio tracking with an rAF follow loop plus seek/play/metadata events so the cursor keeps moving reliably during playback without redundant per-track `timeupdate` handlers.
- After seek, it re-resolves the active source by prioritizing whichever audio is actually playing, which prevents cursor freeze when multiple synced players emit `seeked`.
- On click/seek, cursor and horizontal scroll are snapped immediately to reduce perceived lag.
- Hover tooltip now includes `Pitch @ t` (nearest pitch-track sample at hovered time, rendered as sargam/western note + MIDI) above nearest transcription-note details.
- Hover also renders dotted guides for spatial reading: a vertical guide from x-axis to the hovered pitch point and a horizontal guide from that point to y-axis.
- Supports optional `bias_cents` so displayed contour/hover pitch values stay aligned with rotated histogram/transcription reference.

---

### 7. Batch Processing (New)
Added `raga_pipeline/batch.py` for processing entire directories of audio.
- Walks directory for `.mp3`, `.wav`, `.flac`, `.m4a`.
- Matches filenames against the ground truth CSV (optional).
- Runs `analyze` mode if ground truth found, else `detect`.
- Defaults `--ground-truth` to `<input_dir>_gt.csv` stored alongside the input directory.
- Invokes `driver.py` with the current Python interpreter (does not shell out to `run_pipeline.sh`).
- Supports resumable checkpoints via JSON progress file (`--progress-file`).
- Supports HPC chunking with `--max-files` and scheduler resubmission loops via `--exit-99-on-remaining`.
- Logs all output to `<output>/logs/`.

**Usage:**
```bash
python -m raga_pipeline.batch /path/to/audio/dir
```

---

### 8. Language Model for Raga Detection

N-gram language model approach to raga classification (`raga_pipeline/language_model/`). Builds per-raga probability distributions over sargam token sequences, classifies by perplexity.

**Production model:** `raga_pipeline/models/compmusic_ngram_model.json` -- order=7, 30 ragas, trained on all 297 CompMusic recordings from uncorrected transcriptions (`separated_stems_nocorrection`). **Enabled by default** (`use_lm_scoring=True`, `lm_skip_correction=True` in `config.py`). LM re-ranking runs as Step 5.5 in detect mode and updates `results.detected_raga` with the combined top-1 raga. Model auto-discovered by `config._find_lm_model_path()`.

**Token format:** Octave-marked sargam: `Sa`, `Re'` (lower octave), `Ga''` (upper octave), with `<BOS>` at phrase boundaries. Shared tokenizer: `sequence.py:tokenize_notes_for_lm(notes, tonic_midi, phrase_gap_sec, phrases=None)`. When `phrases` (pre-computed `List[Phrase]`) is passed, phrase boundaries come from the pipeline's phrase detection (e.g. `detect_phrases_by_silence`) instead of the 0.25s gap heuristic.

**CLI:**
```bash
python -m raga_pipeline.language_model train --gt gt.csv --results-dir results/ --output model.json
python -m raga_pipeline.language_model score --model model.json --transcription notes.csv --tonic C#
python -m raga_pipeline.language_model evaluate --gt gt.csv --results-dir results/ --sweep-orders 2,3,4,5,6
```

**Key classes/functions:**
- `NgramModel`: per-raga n-gram counts, add-k smoothing, interpolated scoring, JSON serialization
- `alignment.py`: Noisy-channel alignment scorer. Token utilities: `token_pitch_info(token)` extracts `(pitch_class, octave)`, `pitch_distance()` computes circular semitone distance, `build_substitution_map(vocab, max_distance)` pre-computes substitution pairs. Beam DP scorer: `score_phrase_aligned(model, raga, phrase, config, sub_map)` and `score_sequence_aligned(model, raga, phrases, config, sub_map)` score noisy sequences against a trained LM via beam-search DP with skip/substitution costs. Configured via `AlignmentConfig(lambda_skip, lambda_sub, beam_width, max_sub_distance)`. Returns `AlignmentResult(lm_per_token, n_matched, n_skipped, n_substituted, skip_fraction, total_sub_distance, raw_lm_sum)`.
- `NgramModel.vocabulary` (property): public access to the `_vocabulary` set
- `NgramModel.remove_raga(raga)`: removes a raga from all internal count dicts (for LOO evaluation)
- `train_model()`: corpus-level training from GT CSV + transcription CSVs (reuses `motifs.py` candidate discovery)
- `score_transcription()`: single-recording scoring with optional segment-level confidence curves
- `evaluate_model()`: leave-one-out cross-validation with order sweep

---

### 9. Configuration Parameters (Current Defaults)

```python
# Note detection
note_min_duration = 0.1         # 100ms minimum note duration
transcription_min_duration = 0.02  # 20ms minimum for stationary points
energy_threshold = 0.0          # Per-track normalized energy gate (0-1)
energy_metric = "rms"           # 'rms' (peak-normalised) or 'log_amp' (dBFS, percentile-normalised)
transcription_derivative_threshold = 4.0  # Stability threshold (semitones/sec)
transcription_smoothing_ms = 0  # No smoothing by default

# Pitch extractor selection
pitch_extractor = "swiftf0"     # 'swiftf0' or 'pyin'
pitch_hop_ms = 0.0              # 0 = extractor default; pyin ~23ms
compare_extractors = False      # Analyze: run both extractors, calibrate, toggle in report

# Silence-based phrase splitting
silence_threshold = 0.10        # Analyze-mode default RMS threshold (0-1)
silence_min_duration = 0.25     # Min consecutive seconds of silence for a break

# Phrase filtering
phrase_method = "rms"           # "rms" (energy-based silence detection) or "gap" (legacy inter-note gap)
phrase_min_duration = 0.2       # Exclude phrases shorter than this duration (seconds)
phrase_min_length = 1           # Exclude phrases with fewer notes than this count

# Visualization
show_rms_overlay = True         # RMS energy trace on pitch plots (Plotly + scrollable)

# Separator
separator_engine = "demucs"
demucs_model = "htdemucs"
```

---

### 9. Output Files & Caching

```
{output_dir}/{demucs_model}/{filename}/
├── vocals.mp3
├── accompaniment.mp3
├── vocals_pitch_data.csv (or melody_pitch_data.csv if using composite)
├── accompaniment_pitch_data.csv
├── composite_pitch_data.csv (always computed)
├── analysis_report.html (Analyze mode)
├── analysis_report.meta.json (report context + `transcription_edit_payload` seed for local-app editor)
└── detection_report.html (Detect mode)
```

Directional DB assets:
```
raga_pipeline/data/
└── aarohavroha_subset.csv   # subset aligned to raga_list_final names
```
