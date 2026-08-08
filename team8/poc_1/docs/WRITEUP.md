# Pōneke Pulse — what we built and why

Source material for the demo script and video. Every number here is traced to
`team8/poc_1/README.md` or to an artefact in `team8/poc_1/web/public/data/`.

Built for Impact Lab Wellington, 8 August 2026, with Wellington City Council Emergency
Management. **Problem statement 05 — detect unusual changes in movement around the city.**

---

## 1. The one-liner

> **Pōneke Pulse forecasts how Wellington should move, measures how it actually moved,
> and tells a duty officer where the difference matters.**

### The fifteen-second version

Wellington counts pedestrians and vehicles at 128 camera sites. Those counts tell you how
many people passed a corner. They don't tell you whether that number is *normal*.

We build the normal first — a per-street, per-hour, per-mode forecast — and then score
the real counts against it. What reaches the screen isn't traffic volume. It's
**deviation**: where the city is behaving differently from an ordinary equivalent day, by
how much, and whether it's somewhere that matters.

---

## 2. The problem, in the assessors' own words

Straight from our AI Opportunity Canvas, so the framing matches what they already hold:

- **Customer:** duty controller, Emergency Management team.
- **Customer problem:** *"We don't have visibility of data or a model to predict
  population movement so can't accurately estimate risk impact."*
- **Status quo:** *"Individuals try and make sense of disparate data sets and think what
  is important to hand over."*
- **Desired outcome:** *"An accurate view of people movement — predicted, actual and
  anomalies."*
- **ICE:** Impact 10 · Confidence 10 · Ease 9.5 → **950/1000**.

The operational version: **today, Council waits for the phone to ring.** When a storm, a
closure or an evacuation moves people, WCC learns where they're affected from scattered
individual reports — slow, patchy, one place at a time.

What a duty controller is missing when they walk in:

- **Handovers are verbal and ad hoc.** What gets passed on is whatever the outgoing
  controller *thought* was important — not a record, not a shared picture.
- **There is no view of what normal even looks like.** Without a baseline for how people
  move and distribute across the city, there is nothing to judge "today" against.
- **So risk impact is guesswork.** No population-movement model means no evidence-based
  read on where an event is actually affecting people.

Pōneke Travel Insights already lets an analyst explore these counts. What's missing is a
*forecast to measure each hour against*, and an emergency-management reading of the gap.

**What we're proposing, in canvas terms.** Predict baseline traffic, measure the actual and
its deviation, surface the events that could explain a deviation, and provide the data to
estimate **risk impact from population change against known risk zones** (tsunami, flood).
On feasibility: it ships as a **static bundle — one map layer over existing data sources**,
with the point-source counts already turned into edge information. Publicly available data
only; no private information, no identified bias.

---

## 3. The thesis — one signal, three readings

**This is the spine of the whole talk.** The claim is not that movement detects
emergencies. It's that **movement deviation is a general-purpose sensing layer** — the
same number answers three different questions depending on what else is true that hour.

### A drop can be compliance

If a warning is in force and movement falls, that's evidence the message landed.

Councils issue advice constantly and measure the effect of it almost never. *"Did people
actually stay home?"* is currently answered by anecdote. A drop under an issued warning is
the closest thing to a **read receipt** an emergency manager can get.

### A drop can be an incident — and the mode ratio says what kind

This is the part that needs no new sensors. We never type a street by *how big* the drop
is, only by **which mode fell**:

| Signature | Reading |
|---|---|
| pedestrians fall, vehicles hold | **exposure hazard** — drivable, not walkable |
| vehicles fall, pedestrians hold | **road closure** — still open on foot |
| both fall together | **loss of access** |
| pedestrians rise, vehicles fall | **closed to traffic, open to people** — event or march |
| not enough multi-mode coverage | **cannot type** — a counted, first-class verdict |

Concrete: hover Manners St at Tue 4 Aug 18:00 and it reads `−29% overall · people −38% ·
vehicles +5%`. Pedestrians collapsed while traffic held. That's the exposure-hazard
signature, stated in one row, from a ratio — no model.

### A rise is risk, and it's a location

Crowds are where additional risk concentrates — a protest, a stadium emptying, a cruise
ship berthing. *"Where are the people right now"* is a question every emergency plan asks
and no live system answers. A rise against forecast is that answer, at street granularity.

---

## 4. What you can actually show

### Week — the duty officer's Monday brief

The unit is a **week**, not an alert, because that's how a duty desk works: you come in on
Monday, find out what's coming, and find out what went wrong while you were away.

168 hours, an 80% forecast band, a **dashed forecast across the whole week and a solid
actual that stops dead at the feed horizon**. You can watch the tool run out of knowledge.
Scrub the timeline and the map, the rankings and the risk read all move together.

**"What to watch this week"** lists known upcoming events *before* they happen. Afterwards
the same list explains the deviations they caused. An event on the list that moved the
numbers is a forecast working. **An event not on the list that moved the numbers is the
thing worth investigating.**

### Streets — every edge, ranked

The same hour as a table. Every site with its 24-hour trace against baseline, sorted
worst-first, filterable by inferred state. This is how a manager goes from *"something is
off"* to *"it's these eleven streets"*.

### Areas — the "so what"

Deviation only matters where it intersects something that matters. This crosses movement
with the hazard geography WCC already publishes.

An alert is an **episode**, not a snapshot: start, end, duration, peak, spread, and whether
it's **still flagged**. The −79% Shore Exclusion Zone episode ran **14 hours**.

### The replay — 23 October 2025

The day it fires. MetService **red** severe-wind warning, gusts to 140 km/h at Mount
Kaukau, every Wellington train cancelled, WCC facilities closed and the EOC activated.
Citywide movement **−41%** against a normal Thursday.

The detail worth landing: **pedestrians fell roughly twice as hard as vehicles.** At
midday the pedestrians-per-car ratio collapsed from **0.84 to 0.24**. In a wind warning
people stop walking first, and those who must travel do it inside a vehicle. That's the
exposure-hazard signature on the largest scale we have.

---

## 5. How it works

### baseline → forecast → deviation

```
forecast = baseline × trend × event multipliers
```

**Baseline** is the robust same-weekday, same-hour median over the **84 days** before the
week, capped at the 12 most recent occurrences — in practice 8–10 matched days per hour.
**The pool ends the day before the week starts**, so Mon–Thu are genuine out-of-sample
predictions rather than hindsight. That's what makes "week to date −3.5%" mean anything.

**Trend** is a single derived scalar, **1.0013** — the median citywide day total over the
28 days before the week against the whole pool window. Deliberately one number: anything
richer over this much archive is fitting noise.

**The band** is not a fixed percentage. It's `forecast ± 1.2816 × scaled MAD` of the same
pool — an 80% central interval. An erratic hour gets a wide band; a metronomic one gets a
tight band. A flat ±12% would claim the opposite.

**Day-of-week factors are derived, published, and deliberately NOT multiplied in.** The
baseline is *already* a same-weekday median, so the day rhythm is inside it; multiplying
would count it twice and put Saturday 20% below a Saturday baseline. We compute them
anyway and use them as an **assertion** — the build fails unless the baseline's own
normalised rhythm lands within 10% of the independently derived factors.

**A good "the data surprised us" beat:** Wellington's real weekly rhythm is much flatter
than assumed — Mon 0.925, Tue 1.026, Wed 1.063, Thu 1.048, Fri 1.097, **Sat 0.983**, Sun
0.844. A designer's guess had Saturday at 0.80.

### The trick: sensors become edge weights, not dots

A single camera counts one spot. Drawing it as a dot gives you a scatter of points with no
network.

So every countline is **snapped to a WCC road centreline** — all 396 land within 25 m,
median **3.6 m** — and flow is propagated along the road graph. A sensor's reading is drawn
along the carriageway it measured rather than as a dot beside it.

- line **weight** = flow volume
- line **colour** = deviation from forecast

**A closure between two cameras still shows up.**

Behind them, **every street in the city is drawn cold**. The unlit majority *is* the
coverage statement — it does the work a disclaimer was failing to do. You can see at a
glance how much of Wellington we watch, which is not much.

### The compounding read: deviation inside a risk area

This is the part no existing tool says.

More people than forecast **inside a tsunami evacuation zone** is a materially worse fact
than the same rise on safe ground. We point the sites at the hazard polygons WCC already
publishes and sum movement inside each one.

At Thu 6 Aug 09:00:

> **+22% Shore Exclusion Zone** — more people than expected in an area with a known
> hazard. 2,043 movements vs 1,681 forecast · 5 cameras on 4 streets, incl. Ara Moana.
> *Self Evacuation Zone −3%.*

**The nested-zone line is the finding.** The wider ring is flat, so the rise is
concentrated at the water rather than being citywide drift.

**The compliance framing is gated on a warning actually being in force.** It first rendered
"fewer people than expected, which is what compliance looks like" under a quiet Tuesday
with no warning issued — a causal story invented from a slow hour. With no warning covering
that hour it now says *"a drop with no stated reason"*. A road closure does not count as a
warning to the public.

---

## 6. The numbers that are true

| | |
|---|---|
| Camera sites | **128** (121 reporting) |
| Edges on the map | **147**, from 124 sites with usable geometry |
| Edges with ≥2 sensors ("judged") | **94** — the other 53 are ranked but greyed |
| Hazard areas | **9**, of which **3** are judgeable |
| Week shipped | Week 32 · 3–9 Aug 2026 · 168 hours, **96 confirmed** |
| Newest confirmed hour | `2026-08-06T23` |
| Week to date | 5,207,051 actual vs 5,396,909 forecast → **−3.5%** |
| Snap quality | 100% within 25 m, median 3.6 m |
| Areas alerts | **17** at the default cursor (19 by Thu 23:00) |

Per-day, as shipped:

| Mon 3 | Tue 4 | Wed 5 | Thu 6 | Fri 7 | Sat 8 | Sun 9 |
|---|---|---|---|---|---|---|
| +2.4% | −9.5% | −8.5% | +2.0% | forecast | forecast | forecast |

**The demo week has Mon–Thu confirmed and Fri–Sun forecast-only.** That asymmetry isn't a
gap — it's exactly the duty-officer situation, and the interface renders the two states in
different units so a forecast can never be mistaken for a measurement.

---

## 7. What it deliberately does not do

This is Emergency Management. Overclaiming is the failure mode, and the interface is built
to make its own limits unmissable rather than to look confident.

- **Nothing is live.** The feed is **T+1** — the newest hour it can hold is yesterday. A
  next-morning and after-action tool. In an emergency, call 111.
- **Coverage is sparse.** 128 sites over a whole city. *Absence of an anomaly means
  nothing* — usually it means nothing was watching.
- **Missing is not zero.** The feed omits a cell entirely when there was no activity, so
  "movement stopped" arrives as row *absence*. Gaps draw as **breaks in the line**, never
  as low values. A silent sensor is not a quiet street.
- **A ratio needs a denominator.** Deviation is `null` below 5/hr forecast. The rankings
  need ≥20/hr — without it every slot filled with single-sensor edges reading −100% at
  0/hr, i.e. sensor faults outranking the city.
- **One camera is not a street.** 53 of 147 edges have a single sensor. Ranked, greyed,
  labelled *unjudged* rather than quiet.
- **It refuses rather than guesses.** Days with partial ingest are marked *refused*. On
  4 Oct 2025 the feed delivered 13 of 24 hours; a naive detector calls that a −64%
  citywide catastrophe. We show that counterfactual number and decline to report it.
- **Diagnosis and risk are inference, never established cause.** The map stamp says so
  every hour: *deviation is measured, cause is not*.

---

## 8. What is not real

Say these plainly; they're strengths, not admissions.

- **The Saturday event is hand-entered** and badged as such everywhere. So is the 23 Oct
  2025 weather warning — MetService publishes no warnings archive, so there's no automated
  feed behind it.
- **No advisement is applied to any forecast.** Every item ships `applied: false` and
  renders its expected-effect column as `—`, because we have no measured effect size for
  any of them. `event_mult` is 1.0 across all 168 hours. **Nothing invented is allowed to
  move a published number.** The framework to do it is built and deliberately unused.
- **Diagnosis is inferred** from the mode ratio alone — a hypothesis to investigate, never
  checked against a closure or incident record.
- **Weekend forecasts are the least tested thing here.** Fri–Sun rest on 9–10 matched
  occurrences with no confirmable actual this week.
- **New sites read as risers if you're careless.** Sites installed mid-archive carry no
  baseline and are typed `no_baseline` rather than scored.

### The honest finding in Areas

**All 17 alerts are unexplained — and that's the true reading, not a bug.** The only two
advisements on file (an NZTA off-ramp closure, the hand-entered comedy show) both sit
*past* the T+1 horizon, so nothing on record covers any flagged hour. The cause-matching
works; the data has no match.

Don't apologise for it. Say it:

> Every sustained deviation inside a hazard zone this week has no stated cause. That's the
> list nobody currently has.

---

## 9. Modular by design

Baselines go wrong for knowable reasons. A concert, a road closure, a cruise ship, a red
wind warning — each makes "normal" the wrong yardstick for a few hours.

Advisements ("what will happen") and risk areas ("where it matters") are plug-in sources.
Each adapter is **one function** — `(week_start, week_end) -> (items, empty_reason)` — plus
one registry entry. Adding a fifth source is a function and a list entry; **no UI changes.**

| Adapter | Status | Items | What it is |
|---|---|---|---|
| `nzta-road-events` | **connected, real** | 1 | NZTA Journey Planner. 136 features → 3 in the Wellington bbox → 1 starting in-week |
| `metservice-warnings` | **connected, real** | 0 | CAP warnings. One active nationally (Buller), none covering Wellington |
| `wellington-events` | **hand-entered** | 1 | Verified against an Eventfinda listing; the record carries where a human looked |
| `centreport-cruise` | **stub, not connected** | 0 | CentrePort publishes a web page, not a feed; the 2026/27 season opens 25 Oct |

**`status` and `empty_reason` are an honesty pair.** A feed with zero items has to say
*why* — "no berthings this week" and "we never connected the schedule" are very different
facts, and an empty list looks identical either way.

### Where it goes next

- **More risk layers on the same spine** — flood, landslide, coastal inundation. The join
  is generic; `coastal-inundation-high` exists mainly to prove tsunami isn't special-cased.
- **Applied forecasting** — turn a feed into an adjusted forecast once there's validation
  to earn it. A silently adjusted baseline is the failure mode that would cost most trust.
- **Outputs compose** — GeoJSON, a feed or an endpoint, so it slots into a shared common
  operating picture rather than being another dashboard to check.

---

## 10. A four-minute arc

Rough beats, in order. Use or discard.

1. **(0:00) The problem.** Council waits for the phone to ring. Individual reports are
   slow, patchy, one place at a time.
2. **(0:30) The idea.** We don't show traffic. We show *deviation from what should have
   happened*. One signal, three readings — compliance, incident, crowd location.
3. **(1:00) The week.** Open on Monday. Forecast band, actual filling in, the horizon
   where knowledge stops. Scrub it — the map, the rankings and the risk read move together.
4. **(1:45) The map.** Every street cold; the watched ones lit. Weight is volume, colour is
   deviation. Point out how little of the city we can see — *that's the honest picture.*
5. **(2:15) The mode ratio.** Hover a street: people −38%, vehicles +5%. That's an exposure
   hazard, not a closure. The ratio is the diagnosis.
6. **(2:45) Areas — the "so what".** A rise inside a tsunami evacuation zone is a different
   morning. 17 episodes this week, every one with no stated cause.
7. **(3:15) It refuses to panic.** Show 4 Oct: a −64% that never happened. The tool
   declines to call it, and shows you the number it declined.
8. **(3:45) Where it goes.** Adapters plug in. Same spine, more risks.

**The strongest single line available:** *a drop under a warning you already issued is
something you know; a drop with no stated reason is the thing you don't.*

---

## 11. Do not say

| Say | Not |
|---|---|
| **147 edges**, 124 sites with usable geometry | "273 edges" (from the older deck) |
| **128 camera sites** | "398 countlines" — they stack ~3 per camera; quoting them claims 3× the coverage that exists |
| same-weekday median over **84 days**, 12 occurrences | "26 weeks of matched weekdays" |
| coloured **road edges**, cold base, heat on top | 3D columns and "translucent expected cases" — that map no longer exists |
| **17 alerts** at the default cursor | "4" — an early agent miscount its own verifier caught |
| a man died on **21 Oct**, under an *orange* warning | anything attaching a death to the 23 Oct replay |
| Saturday's real factor is **0.983** | 0.80 — that was the guess we disproved |
| the Areas alerts are unexplained, **and that's the finding** | anything implying the cause-matching is broken |

**The current deck (`PonekePulseTeam8.pptx`) adds the AI Opportunity Canvas and ICE slides,
but its data slides still predate the final build** — they carry several of the left-hand
column's errors above (notably **"273 edges"** for the real 147, **"26 weeks of matched
weekdays"** for the real 84-day / 12-occurrence window, and the old 3D-column /
"translucent expected case" map that the shipped coloured **edge** map replaced). This
document supersedes those slides; reconcile them against the right-hand column before
presenting.

---

## Attribution

Movement data is **WCC / VivaCity**, via Pōneke Travel Insights. Road centrelines are WCC.
GIS layers belong to their publishers — WCC, Greater Wellington, WREMO, GNS Science, NIWA,
Wellington Water, MBIE, NZTA, MetService — and **licences vary per dataset**. Basemap
© OpenStreetMap, © CARTO.
