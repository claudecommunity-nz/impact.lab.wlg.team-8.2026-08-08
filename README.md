# Impact Lab Wellington — Team 8

**Wellington City Council Emergency Management × Claude Code Community NZ**
Saturday 8 August 2026 · Waimanga Room, Wellington City Council

---

## Problem 05 — Detect unusual changes in movement around the city

> How might we identify and map sudden changes in pedestrian or vehicle movement that could indicate disruption, unsafe conditions, evacuation or loss of access?

A prototype could compare current or recent movement with usual patterns and flag significant changes for investigation. It could also compare movement changes with weather warnings, road closures or public reports.

This could build on Pōneke Travel Insights, which already allows users to examine movement patterns, busy periods and changes over time. The existing material notes that the data has limitations, which would need to be visible in any emergency use.

**Desired outcome:** WCC receives another early indication of where an event may be affecting people, rather than relying only on individual reports.

*The common theme is improving the flow and use of information between communities and Council before and during an event.*

---

## What we're building

One working prototype, demoed in four minutes at 16:30.

Each team's module is meant to slot into a shared **common operating picture** —
a live map of emergency signals that the ten prototypes feed together. Aim for
something that can be pointed at a map, a feed or an API, rather than a
closed-off demo.

Two teams work each problem statement independently. That's deliberate: two
honest attempts at the same problem tell WCC more than one.

## Data

The public GIS datasets Wellington City Council Emergency Management shared are
catalogued, checked and made queryable here:

- **Catalogue + SDK** — https://github.com/claudecommunity-nz/wcc-emergency-gis-data
- **Browse the datasets** — https://claudecommunity-nz.github.io/wcc-emergency-gis-data/

74 datasets: flood, landslide, earthquake, tsunami, coastal inundation and
climate layers, plus emergency hubs, post-quake road reopening order, water
tanks, deprivation by area, and live river-level and rainfall telemetry.
`wcc_gis.py` is a single file with no dependencies — copy it and
`catalogue.json` into your project.

```python
import wcc_gis

wcc_gis.ids("tsunami")                                    # find datasets
wcc_gis.features("tsunami-evacuation-zones", at=(-41.2790, 174.7804))
wcc_gis.geojson("footpaths", bbox=wcc_gis.WELLINGTON)     # straight into MapLibre
wcc_gis.hilltop_data("Hutt River at Taita Gorge", "Flow")[-1]
```

Three traps worth knowing before you lose an hour to them:

- Everything is published in **NZTM2000, not lat/lng**. Request raw and your
  pins land off the coast of Africa. Always ask for `outSR=4326`.
- **A quarter of the layers are rasters** that advertise a query capability,
  then refuse to answer. Ask them for a PNG instead.
- **One query is silently capped** (`footpaths` has 8,130 features; a request
  returns 2,000). Page properly, or check `exceededTransferLimit`.

## What's in this repo

```
team8/poc_1/      Pōneke Pulse — the prototype (pipeline + web app)
team8/fetch_data/ pull scripts, source inventory, profiler; vendor/ holds wcc_gis.py
data/catalogue/   sources.json — all 81 sources with their schemas
notebooks/        explore.py — data exploration notebook (marimo)
docs/             static source index
```

**`just poc-dev`** runs the prototype · **`just explore`** opens the notebook ·
`just pull` fetches the source data · `just scope` rebuilds the inventory and profiles.

### The source data is not committed

`data/raw/` (~66 MB of parquet and GeoJSON) and `docs/profiles/` (~55 MB of generated
reports) are gitignored. The data belongs to its publishers, not to us.

**The prototype still works from a fresh clone** — it reads only the derived artefacts
in `team8/poc_1/web/public/data`, which are committed. What a clone loses until you run
`just pull` is the marimo notebook and the ability to re-run the pipeline.

### Needs a key

`echo 'TRAVEL_INSIGHTS_KEY=<key>' > .env` — gitignored. The key is readable from the
Travel Insights dashboard JS bundle; it is WCC's, and permission to depend on it is
unconfirmed, so it is not committed. There is also a public, no-auth S3 mirror of the
same data (see below) if that becomes a problem.

### The movement feed

Not part of the 74-dataset GIS pack — that pack is the corroboration side. Movement
comes from Pōneke Travel Insights over Opendatasoft: `countline-mobility-hourly-summary`
(5.39M rows), `countline-mobility-daily`, `countline-meta-info` (410 countlines). There
is also a **public, no-auth S3 mirror** of the same data as monthly CSV, which is our
fallback if the key in the public dashboard bundle turns out to be off-limits.

### Five things the data tells you before you model anything

1. **Missing rows are not zeros, and they carry the signal.** The feed omits a
   (countline, direction, hour) cell when there was no activity — ~10% of cells on a
   normal day, 13% on 23 Oct 2025. "Movement stopped" arrives as row *absence*, so a
   naive `GROUP BY` discards exactly what we are hunting.
2. **The feed is T+1.** The newest data is always yesterday. Live detection is not
   available and claiming it would be the easiest thing for a judge to catch.
3. **Holidays and broken ingest own the leaderboard.** Of the 15 biggest citywide drops
   in 756 days, 12 are public holidays or partial ingests. The real emergency ranks
   tenth. The guard is not a feature, it is the credibility.
4. **Pedestrians and cars diverge, and the ratio is a diagnosis.** On 23 Oct the midday
   pedestrians-per-car ratio collapsed from 0.84 to 0.24 — people stop walking first.
5. **Coverage is sparse and per-mode.** 386 active countlines over a whole city, and
   many are footpath counters blind to vehicles. Absence of an anomaly means nothing.

## Schedule

| Time | What |
|---|---|
| 08:00 | Arrival and mingle |
| 09:00 | Opening address & problem briefing |
| 09:30 | Build begins |
| 12:30 | Lunch + lightning talks |
| 16:00 | Submissions close |
| 16:30 | Demos + judging |
| 17:45 | Awards + next steps |

## Ground rules

- These are **hazard-planning layers, not live emergency information**.
  In an emergency, call 111.
- **The data is not ours.** Each dataset belongs to its publisher — WCC, Greater
  Wellington, GNS Science, NIWA, Wellington Water, MBIE, NZTA, MetService.
  Licence terms vary per dataset; check the dataset's page before publishing
  anything derived from it, and credit the publisher.
- Be considerate with request rates. These are council servers, and at least one
  host throttles under concurrent load.
- **Keep personal details out of this repo.** It is public. No participant
  names, contact details or application material.
- Treat public social content as a *signal to investigate*, never as verified
  fact — surfacing something unverified as confirmed is the failure mode these
  problem statements are most wary of.

## Licence

Code here is MIT unless stated otherwise. The data is not covered by it.
