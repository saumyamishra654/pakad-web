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

---

# Raga Pipeline - Quick Reference for LLMs

**Last Updated:** 2026-02-26

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
- `--ingest youtube`: requires `--yt`, supports `--start-time/--end-time`.
- `--ingest record`: supports `--recorded-audio` or interactive CLI mic capture; `tanpura_vocal` mode requires `--tanpura-key`.

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

**Other Directories:**
- **`pretrained_models/`**: Stores ML models/weights for scoring.
- **`local_app/`**: Local FastAPI app (`server.py`, `jobs.py`, templates/static) for interactive runs.
  - UI parses printed next-step commands from logs to auto-load next-mode parameters.
  - Preprocess UI uses backend `ffmpeg` mic capture (same ingest path as CLI recording) and stores saved takes into `--recorded-audio`.
  - Tanpura catalog is exposed at `/api/tanpura-tracks` and used for in-app playback during tanpura-vocal recording mode.
  - Report serving rewrites relative asset links to `/local-files/...`; large embedded `data:` URIs are fast-skipped during rewrite to keep analyze report loads stable.
  - Analyze workspace includes an embedded analyze-report iframe plus in-app transcription editor (versioned save/load/default/regenerate/delete) driven by `/api/transcription-edits/...`.
  - The editor initializes from report metadata payload (`analysis_report.meta.json` -> `transcription_edit_payload`) via `/api/transcription-edits/{dir_token}/{report_name}/base`; legacy reports without this payload require rerunning analyze.

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
- phrase detection and silence splitting
- phrase clustering and transition matrix prep
- motif/directional pattern analysis and aaroh/avroh conformance checks

Key anchors:
- `transcribe_to_notes(...)`, `detect_stationary_events(...)`
- `detect_phrases(...)`, `split_phrases_by_silence(...)`, `analyze_raga_patterns(...)`

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
detect_peaks            detect_phrases
    ↓                       ↓
PeakData                List[Phrase]
 pitch_classes (Set)        ↓
    ↓                   split_phrases_by_silence (optional, RMS)
generate_candidates         ↓
    ↓                   cluster_phrases
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
| `preprocess_ingest` | `"youtube"` | `"youtube"` or `"record"` (preprocess only) |
| `preprocess_record_mode` | `"song"` | `"song"` or `"tanpura_vocal"` (record ingest only) |
| `preprocess_tanpura_key` | `None` | Canonical tanpura key (`A,Bb,B,C,Db,D,Eb,E,F,Gb,G,Ab`) |
| `preprocess_recorded_audio` | `None` | Existing recording path; if omitted in record ingest, CLI captures mic audio |
| `source_type` | `"mixed"` | `"mixed"`, `"instrumental"`, `"vocal"` |
| `melody_source` | `"separated"` | `"separated"`, `"composite"` (use original mix for melody) |
| `vocalist_gender` | `None` | `"male"`, `"female"` (for vocal source) |
| `instrument_type` | `"autodetect"` | `"sitar"`, `"sarod"`, `"bansuri"`, `"slide_guitar"` |
| `bias_rotation` | `True` | Rotate histograms by median GMM deviation before scoring/plots (enabled by default; CLI flag disables) |
| `tonic_override` | `None` | Optional tonic constraint. Detect mode accepts comma-separated tonics. |
| `raga_override` | `None` | Optional raga constraint in detect; required in analyze. |
| `use_ml_model` | `False` | ML scoring disabled by default |

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

#### `split_phrases_by_silence(phrases, energy, timestamps, silence_threshold, silence_min_duration)`
- **Purpose:** Re-split existing phrases at points where vocal RMS drops below `silence_threshold` for at least `silence_min_duration` seconds.
- **When used:** After `detect_phrases()`, controlled by `config.silence_threshold`.
- **Default:** Analyze CLI default is `0.10`; if set to `0`, the pipeline can fall back to `energy_threshold` when that is set.

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

### 8. Configuration Parameters (Current Defaults)

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
