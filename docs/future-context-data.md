# Future context data directions

This is a record of the next directions we considered for Pōneke Pulse. It is a
roadmap and evidence of breadth, not an implementation claim. No feed listed here
should silently change the movement baseline: context is there to corroborate,
prioritise and help a duty officer investigate a deviation.

## The product boundary

The movement signal remains the measured quantity: observed pedestrian and vehicle
counts compared with a same-weekday, same-hour expectation. Context feeds answer
questions around that signal:

- What else was happening at the same time?
- Was the deviation local, regional or citywide?
- Did a known closure, warning or service failure line up with it?
- Is the affected place inside an area where the consequence matters more?
- Is the apparent change actually a sensor or data-ingest problem?

The current movement feed is T+1 and spatially sparse: 398 active countlines grouped
into 128 physical camera/viewpoint sites. That makes historical alignment, coverage
and provenance first-class fields for every future context source.

## Candidate context families

| Family | Candidate sources | What they could explain or add | Feasibility and limits |
|---|---|---|---|
| **Observed weather and hydrology** | Greater Wellington Hilltop rainfall; river level and flow; soil moisture; local weather observations | Rain intensity, wet-period duration, catchment response and whether a movement drop coincided with actual conditions | High value. Hilltop is keyless and time-series based, with five-minute rainfall observations. Gauges are regional points, not street-level truth. |
| **Severe weather warnings** | MetService CAP warnings and watches | Official warning area, severity, onset, expiry and public advice; useful for reading whether movement changed under an active warning | Easy to query, but the shared CAP layer is current-state only. It needs snapshotting for future live use; it cannot be treated as an archive for old replay dates. |
| **Road and network events** | NZTA Road Events; NZTA Road Area Events; WCC Street Events and Road Closures; future local-road crash/works feed | Closures, crashes, roadworks, obstructions and diversions; strongest direct explanation for vehicle drops and neighbouring rises | NZTA is mainly state-highway coverage. The WCC register is local and historical-ish but sparse: it is a scheduled event/closure register, not a complete emergency closure log. |
| **Traffic operations** | NZTA delays; traffic cameras; WCC roads and transport-sensor geometry | Operator validation, current congestion and a better road-network join | Useful for a duty desk, less suitable as the first modelling input. Cameras and delays are live snapshots without a reliable historical archive. |
| **Water and wastewater lifelines** | Wellington Water live faults; stormwater and wastewater jobs; future service interruption notices | Local network faults, work locations, priorities and possible access disruption | Strong local relevance and easy spatial joining. Current open jobs are not a historical incident archive, so snapshots would need to be retained. |
| **Electricity and communications** | NEMA electricity outages; Wellington Electricity direct outage feed; 2degrees and One NZ mobile outages | Power loss, customers affected, restoration estimates and possible loss of communications | Good operational corroboration, especially for citywide events. Feeds are generally live/current-state and have varying detail and licensing. |
| **Public transport disruption** | Metlink static GTFS and GTFS-Realtime; service alerts; KiwiRail/rail closures; ferry timetable and service updates | Whether people could still reach or leave the city, and whether a mode shift explains pedestrian or vehicle changes | Static GTFS is already captured. Realtime service alerts would be high-value but need a key and an archive for historical replay. |
| **Planned demand and crowd context** | WellingtonNZ events; venue calendars; Hnry Stadium; CentrePort cruise schedule; Interislander and Bluebridge sailings | Expected surges, stadium emptying, cruise-related demand and ferry-terminal activity | Several web calendars are available and already captured as event evidence. Exact attendance, session times and cancellations are often missing. |
| **Official emergency signals** | GeoNet earthquakes; NEMA CAP / Emergency Mobile Alerts; civil-defence alerts; FENZ fire and incident data | Official confirmation that an emergency signal or alert was issued in an area | High credibility, but alert absence is not event absence. Emergency alerts are intentionally rare and high-threshold. |
| **Hazard susceptibility and consequence** | Flood depths, ponding areas, overland flowpaths, stream corridors, coastal inundation, landslide and liquefaction layers, tsunami zones, emergency routes and hubs | Whether a movement anomaly is occurring in a place where flooding, evacuation or access loss has higher consequence | Valuable static context, not evidence that the hazard is occurring now. Best used for prioritisation and “unwatched / exposed” views. |
| **Equity and response capacity** | NZDep2023 / small-area deprivation; emergency facilities; hospitals, fire, police and ambulance locations | Whether the same movement change may affect communities with different ability to self-evacuate or access help | Useful for response planning and triage, but requires careful licensing and must not become a proxy for individual vulnerability. |
| **Community and public reports** | Verified council/operator notes, public incident reports and carefully bounded public social signals | Early weak signals when official feeds lag or omit local incidents | Potentially useful but unverified. These should be labelled as reports or leads, never presented as confirmed facts. |

## What is already represented

The prototype already has a small version of this pattern:

- NZTA road events and MetService warnings are modular connected advisement feeds.
- Wellington events are currently hand-entered and CentrePort cruise is a declared stub.
- The committed GIS context includes emergency routes, community hubs, tsunami zones
  and scheduled street-event closures.
- Major-event pages, venue calendars, cruise information, ferry timetables and static
  Metlink GTFS have been captured in the event pipeline.
- The 23 October replay carries explicitly hand-entered warning, rail-cancellation and
  council-action context because those historical records were not available as a
  machine-readable archive.

The gap is not a lack of possible data. It is mostly temporal: many of the most useful
operational feeds expose *now*, while the movement replay asks about *then*.

## Suggested storage shape

Future adapters should normalise each item into a small, source-neutral record while
retaining the original source identity:

```text
context_id          stable source identifier, if one exists
source              adapter/feed name
publisher           owning or publishing organisation
kind                warning, rainfall, closure, crash, outage, event, alert, ...
status              connected, hand-entered, stub, current-only, archived
observed_at         when the source says it happened or was measured
valid_from/to       event or warning validity window
captured_at         when we retrieved the record
geometry            point, line or polygon in WGS84
severity            source-defined severity, never an invented score
confidence          source or editorial confidence
provenance_url      page or endpoint used
raw_snapshot        hash/path for the original payload when retained
coverage            geographic and temporal coverage statement
caveats             missingness, licence, precision and archive limitations
```

An empty response should be stored with an explicit reason. “No events returned by a
connected feed”, “the feed was not connected” and “the source has no historical archive”
are materially different facts.

## Practical priority if work resumes

1. **Observed rainfall history** — fetch Hilltop observations for the movement replay
   window and the recent window; derive rolling rainfall features and nearest-gauge
   joins.
2. **Historical-ish local closures** — normalise the WCC street-event register, with an
   explicit sparse-coverage warning.
3. **Snapshot current operational feeds** — retain timestamped NZTA, MetService,
   Wellington Water and electricity responses so a future live view gradually earns an
   archive.
4. **Public transport service alerts** — add Metlink realtime and rail disruption
   context, especially because the existing replay shows how strongly a cancellation
   can affect movement.
5. **Broaden consequence context** — river levels, flood/ponding observations, coastal
   water level, communications outages, deprivation and emergency-facility coverage.

## Guardrails

- A warning is not an observation, and a current snapshot is not a historical record.
- A nearby gauge or event is evidence to investigate, not proof of causation at a
  camera site.
- Static hazard layers describe susceptibility or consequence, not an incident in
  progress.
- Missing context must remain visibly different from “nothing happened”.
- Every publisher, licence, timestamp, spatial precision and transformation should be
  retained with the derived item.
- Context may explain a deviation to a human; it should not explain the deviation away
  by altering the measured movement or baseline without validation.
