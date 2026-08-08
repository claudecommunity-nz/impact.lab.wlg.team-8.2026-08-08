# Major Events Data Snapshot

## Goal

Create a reproducible, data-only major-events artefact for the Pōneke Pulse demo.
The artefact will describe scheduled future events and a smaller, evidence-backed
historical set so the same source can support both anticipation and explanation of
movement anomalies.

This pass does not add a UI view and does not claim to provide a complete historical
events archive.

## Scope

The snapshot covers:

- future window: 2026-08-08 through 2026-11-08;
- curated historical window: 2026-05-08 through 2026-08-08;
- WellingtonNZ major events and event pages;
- official venue calendars;
- CentrePort cruise schedules;
- Metlink GTFS and Cook Strait ferry timetables.

Road-closure data is intentionally excluded from this feature. Airport flight data is
also deferred because the public sources are better suited to current boards and
monthly summaries than a stable three-month event schedule.

## Approaches considered

### Hand-curated JSON

Fastest for the demo, but not repeatable and difficult to refresh without changing the
data by hand.

### Small capture-and-normalize pipeline — selected

Fetch public source pages and feeds into ignored raw snapshots, normalize them into a
single derived JSON artefact, and keep source URLs and capture timestamps on every
record. This provides enough repeatability for the demo without depending on private
APIs.

### Full API integration

Better long-term, but disproportionate for the hackathon because venue APIs are
fragmented and Eventfinda access varies by account type.

## Data flow

```text
public pages / feeds
        |
        v
data/raw/events/                 ignored source snapshots
        |
        v
team8/fetch_data/pull_events.py  fetch + source-specific extraction
        |
        v
normalization + validation
        |
        v
team8/poc_1/web/public/data/events/major-events.json
```

Raw source files remain uncommitted, consistent with the repository's policy on
publisher-owned source data. The normalized derived artefact is committed because the
static demo serves committed files directly.

## Source handling

### WellingtonNZ

Use the major-events page and linked event pages for publicly announced events. These
are the primary source for large festivals, concerts and multi-venue programmes.

### Official venues

Capture event listings from Hnry Stadium, TSB Arena, Michael Fowler Centre, Tākina,
Te Papa and other clearly relevant venues. A small static venue lookup supplies stable
coordinates and venue metadata when event pages name a venue but do not provide a
point.

### CentrePort

Capture the cruise schedule table or PDF. Arrival and departure are retained as local
times, and PAX is stored as a capacity/scale proxy, never as confirmed attendance.
Schedule changes and incomplete updates are represented in provenance and confidence.

### Metlink and ferries

Download the Metlink GTFS ZIP for service and stop context. Do not emit every bus and
rail trip as a major event. Represent Cook Strait ferry sailings as scheduled-service
records and retain a compact transport-context summary derived from GTFS. The
Interislander and Bluebridge pages remain the authoritative timetable sources for
their sailings.

## Output contract

The top-level JSON object is:

```text
version
captured_at
window: { past_start, capture_date, future_end }
sources[]: { source_id, name, url, format, captured_at, coverage, notes }
events[]
transport_context
```

Each `events[]` record contains:

```text
event_id
event_type              # stadium, concert, festival, cruise, airport, ferry
name
venue_or_terminal
latitude
longitude
start_time_local
end_time_local
expected_scale
scale_basis             # audience estimate, venue capacity, cruise PAX, unknown
status                  # scheduled, cancelled, completed, unknown
source_url
source_urls[]             # optional additional corroborating sources
captured_at
first_seen
last_seen
confidence
record_type             # event or scheduled_service
capture_method           # html, pdf, gtfs, manual
scale_notes
```

`expected_scale` is nullable. The pipeline must not invent attendance. A venue
capacity, published estimate or cruise PAX value may be retained with an explicit
`scale_basis`; otherwise the value is null and `scale_basis` is `unknown`.

## Historical coverage rule

The historical set is curated rather than exhaustive. Only records with a source page,
official venue record, official schedule or other retained evidence are included.
Records added by manual backfill carry `capture_method: manual` and an appropriate
confidence value. Absence from the historical set is not evidence that no event took
place.

## Periodic capture

The fetch command will be safe to rerun and will record a new `captured_at` value. The
normalization step will preserve `first_seen` and update `last_seen` for stable events.
The demo snapshot is captured on 2026-08-08; a later refresh should update the window
relative to its new capture date rather than silently mixing vintages.

## Deduplication

Events are matched using normalized name, venue and local start time. When multiple
official sources describe the same event, the normalized record is merged and retains
the strongest source in `source_url` plus any corroborating links in `source_urls[]`.
Cancelled records are retained rather than deleted so the snapshot can explain why a
previously anticipated event no longer appears in the future set.

## Validation

The data build will fail on:

- records outside the requested window;
- missing required identity, time or source fields;
- invalid or partially specified timestamps;
- malformed coordinates when coordinates are present;
- duplicate event IDs after normalization;
- scale values without a scale basis;
- missing source URLs or capture methods.

The build will warn, but not fail, for unknown attendance, missing venue coordinates,
or incomplete historical coverage.

## Non-goals

- UI integration;
- live operational alerting;
- complete historical event reconstruction;
- actual ticket scans or passenger manifests;
- causal attribution of movement changes to events;
- road-closure analysis.
