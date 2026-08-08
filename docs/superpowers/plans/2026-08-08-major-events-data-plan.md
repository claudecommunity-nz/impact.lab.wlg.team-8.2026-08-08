# Major Events Data Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible six-month major-events snapshot with broad future coverage and a smaller, evidence-backed historical set, emitted as a committed JSON artefact without changing the UI.

**Architecture:** Public source pages and feeds are captured into ignored `data/raw/events/` snapshots. A pure normalizer reads a committed, manually reviewed seed file, validates and deduplicates records, and writes `team8/poc_1/web/public/data/events/major-events.json`. The event build remains a separate command from `poc-data`, so the existing movement demo does not depend on event-source availability.

**Tech Stack:** Python 3.12 standard library plus the repository's existing `requests` dependency; JSON; GTFS ZIP/CSV parsing; `unittest`; `just`.

## Global Constraints

- Future window is `2026-08-08` through `2026-11-08`.
- Historical window is `2026-05-08` through `2026-08-08` and is curated, not exhaustive.
- Raw publisher-owned source data stays under ignored `data/raw/events/`.
- Only the normalized derived artefact is committed for the demo.
- No UI integration, airport flight ingestion, road-closure analysis, or causal attribution is included.
- `expected_scale` is nullable and must never be invented.
- Every emitted event has a source URL, capture method, confidence and local timestamp.
- The event build must run independently of the movement pipeline and must not require a network connection once the seed is present.

---

## File Structure

Create the following focused units:

- `team8/fetch_data/events.py` — event contract, normalization, deduplication, validation, snapshot emission and CLI.
- `team8/fetch_data/pull_events.py` — source URL registry and raw snapshot capture; no normalization logic.
- `data/curated/major_events_seed.json` — reviewed six-month seed rows and source manifest; committed and intentionally small.
- `tests/__init__.py` — makes the standard-library test package importable with the documented commands.
- `tests/test_events.py` — pure contract and normalization tests using no network.
- `team8/poc_1/web/public/data/events/major-events.json` — committed demo artefact generated from the seed.
- `justfile` — `pull-events` and `events` commands only; leave `poc-data` unchanged.

No files under `team8/poc_1/web/src/` are modified in this pass.

## Task 1: Define the event contract and pure normalizer

**Files:**
- Create: `team8/fetch_data/events.py`
- Create: `tests/__init__.py`
- Create: `tests/test_events.py`

**Interfaces:**
- `normalize_row(raw: dict, *, captured_at: str) -> dict`
- `event_id(row: dict) -> str`
- `deduplicate(rows: list[dict]) -> list[dict]`
- `build_snapshot(seed: dict, *, captured_at: str) -> dict`
- `validate_snapshot(snapshot: dict) -> None`
- `main() -> None`

- [ ] **Step 1: Create the test package and write failing tests for required fields and normalization**

Create an empty `tests/__init__.py` so `python -m unittest tests.test_events -v` works
consistently across Python environments. Then add `unittest` cases that call
`normalize_row` with this input:

```python
raw = {
    "event_type": "concert",
    "name": "Example Concert",
    "venue_or_terminal": "TSB Arena",
    "latitude": -41.29,
    "longitude": 174.78,
    "start_time_local": "2026-09-01T19:30:00+12:00",
    "end_time_local": "2026-09-01T22:00:00+12:00",
    "expected_scale": 1000,
    "scale_basis": "venue_capacity",
    "status": "scheduled",
    "source_url": "https://example.test/event",
    "confidence": "high",
    "record_type": "event",
    "capture_method": "html",
}
row = normalize_row(raw, captured_at="2026-08-08T10:00:00+12:00")
```

Assert that the result has a stable `event_id`, preserves the local offset, sets
`captured_at`, and includes `first_seen` and `last_seen` equal to the capture time.

Add tests that invalid rows raise `ValueError` for a missing name, missing source URL,
invalid event type, a naive timestamp without an offset, or a non-null scale without a
scale basis.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
python -m unittest tests.test_events -v
```

Expected: import or assertion failures because the event module does not exist yet.

- [ ] **Step 3: Implement the minimal contract**

In `events.py`:

1. Define constants for the allowed event types, statuses, scale bases, record types and capture methods.
2. Parse timestamps with `datetime.fromisoformat` and reject values whose `tzinfo` is missing.
3. Normalize names and venue strings by collapsing whitespace and trimming.
4. Generate `event_id` as the first 16 hexadecimal characters of SHA-256 over `event_type`, normalized name, normalized venue and `start_time_local`, joined by `|`.
5. Copy the agreed fields plus `source_urls`, `scale_notes`, `captured_at`, `first_seen` and `last_seen`.
6. Preserve `expected_scale` as `None` when the seed does not provide a defensible value.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
python -m unittest tests.test_events -v
```

Expected: all contract tests pass.

- [ ] **Step 5: Commit the contract**

```bash
git add team8/fetch_data/events.py tests/test_events.py
git commit -m "feat: add major events normalization contract"
```

## Task 2: Add deduplication, window validation and snapshot emission

**Files:**
- Modify: `team8/fetch_data/events.py`
- Modify: `tests/test_events.py`

**Interfaces:**
- `deduplicate` merges rows with the same `event_id`.
- `build_snapshot` returns the top-level `version`, `captured_at`, `window`, `sources`, `events` and `transport_context` object.
- `validate_snapshot` raises `ValueError` for invalid output and returns `None` for valid output.

- [ ] **Step 1: Write failing tests for deduplication and the six-month window**

Add tests for:

```python
first = normalize_row(raw, captured_at="2026-08-08T10:00:00+12:00")
second = dict(first, source_url="https://example.test/corroboration")
merged = deduplicate([first, second])
assert len(merged) == 1
assert "https://example.test/corroboration" in merged[0]["source_urls"]
```

Add a snapshot test with one historical and one future record. Assert that a record
before `2026-05-08` or after `2026-11-08` raises `ValueError`, and that a valid snapshot
has at least four source families represented in `sources`.

- [ ] **Step 2: Run tests and verify the new cases fail**

```bash
python -m unittest tests.test_events -v
```

Expected: failures in merge, window and snapshot assertions.

- [ ] **Step 3: Implement deterministic merge and validation**

Implement `deduplicate` by preserving the first normalized row, merging unique
`source_urls`, and keeping the highest-confidence value using the ordering
`low < medium < high`. If duplicate rows disagree on scale, retain the value from
the higher-confidence row and append both statements to `scale_notes`.

Implement `build_snapshot` with the fixed demo window and a top-level source manifest
whose entries contain:

```text
source_id, name, url, format, captured_at, coverage, notes
```

Implement `validate_snapshot` to check the window, required fields, timestamp offsets,
valid coordinates when present, unique IDs, source URLs and scale-basis consistency.
Treat null coordinates and null scale as warnings printed by the CLI, not errors.

- [ ] **Step 4: Run tests and verify they pass**

```bash
python -m unittest tests.test_events -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit the snapshot logic**

```bash
git add team8/fetch_data/events.py tests/test_events.py
git commit -m "feat: validate and emit major events snapshots"
```

## Task 3: Add the raw-source capture command

**Files:**
- Create: `team8/fetch_data/pull_events.py`
- Modify: `justfile`
- Modify: `tests/test_events.py`

**Interfaces:**
- `SOURCE_REGISTRY` contains WellingtonNZ, venue, CentrePort, Metlink GTFS, Interislander and Bluebridge entries.
- `capture_source(source: dict, *, captured_at: str, raw_root: Path) -> dict` saves one raw file and returns a manifest row.
- `main() -> None` captures all registry entries and writes `data/raw/events/capture-manifest.json`.

- [ ] **Step 1: Write a test for safe capture paths and manifest rows**

Use a temporary directory and a fake response object. Assert that a source URL is
written below the requested raw root, the filename contains no path separator, and the
returned manifest row includes `source_id`, `url`, `captured_at`, `format` and `path`.

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
python -m unittest tests.test_events.TestSourceCapture -v
```

Expected: import or attribute failure because `pull_events.py` does not exist.

- [ ] **Step 3: Implement source capture without parsing**

Use `requests.get(..., timeout=60)` with a descriptive User-Agent and `raise_for_status()`.
Write HTML pages as UTF-8 text, PDFs and GTFS ZIPs as bytes, and never execute or
interpret downloaded content during capture. Use explicit source IDs:

```text
wellingtonnz-major-events
wellingtonnz-event-pages
venue-calendars
centreport-cruise
metlink-gtfs
interislander-timetable
bluebridge-timetable
```

The command must create the ignored directory if needed and write a compact JSON
manifest. It must fail with a clear source ID and URL if any request fails.

- [ ] **Step 4: Add commands to `justfile`**

Add:

```just
pull-events:
    uv run python -m team8.fetch_data.pull_events

events:
    uv run python -m team8.fetch_data.events
```

Keep `poc-data` independent of both commands.

- [ ] **Step 5: Run the focused tests and lint checks**

```bash
python -m unittest tests.test_events -v
git diff --check
```

- [ ] **Step 6: Commit the capture command**

```bash
git add team8/fetch_data/pull_events.py tests/test_events.py justfile
git commit -m "feat: add major events source capture command"
```

## Task 4: Seed the six-month demo records

**Files:**
- Create: `data/curated/major_events_seed.json`
- Modify: `team8/fetch_data/events.py`
- Modify: `tests/test_events.py`

**Interfaces:**
- The seed JSON has `captured_at`, `window`, `sources` and `events` keys.
- The CLI loads the seed from `data/curated/major_events_seed.json` by default.
- The seed contains only manually reviewed records with source URLs.

- [ ] **Step 1: Add tests for source-family coverage and seed loading**

Add a test that loads the committed seed and asserts:

```python
assert seed["window"] == {
    "past_start": "2026-05-08",
    "capture_date": "2026-08-08",
    "future_end": "2026-11-08",
}
assert {source["source_id"] for source in seed["sources"]} >= {
    "wellingtonnz-major-events",
    "venue-calendars",
    "centreport-cruise",
    "metlink-gtfs",
    "interislander-timetable",
    "bluebridge-timetable",
}
```

Require at least one historical record and at least one future record, with no
historical claim that lacks a source URL.

- [ ] **Step 2: Add reviewed future records**

Seed the next-three-month window with confirmed records from WellingtonNZ and official
venue pages, including the available major festivals, arena events, stadium events and
concert series. Add CentrePort cruise calls that fall in the window. Use venue lookup
coordinates for named venues and null coordinates for genuinely multi-venue events.

Use `expected_scale: null` unless the source explicitly gives an audience estimate,
venue capacity or cruise PAX value. Use `confidence: high` for official venue/CentrePort
records and `medium` for curated aggregator or WellingtonNZ records when the exact
session time is not published.

- [ ] **Step 3: Add the curated historical records**

Add a smaller set of confirmed May–August events from official event pages, venue pages,
WellingtonNZ records and prior cruise schedules. Mark them `status: completed` only when
the source confirms the event occurred or its date has passed without a cancellation
notice. Use `capture_method: manual` for backfilled rows and add a `scale_notes` entry
when the historical record is incomplete.

- [ ] **Step 4: Add recurring ferry service records and GTFS context**

Generate dated ferry scheduled-service records for the six-month window from the
Interislander and Bluebridge timetable patterns. Keep `expected_scale` null unless a
published capacity is available. Read the Metlink GTFS ZIP to produce a compact
`transport_context` object containing capture metadata, route count, stop count and the
ferry/rail/bus service date range; do not emit every bus or rail trip as an event.

- [ ] **Step 5: Run normalization against the seed**

Run:

```bash
just events
```

Expected: the CLI reports the number of source rows, deduplicated events, historical
records, future records, scheduled-service records and warnings for unknown scale or
coordinates.

- [ ] **Step 6: Run tests and commit the reviewed seed**

```bash
python -m unittest tests.test_events -v
git diff --check
git add data/curated/major_events_seed.json team8/fetch_data/events.py tests/test_events.py
git commit -m "data: seed six-month Wellington major events snapshot"
```

## Task 5: Emit and verify the committed demo artefact

**Files:**
- Modify: `team8/fetch_data/events.py`
- Create: `team8/poc_1/web/public/data/events/major-events.json`
- Modify: `tests/test_events.py`

**Interfaces:**
- `events.py` writes the artifact to `config.OUT / "events" / "major-events.json"` or the equivalent repository-relative path without requiring the movement parquet files.
- The artifact is valid JSON and validates through `validate_snapshot` after writing.

- [ ] **Step 1: Add an artifact round-trip test**

Build a snapshot into a temporary path, read it back with `json.loads`, and assert that
the parsed object passes `validate_snapshot` and preserves event IDs, source URLs and
the six-month window.

- [ ] **Step 2: Implement the CLI writer**

Load the seed, use its fixed capture date for the demo snapshot, normalize all rows,
deduplicate, build the snapshot, validate it, and write compact JSON with UTF-8
encoding. Print the output path and record counts. Do not call `requests` from this
path; network capture remains an explicit `pull-events` action.

- [ ] **Step 3: Generate the artifact**

```bash
just events
```

Expected output file:

```text
team8/poc_1/web/public/data/events/major-events.json
```

- [ ] **Step 4: Run complete verification**

```bash
python -m unittest discover -s tests -p 'test_*.py' -v
just events
python -m json.tool team8/poc_1/web/public/data/events/major-events.json >/dev/null
git diff --check
git status --short
```

Expected: all tests pass, the JSON parses, the artifact is inside the six-month window,
and no ignored raw source files are staged.

- [ ] **Step 5: Commit the demo artifact**

```bash
git add team8/poc_1/web/public/data/events/major-events.json tests/test_events.py team8/fetch_data/events.py
git commit -m "build: emit major events demo artifact"
```

## Handoff

After implementation, report:

- branch name;
- output file path;
- capture timestamp and date window;
- counts by source, event type, historical/future status and confidence;
- number of rows with unknown scale or coordinates;
- exact test and build commands run;
- the limitation that the historical set is curated rather than exhaustive.
