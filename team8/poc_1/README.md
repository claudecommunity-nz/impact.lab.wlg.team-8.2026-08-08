# Pōneke Pulse

A duty officer's Monday brief, built out of movement data.

Wellington counts pedestrians and vehicles at 128 camera sites. Pōneke Pulse forecasts
what each hour of the coming week *should* look like, measures what actually happened,
and puts the difference on a map of the real streets. The claim is not that movement
detects emergencies. It is that **movement deviation is a general-purpose sensing layer**
— one signal a duty officer can read three different ways. Pōneke Travel Insights already
lets an analyst explore these counts and how they change over time; what is missing is a
forecast to measure each hour against, and an emergency-management reading of the gap.

Built for Impact Lab Wellington (8 Aug 2026) with Wellington City Council Emergency
Management — problem statement 05, *detect unusual changes in movement around the city*.

## The three readings

The same number — percent deviation from forecast — answers three different questions
depending on what else is true at that hour.

**A drop can be compliance.** If a warning is in force and movement falls, that is
evidence the message landed. Councils issue advice constantly and measure the effect of
it almost never; "did people actually stay home?" is currently answered by anecdote. A
drop under an issued warning is the closest thing to a read receipt an emergency manager
can get.

**A drop can be an incident** — and the per-mode signature says what kind. This is the
part that needs no new sensors:

| Signature | Reading |
|---|---|
| pedestrians fall, vehicles hold | exposure hazard — the street is drivable, not walkable |
| vehicles fall, pedestrians hold | road closure — still open on foot |
| both fall together | loss of access |
| pedestrians rise, vehicles fall | closed to traffic, open to people |
| not enough multi-mode coverage | **cannot type** |

Hover Manners St at Tue 4 Aug 18:00 and the tooltip reads `−29% overall · people −38% ·
vehicles +5%`. Pedestrians collapsed while traffic held — the exposure-hazard signature,
stated in one row, with no model beyond a ratio.

**A rise is risk, and it is a location.** Crowds are where additional risk concentrates —
a protest, a stadium emptying, a cruise ship berthing. "Where are the people right now"
is a question every emergency plan asks and no live system answers. A rise against
forecast is that answer, at street granularity.

## The week is the product

The unit is not an alert. It is a **week**, because that matches how a duty desk actually
works: you come in on Monday, you find out what is coming, and you find out what already
went wrong while you were away.

So known upcoming events are first-class. They are the things a duty officer should
*expect* to move the numbers, and "What to watch this week" lists them before they happen
— a road closure starting Sunday, a comedy show at the Michael Fowler Centre on Saturday
night. When the week is over, the same list explains the deviations it caused. An event
that was on the list and moved the numbers is a forecast working. An event that was not
on the list and moved the numbers is the thing worth investigating.

Five bands, top to bottom:

- **A · identity** — wordmark, the two tabs, and the not-live flag. This bar survives
  presentation mode and cannot scroll away, so the honesty statement cannot either.
- **B · the calendar** — seven day chips, Monday-anchored. Past days show a signed
  percentage against forecast; future days show a forecast *volume*, muted and hatched.
  The two states deliberately do not share a unit — see below.
- **C · three columns** — the week's forecast and what to watch on the left; the edge
  flow map in the centre; movement inside a risk area, and the edges furthest off
  forecast, on the right.
- **D · the citywide week chart** — 168 hours, an 80% forecast band, a dashed forecast
  across the whole week and a solid actual that stops dead at the feed horizon.
- **E · footer** — 111, the T+1 statement, and the coverage caveat, on every route.

**The map draws streets, not blobs.** Every countline is snapped to a WCC road centreline
(all 396 land within 25 m; median 3.6 m), and flow is propagated along the road graph, so
a sensor's reading is drawn along the carriageway it measured rather than as a dot beside
it. Line **weight is flow volume**, line **colour is deviation from forecast**. Behind
them, every street in the city is drawn cold: the unlit majority is the coverage
statement, doing the work a disclaimer was failing to do.

**The day chips do not show a forecast deviation**, which is a deliberate departure from
the design. Forecast is baseline × 1.0013, so every future day's "deviation from
baseline" would be the trend factor — seven identical +0.1% chips, which is theatre. A
future day shows what we expect to happen (`1.44M / fcst`); a past day shows how wrong we
were. At chip scale the eye reads the number and the colour before it reads a label, so
the two states are given different units rather than the same unit and a suffix.

## The compounding read: deviation inside a risk area

This is the part no existing tool says.

More people than forecast **inside a tsunami evacuation zone** is a materially worse fact
than the same rise on safe ground. Pōneke Pulse points the sites at the hazard polygons
WCC already publishes and sums movement inside each one.

At Thu 6 Aug 09:00 it reads:

> **+22% Shore Exclusion Zone** — more people than expected in an area with a known
> hazard. 2,043 movements vs 1,681 forecast · 5 cameras on 4 streets, incl. Ara Moana.
> *Self Evacuation Zone −3%.*

The nested-zone line is the finding: the wider ring is flat, so the rise is concentrated
at the water rather than being citywide drift. On Tue 4 Aug 18:00 the same card flips to
−67% and switches to the drop reading.

The compliance framing is **gated on a warning actually being in force**. It first
rendered "fewer people than expected, which is what compliance looks like" under a quiet
Tuesday with no warning issued — a causal story invented from a slow hour. With no
warning covering that hour it now says "a drop with no stated reason". A road closure
does not count as a warning to the public.

Thresholds, all footnoted in the card: an area needs ≥3 cameras inside it, ≥50
movements/hr forecast and ≥0.05 km² before it is judged, and deviations inside ±8% are
treated as flat. **6 of 9 hazard areas have no camera inside them at all** — unwatched,
not quiet, and the card says so.

## The forecast model

```
forecast = baseline × trend × event multipliers
```

**Baseline** is the robust same-weekday, same-hour median over the 84 days before the
week, capped at the 12 most recent occurrences — in practice 8–10 matched days per hour.
**The pool ends the day before the week starts**, so Mon–Thu are genuine out-of-sample
predictions rather than hindsight, which is what makes "week to date −3.5%" mean anything.
**Trend** is 1.0013: the median citywide day total over the 28 days before the week
against the whole pool window. The **band** is not a fixed percentage — it is
`forecast ± 1.2816 × scaled MAD` of the same pool, an 80% central interval clamped at
zero, so a genuinely erratic hour gets a wide band and a metronomic one gets a tight
band.

**Day-of-week factors are derived, published, and deliberately not multiplied in.** The
brief specified `baseline × day-of-week factor`, but the baseline here is already a
same-weekday median — the day-of-week rhythm is inside it, and multiplying would count it
twice and put Saturday 20% below a Saturday baseline. The factors are computed anyway and
used as an *assertion*: the build fails unless the baseline's own normalised day rhythm
lands within 10% of the independently derived factors. `day_factors.applied_to_forecast:
false` is itself asserted.

Wellington's real weekly rhythm turns out to be much flatter than assumed — Mon 0.925,
Tue 1.026, Wed 1.063, Thu 1.048, Fri 1.097, **Sat 0.983**, Sun 0.844. A designer's
guess had Saturday at 0.80.

Week 32 as shipped: 168 hours, 96 confirmed, newest confirmed hour `2026-08-06T23`.

| | Mon 3 | Tue 4 | Wed 5 | Thu 6 | Fri 7 | Sat 8 | Sun 9 |
|---|---|---|---|---|---|---|---|
| vs forecast | +2.4% | −9.5% | −8.5% | +2.0% | — | — | — |

Week to date 5,207,051 against 5,396,909 forecast, **−3.5%**.

## The feeds are modular, and mostly empty

Advisements ("what will happen") and risk areas ("where it matters") are plug-in sources.
Each advisement adapter is one function with the signature `(week_start, week_end) ->
(items, empty_reason)` plus one registry entry. Adding a fifth source is a function and a
list entry; no UI changes.

We are showing the shape, not exhausting the sources — and the honest state of the
sources this week is *quiet*:

| Feed | Status | Items | What it is |
|---|---|---|---|
| `nzta-road-events` | **connected, real** | 1 | NZTA Journey Planner layer. 136 features → 3 in the Wellington bbox → 1 starting in-week: roadworks on the SH2 Ngauranga southbound off-ramp, Sun 9 → Tue 11. |
| `metservice-warnings` | **connected, real** | 0 | CAP warnings layer. One warning active nationally (Buller), none covering Wellington. |
| `wellington-events` | **hand-entered** | 1 | Alan Davies at the Michael Fowler Centre, Sat 19–22. Verified against an Eventfinda listing; the record carries where a human looked. |
| `centreport-cruise` | **stub, not connected** | 0 | CentrePort publishes a web page, not a feed, and the 2026/27 season opens 25 Oct 2026. The adapter declares the shape and returns nothing. |

`status` and `empty_reason` are an honesty pair: a feed with zero items has to say *why*,
because "no berthings this week" and "we never connected the schedule" are very different
facts and an empty list looks identical either way.

**No advisement moves a published number.** Every item ships `applied: false` and renders
its expected-delta column as `—`, because we have no measured effect size for any of
them. `event_mult` is 1.0 across all 168 hours. Nothing invented is allowed to move a
forecast.

Risk layers are real WCC/WREMO GIS on disk: `tsunami-evacuation-zones` and
`coastal-inundation-high` — the second exists mainly to prove the first is not
special-cased. Nine areas.

**Standing conditions** are derived from the feed rather than typed: sites dark all week,
sites with no baseline yet, and the reporting count. A year-long street-activation closure
in force is the one item that comes from the closures layer.

## Running it

Two stages. The pipeline precomputes static artefacts; the web app loads them as flat
files. There is no server in the critical path.

```sh
just poc-data     # pipeline -> team8/poc_1/web/public/data   (needs data/raw)
just poc-dev      # dev server on http://localhost:5199
just poc-check    # pipeline, typecheck, lint, build, browser tests — the gate
just poc-e2e      # browser tests only, against a running dev server
just poc-shots    # regenerate the demo screenshots -> web/e2e/shots
```

The pipeline step is inside the gate because it once was not, and a corrected coverage
figure sat in `pipeline/config.py` while the wrong one shipped on disk. The pipeline
asserts its own headline numbers on every run: if a citywide total or a coverage guard
drifts, the build fails rather than shipping a wrong number. Builds are byte-identical
across runs.

**The browser tests** (`web/e2e/app.spec.ts`) run at 1512×900, the projector size, because
two of the things they guard are viewport-dependent: the Context popover clearing the map,
and the week chart's day axis and scrubber staying on screen. They cover tab switching,
the calendar chips moving the cursor, the scrubber filling the actual line and stopping at
the feed horizon, every disclosure opening and closing, the popover's box sitting inside
the viewport, the mode pills reaching the map, and the route reconcile below. Assertions
are behavioural, never pixel-exact — a screenshot diff over a WebGL map would fail on a
driver update and teach us to ignore the suite.

`just poc-shots` runs **headed**, and has to. Headless Chromium composites MapLibre's
canvas but not deck.gl's: WebGL2 initialises, picking works, and every screenshot still
comes back with a basemap and no edges.

**Demo keys.** `space` play/pause · `←` `→` ±1 hour across the week · `1`–`7` day chip ·
`G` ghost · `W` `S` Week/Streets · `P` presentation mode · `Esc` clear selection.

Two routes are deliberately not tabs. **`#/replay`** is the single-day storm replay of 23
Oct 2025 — the evidence that the method finds a real event, kept reachable but not given
equal footing with this week's brief. **`#/gallery`** renders every primitive on synthetic
numbers in all three palettes; a judge landing on it mid-demo would be looking at
fabricated data.

## Swapping the palette

Every colour is authored once, as an RGB tuple, in `web/src/theme/palettes.ts`. That file
is the only place in the codebase permitted to hold a colour literal, which is what makes
this claim true rather than aspirational. Two consumers derive from it: CSS custom
properties written onto `:root` as `--pp-color-<token>: r g b`, and `rgba(palette, token,
alpha)` for deck.gl accessors — no string parsing in a hot accessor.

Three palettes ship: **SEQUOIA** (light, the demo default — warm paper, deep forest,
oxblood deficit against teal surplus, deliberately not red-vs-green), **NIGHTWATCH**
(dark) and **DAYBREAK** (light). Severity gets *darker* on a light palette, never
brighter.

## Honesty constraints

This is Emergency Management. Overclaiming is the failure mode, and the interface is
built to make its own limits unmissable rather than to look confident.

- **Nothing here is live.** The movement feed is **T+1** — the newest hour it can ever
  hold is yesterday. This is a next-morning and after-action tool. The week chart draws
  the unreached remainder as a wash rather than leaving it blank, because an empty
  right-hand third of a volume chart reads as a city that stopped moving on Friday.
- **Hazard-planning material, not operational emergency information.** In an emergency,
  call 111.
- **Coverage is sparse.** 128 camera sites over a whole city, 121 reporting. *Absence of
  an anomaly means nothing* — usually it means nothing was watching. Counted in camera
  sites rather than the 398 countlines they carry, because countlines stack a median of
  three to a camera and quoting them would claim roughly three times the spatial coverage
  that exists. The edge map is built from the 124 sites and 396 countlines that carry
  usable geometry, so its own chrome quotes those.
- **Missing is not zero.** The feed omits a cell entirely when there was no activity, so
  "movement stopped" arrives as row *absence*. The pipeline zero-fills onto a full grid
  but keeps `reported` and `scorable` separate, so the UI can always distinguish *no
  traffic* from *sensor offline* from *not enough baseline to judge*. Gaps draw as breaks
  in the line, never as low values.
- **A ratio needs a denominator.** Deviation is `null` wherever the forecast is under
  5/hr — a percentage against one expected pedestrian is noise. The "edges off forecast"
  ranking additionally requires ≥20/hr forecast, because ranking on `|deviation|` alone
  filled every slot with single-sensor edges reading exactly −100% at 0/hr: sensor faults
  outranking the city.
- **One camera is not a street.** 53 of 147 edges have a single sensor. They are ranked
  but greyed, and labelled *unjudged* rather than quiet.
- **Diagnosis and risk are inference, never established cause.** The map stamp says so on
  every hour: *deviation is measured, cause is not*.

### What is not real

- **The Saturday event is hand-entered**, and badged as such wherever it appears. So is
  the 23 Oct 2025 weather warning on the replay route — MetService publishes no warnings
  archive, so there is no automated feed behind that one.
- **No advisement is applied to any forecast.** See the feeds table above.
- **Diagnosis is inferred** from the ratio of per-mode change alone, stated as a
  hypothesis to investigate, and never checked against a closure or incident record.
- **Deviation is measured against this week's forecast for the same hour**, not against
  last week.
- **Weekend forecasts are the least tested thing here.** Fri–Sun rest on 9–10 matched
  weekday occurrences and there is no confirmable actual for them this week.
- **New sites read as risers if you are careless.** Sites installed mid-archive carry no
  baseline and are typed `no_baseline` rather than scored. A naive read calls them a
  surge.
- **No death is attributed to a replay date.** A man was killed by a falling branch during
  the October 2025 storm system, but on **21 October** under an orange warning — not on
  23 October. The clause is stripped from the warning record at build time.

## Attribution

Movement data is **WCC / VivaCity**, via Pōneke Travel Insights. Road centrelines are WCC.
GIS layers belong to their publishers — WCC, Greater Wellington, WREMO, GNS Science, NIWA,
Wellington Water, MBIE, NZTA, MetService — and **licences vary per dataset**; check before
republishing anything derived. Basemap © OpenStreetMap, © CARTO.

## Layout

```
pipeline/
  week.py       the 168-hour week: baseline, trend, forecast, band, day rollups
  edges.py      snap countlines to road centrelines, propagate, name edges
  advise.py     advisement feed + standing conditions
  feeds.py      pluggable advisement adapters + area-risk join
  roadbase.py   the cold citywide road geometry
  checks.py     assertions the build must pass
web/src/
  theme/        palettes, tokens, Oklab ramp — the only colour literals
  ui/           primitives (Panel, VitalsTrace, Scrubber, DiagnosisChip, …)
  copy/         every user-facing string, including the honesty statements
  state/        one cursor: hour-of-week 0..167; day and hour are derived
  data/         artefact types, loader, per-day derived model
  map/          MapCanvas, edge flow PathLayers, cold road base, heat
  week/         the brief: forecast card, watch feed, edge ranking, week chart
  week/watch/   feed roster + the area-risk card
  streets/      the site table, its sorts and row expansion
  nav/          tab shell, calendar strip, control row, hash route
  panels/       situation, confidence, corroboration, refusal, provenance
  gallery/      the palette regression harness
web/e2e/        browser tests + the generated demo screenshots
```

`roads.geojson` is deliberately omitted from the shipped artefacts (7.7 MB, and the
basemap already draws every road); the omission is recorded in
`manifest.gis_layers_omitted` with its reason.

### The screenshots

`web/e2e/shots/` is generated by `just poc-shots`, so it cannot drift from the app.

| File | What it shows |
|---|---|
| `week-h009` · `-h060` · `-h100` | the horizon filling: one day, then three, then the cursor past the feed edge with the actual stopped and the forecast carrying on |
| `map-thu09` | a flat hour — citywide on forecast, the network reading |
| `map-tue18` · `-tue18-people` | the demo frame: −16% citywide, 64 edges below, 0 above; pedestrians alone at −41% |
| `band-calendar` · `band-weekchart` · `band-footer` | the three bands close up |
| `card-watch` · `card-area-risk` | what to watch, and movement inside a risk area |
| `streets` | every site ranked, worst first |
