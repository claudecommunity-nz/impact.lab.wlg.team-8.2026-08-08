# Pōneke Pulse

Wellington has a heartbeat, and 128 camera sites are enough to see it beat.

Pōneke Pulse replays a day of the city's movement against what a normal day looks like.
Every camera site rises as a pair of columns — a square for pedestrians, a triangle for
vehicles — each a solid *actual* column standing inside a translucent *expected* case. Scrub through a day
and the city breathes. Then it shows what a bad day looks like. On **Thursday 23 October
2025**, under a MetService red severe-wind warning with every Wellington train cancelled,
citywide movement fell **41%** against its expected rhythm. You do not read a z-score to
see it: the solid column drops away from the top of its case, and the gap is the
emergency.

Built for Impact Lab Wellington (8 Aug 2026) with Wellington City Council Emergency
Management — problem statement 05, *detect unusual changes in movement around the city*.

## What it does

**The map.** 128 camera sites, not 398 countlines. The vendor's own `viewpoint_id` groups
countlines that share a camera — one per direction, per lane, per path-vs-road — because
the median gap between two countlines is 5 metres and drawing them separately was 386
marks stacked on ~53 places. Height encodes volume, colour encodes percent change.

**Paired columns, not a 2D overlay.** Expected-vs-actual was tried twice in 2D — as
concentric rings, then as a hairline casing — and failed both times, because a 40%
shortfall drawn as radius or width is two pixels. As height it is unmissable, and columns
five metres apart still separate because they rise. On 23 October at noon the pedestrian
column drops through the floor while the vehicle column only dips; the mode divergence
becomes physical. The pair is typed by **footprint, not by position** — a square beside a
triangle — because "left and right" stops being true the moment the camera rotates, and
the demo rotates.

**The default state is a measurement.** The inferred-diagnosis overlay ships *off*. With
it on, the map's loudest mark was a coloured lattice drawn at an expected value, and
because the outer silhouette is the expectation, 23 October and 16 October had the same
skyline in different colours. With it off, the solids fill ~90% of their cases on 16
October and 30–40% on 23 October, and the collapse needs nothing explained. The inference
is one pill away, and when it is on it colours the cap plate at expected height only.

**The Streets tab.** One row per site, worst first: name, a sparkline of the whole day,
Δ%, an inferred-diagnosis chip and the countline count — expandable to its members. A
riser hiding inside a −80.8% site is exactly the thing a site average hides, so the
expansion is where the evidence lives.

**The vitals strip.** An ECG-style trace of citywide pedestrian volume. A normal day is a
clean repeating waveform. 23 October flattens through the warning window.

**Diagnosis, not severity.** Each site is typed by the *ratio* of per-mode change, never
by how big the change is:

| Verdict | Reading |
|---|---|
| pedestrians collapse ≫ cars | exposure hazard — people stopped walking first |
| cars collapse ≫ pedestrians | road closure — street still walkable |
| both collapse together | loss of access |
| pedestrians up, cars down | closed to traffic, open to people |
| insufficient multi-mode coverage | **cannot type** |

On 23 October, counted over the **118 camera sites the map draws**, `cannot_type` is 42
and `no_baseline` 17 — half the network. Counted over the **369 countlines** underneath
them it is 218 and 96. Both censuses are shown, both carry their unit, and the one beside
the map counts the marks on the map. That is displayed *above* the findings, not buried:
a counted first-class verdict, not a fallback.

**A noise floor on the colour ramp.** At 02:00 most sites see single digits, so +15% is
two extra pedestrians and nearly every mark would render as a riser. Below 20 expected
per hour the ramp is suppressed and the column renders neutral — it keeps its height but
makes no claim about direction. The legend says so.

**The refusal to panic.** 4 and 5 October 2025 are one continuous ~24-hour ingest
truncation. A naive detector reads that as a −65% citywide catastrophe. Pōneke Pulse
greys the map, hatches the viewport, em-dashes every statistic and says *we could not
see, so we are not calling it* — while showing the −65.5% it declined to report. A tool
that visibly declines to panic is worth more to an emergency manager than one that merely
fires correctly.

## Running it

Two stages. The pipeline precomputes static artefacts; the web app loads them as flat
files. There is no server in the critical path.

```sh
just poc-data     # pipeline -> team8/poc_1/web/public/data  (~4.7 MB, needs data/raw)
just poc-dev      # dev server on http://localhost:5199
```

Or directly:

```sh
uv run python -m team8.poc_1.pipeline.build

cd team8/poc_1/web
npm install
npm run dev -- --port 5199
```

`just poc-check` re-runs the pipeline and then typechecks, lints and builds — the gate
everything has to pass. The pipeline step is part of the gate because it was not, once,
and a corrected coverage figure sat in `pipeline/config.py` while the wrong one shipped on
disk. `just poc-build` produces the bundle, `just poc-preview` serves it. The pipeline
is idempotent and asserts its own headline numbers on every run: if a citywide total or
the coverage guard drifts, the build fails rather than shipping a wrong number.

The component gallery lives at **`#/gallery`** — every primitive, in all three palettes,
on synthetic data. It is the regression harness that proves no component reaches past a
custom property, which is why it is reachable only from the provenance footer and never
as a tab: a judge landing on it mid-demo would be looking at fabricated numbers.

**Demo keys.** `space` play/pause · `←` `→` ±1 hour · `1`–`5` replay day · `G` ghost
overlay · `M` `S` Map/Streets · `P` presentation mode · `Esc` clear selection.

## Swapping the palette

Every colour is authored once, as an RGB tuple, in `web/src/theme/palettes.ts`. That file
is the only place in the codebase permitted to hold a colour literal, which is what makes
this claim true rather than aspirational.

Two consumers derive from it, both generated:

1. **CSS custom properties** — `ThemeProvider` writes `--pp-color-<token>: r g b` onto
   `:root`, space-separated so CSS can do `rgb(var(--pp-color-sem-deficit) / 0.4)`.
2. **deck.gl accessors** — `rgba(palette, token, alpha)` returns `[r,g,b,a]`, read
   straight from the tuple. No string parsing in a hot accessor.

So a palette swap is one file edit that propagates to the map layers too. Three complete
palettes ship: **SEQUOIA** (light, the demo default — warm paper, deep forest, oxblood
deficit against teal surplus, deliberately not red-vs-green), **NIGHTWATCH** (dark) and
**DAYBREAK** (light). Switch at runtime with `useTheme().setPalette('nightwatch')`, or
the switcher in the gallery; it persists to `localStorage`.

Severity gets *darker* on a light palette, never brighter.

## Honesty constraints

This is Emergency Management. Overclaiming is the failure mode, and the interface is
built to make its own limits unmissable rather than to look confident.

- **Nothing here is live.** The movement feed is **T+1** — the newest data it can ever
  hold is yesterday. This is a next-morning and after-action tool. A persistent footer
  says so, and no view uses present-tense framing.
- **Hazard-planning material, not operational emergency information.** In an emergency,
  call 111.
- **Coverage is sparse.** 128 camera sites over a whole city. *Absence of an anomaly means
  nothing* — usually it means nothing was watching. Counted in camera sites rather than
  the 398 countlines they carry, because countlines stack a median of three to a camera
  and quoting them would claim roughly three times the spatial coverage that exists.
- **Missing is not zero.** The feed omits a cell entirely when there was no activity, so
  "movement stopped" arrives as row *absence*. The pipeline zero-fills onto a full grid
  but keeps separate `reported` and `scorable` bitsets, so the UI can always distinguish
  *no traffic* from *sensor offline* from *not enough baseline to judge*. Gaps draw as
  **breaks in the line**, never as low values.
- **Every anomaly carries its evidence** — observed, expected, baseline_n, hours_reported
  and a caveat list — so any claim can be judged rather than trusted.
- **Public holidays and partial ingests are excluded from every baseline**, and any day
  reporting fewer than 22 distinct hours is refused outright.

### What is not real

- **The weather warning is hand-entered** from public reporting. MetService publishes no
  warnings archive, so there is no automated feed behind it. It is labelled as
  hand-entered everywhere it appears, inline rather than behind a disclosure.
- **Diagnosis is inferred** from the ratio of per-mode change alone. It is stated as a
  hypothesis to investigate — "inferred", "consistent with" — and is never checked
  against a closure or incident record, because none was retained for the replay dates.
- **Column height saturates at 2,400/hr.** A site above that draws at full height, so the
  tallest columns understate their volume — this affects 0.69% of expected cells across 7
  sites, three of which are the busiest pedestrian sites in the CBD. `ColumnLayer` cannot
  draw a plate above its own top, so the admission rides the figure instead: the map
  readout marks any clipped number with a ▲, and the legend says so.
- **A day percentage covers only the hours the feed delivered.** The matrices are
  zero-filled onto a full grid, so a countline that reported four hours had a numerator
  over four hours and a denominator over twenty-four — a gap rendered as a zero in the one
  number people read. Both sides are now restricted to the delivered hours. Citywide that
  is worth 0.1pp; per countline it moved 32 of them by ≥5pp and inverted several signs
  (`Hutt Rd path` shipped −83.3% against a true +100.0%).
- **Site names are disambiguated, and the discriminator is data.** Cutting a countline
  name at its first descriptor gives the street, and on 23 October that leaves 24 names
  shared across 61 of 118 sites. Colliding sites take the descriptor their countlines
  share (`Kent Terrace · road` vs `· cyclelanes`) or, failing that, the vendor's camera id
  (`Commonwealth Walkway · cam 9019`).
- **The Aro Valley "risers" are dead.** Four of the eight Aro St countlines were installed
  2025-10-17, carry `baseline_n: 0`, and are typed `no_baseline`. A naive tool calls them a
  +26% shelter effect; this one shows a sensor with no history, and the three that *do*
  have eleven Thursdays behind them went −30%, −52% and −63%. The working is on the
  Streets tab, pinned above the Aro rows. No whole camera site rose on 23 October; the two
  countlines that survive the gates are Lambton Quay Turning Lane +20% and Featherston St
  road +14%.
- **The headline is a robust-baseline figure.** `summary.citywide_delta_pct` is the
  11-Thursday robust comparison; `summary.neighbour_check` is the raw two-neighbour one a
  sceptic can redo by hand. Quote the one you mean.
- **No death is attributed to the replay date.** A man was killed by a falling branch
  during this storm system, but on 21 October under an orange warning — not 23 October.
  The clause is stripped from the warning record at build time.

## Attribution

Movement data is **WCC / VivaCity**, via Pōneke Travel Insights. GIS layers belong to
their publishers — WCC, Greater Wellington, GNS Science, NIWA, Wellington Water, MBIE,
NZTA, MetService — and **licences vary per dataset**; check before republishing anything
derived. Basemap © OpenStreetMap, © CARTO.

## Layout

```
pipeline/     precompute: calendar, grid, baseline, diagnosis, emit
web/src/
  theme/      palettes, tokens, Oklab ramp — the only colour literals
  ui/         eleven primitives (Panel, VitalsTrace, Scrubber, DiagnosisChip, …)
  copy/       every user-facing string, including the honesty statements
  state/      replay day, hour, playback, selection
  data/       artefact types, loader, per-day derived model (countline -> site rollup)
  map/        MapCanvas, deck.gl column layers, cardiac phase envelope
  streets/    the site table, its sorts and row expansion
  nav/        tab shell, control row, hash route
  panels/     situation, movers, confidence, corroboration, selection, refusal, provenance
  gallery/    the palette regression harness
docs/screenshots/   verified renders of each demo state, captured at 1512x900 @2x
```

`roads.geojson` is deliberately omitted (7.7 MB, and the basemap already draws every
road); the omission is recorded in `manifest.gis_layers_omitted` with its reason.

### The screenshots

`docs/screenshots/` holds the renders each claim above was checked against, all at
1512×900 @2x on the shipped build:

| File | What it proves |
|---|---|
| `01-landing-modal` | both required statements beside the CTA, above the fold |
| `02-map-23oct-1200-trough` | the trough: cases mostly empty, solids as stubs |
| `03-map-23oct-1200-people` · `04-…-vehicles` | the divergence — near-empty cases at People, 40–70% filled at Vehicles |
| `05-map-16oct-1200-healthy` | the same skyline with the solids filled: the diagnosis overlay is not doing the work |
| `06-map-04oct-refused` | the refusal: greyed, hatched, no ramped colour anywhere |
| `07-map-site-readout` | the readout describes the site, with the countline as a labelled sub-block |
| `08-streets-default-sort` | disambiguated site names, and a census that matches the map's |
| `09-streets-row-expanded` | a child row with no usable baseline reading `not scored`, not `−97.3%` |
| `10-streets-aro-valley-note` | the Aro Valley correction, mounted and pinned |
| `11-gallery-palettes` | all three palettes, every primitive |
| `12-anim-frame-a` · `-b` | the cardiac pulse, two frames a second apart |
| `13-map-23oct-0200-calm` | the noise floor: 02:00 is genuinely calm, no riser field |
| `14-map-rotated-occlusion` | the pair still reads as a pair under rotation |
