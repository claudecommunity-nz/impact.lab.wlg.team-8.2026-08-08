"""Pluggable feeds, and the one read that only exists when you join them.

Three kinds of thing live here, and the separation is the product argument:

* **Advisement feeds** — "what will move the numbers this week". Each is a tiny
  adapter over one source that returns the same `Advisement` shape. Today: the
  NZTA road-events layer, the MetService CAP warnings layer, a hand-entered
  events list, and a declared cruise-berth stub. Adding a fifth is one function
  and one registry line; nothing else in the pipeline or the UI changes.
* **Risk-area feeds** — "where a rise matters more". Hazard polygons, named and
  classed, from the GIS layers already on disk.
* **The area-risk join** — for every risk area, how much movement is inside it
  right now versus how much was forecast. That is the compounding read: more
  people than expected inside a tsunami evacuation zone is a materially worse
  fact than the same rise on safe ground, and no existing tool says it.

Two rules the module enforces rather than trusts:

* **A feed that returns nothing must say why.** "No cruise berthings this week"
  and "we never connected the cruise schedule" are completely different facts to
  a duty officer, and a silent empty list conflates them. Every feed ships a
  `status` and an `empty_reason`.
* **Nothing here moves a forecast.** Every advisement leaves with
  `applied: False`. We have no measured effect size for any of these events, and
  a made-up multiplier inside a published forecast is exactly the failure this
  project is arguing against. They are listed so a human can explain a deviation,
  not used to explain it away.
"""

from __future__ import annotations

import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb
import numpy as np

from . import config
from .daycal import DayCalendar
from .edges import EDGE_SERIES, _site_hours
from .week import HOURS, WEEK_HOURS

P = config.PARAMS

# Wellington City and its harbour. Used only to drop national records from
# nationwide feeds — it is a coarse filter, and it is allowed to be, because
# everything that survives it is then shown with its own location text.
WELLINGTON_BBOX = (174.60, -41.40, 175.00, -41.10)

# NZST. Wellington is UTC+12 in August with no DST in force, so a fixed offset
# is exact for this week. Epoch-ms fields in the NZTA layer are real instants,
# unlike the all-day-ish windows in the WCC closure layer, so they are worth
# rendering in local time.
NZ = timezone(timedelta(hours=12))

# --- area-risk thresholds --------------------------------------------------
# A zone with fewer cameras than this has one or two sensors speaking for a
# whole coastline. Rank it, say so, never call an anomaly on it. Deliberately
# higher than the edge rule (2) because a zone is kilometres across.
AREA_MIN_SITES = 3
# How much movement an hour must be FORECAST inside a zone before a percentage
# on it is a finding. At 03:00 a coastal zone forecasts single digits and one
# extra car reads as +40%.
AREA_MIN_FORECAST = 50
# Zones smaller than this are rocks and reefs in the hazard layer — no street,
# no sensor, no read.
AREA_MIN_KM2 = 0.05


# =========================================================== advisement feeds
def _fmt_window(s: datetime, e: datetime) -> str:
    """"SAT 19–22" within a day, "SUN 9 → TUE 11" across days.

    Hours are dropped on a multi-day window on purpose. The NZTA record for the
    Ngauranga off-ramp carries a structured start of Sun 08:00 and a free-text
    comment saying the closure runs 21:00–04:30 on two nights: the envelope is
    right and the hour is an activation timestamp, not a closure time. Rendering
    "SUN 08 → TUE 03" published an hour that the source's own text contradicts.
    The precise hours stay in the detail line, in the publisher's words.
    """
    if s.date() == e.date():
        return f"{s.strftime('%a %H').upper()}–{e.strftime('%H')}"
    return f"{s.strftime('%a %-d').upper()} → {e.strftime('%a %-d').upper()}"


def _bbox_hit(geom: dict | None) -> bool:
    if not geom:
        return False
    x0, y0, x1, y1 = WELLINGTON_BBOX

    def walk(node):
        if isinstance(node, list):
            if node and isinstance(node[0], (int, float)):
                yield node
            else:
                for c in node:
                    yield from walk(c)

    return any(x0 <= p[0] <= x1 and y0 <= p[1] <= y1
               for p in walk(geom.get("coordinates", [])))


def nzta_road_events(ws: date, we: date) -> tuple[list[dict], str | None]:
    """REAL. NZTA Journey Planner road events, snapshot on disk.

    An event that STARTS inside the week is news. One already in force is not —
    it is inside the baseline — so it is dropped here and picked up by the
    standing-conditions path instead of being announced as if it were new.
    """
    path = config.GIS_RAW / "nzta-warnings-road-events.geojson"
    feats = json.loads(path.read_text()).get("features", [])
    local = [f for f in feats if _bbox_hit(f.get("geometry"))]
    w0 = datetime.combine(ws, datetime.min.time(), NZ)
    w1 = datetime.combine(we, datetime.max.time(), NZ)

    items: list[dict] = []
    for f in local:
        p = f["properties"]
        if p.get("status") == "Resolved" or not p.get("startDate"):
            continue
        s = datetime.fromtimestamp(p["startDate"] / 1000, NZ)
        e = (datetime.fromtimestamp(p["endDate"] / 1000, NZ)
             if p.get("endDate") else w1)
        if e < w0 or s > w1 or s < w0:
            continue
        where = (p.get("locationArea") or "").strip()
        # eventDescription is free text and is frequently the literal "Other",
        # which titles a row with nothing. Fall back to the typed field.
        what = (p.get("eventDescription") or "").strip()
        if what.lower() in ("", "other"):
            what = (p.get("eventType") or "Road event").strip()
        items.append({
            "id": f"nzta-{p.get('eventId') or p['OBJECTID']}",
            "when": _fmt_window(s, e),
            "title": what + (f" · {where}" if where else ""),
            "detail": (p.get("eventComments") or "").strip() or None,
            "expected_delta_pct": None,
            "source": "nzta-road-events",
            "hand_entered": False,
            "applied": False,
            "starts": s.isoformat(timespec="minutes"),
            "ends": e.isoformat(timespec="minutes"),
        })
    reason = None
    if not items:
        reason = (f"{len(local)} Wellington records in the layer, none starting "
                  "inside this week.")
    return items, reason


def metservice_warnings(ws: date, we: date) -> tuple[list[dict], str | None]:
    """REAL. MetService CAP warnings, snapshot on disk.

    Weather is the advisement that matters most — a drop under an issued warning
    is evidence the message landed. The layer is a snapshot of what was ACTIVE at
    fetch time; MetService publishes no archive, so this can never be replayed.
    """
    path = config.GIS_RAW / "metservice-warnings.geojson"
    doc = json.loads(path.read_text())
    feats = doc.get("features", [])
    local = [f for f in feats if _bbox_hit(f.get("geometry"))]

    items: list[dict] = []
    for f in local:
        p = f["properties"]
        s = _parse_iso(p.get("info_effective") or p.get("sent"))
        e = _parse_iso(p.get("info_expires"))
        if s is None:
            continue
        items.append({
            "id": f"metservice-{p.get('identifier', p.get('OBJECTID'))}",
            "when": _fmt_window(s, e or s),
            "title": (p.get("info_event") or "Severe weather warning").strip(),
            "detail": (p.get("info_area_areaDesc") or "").strip() or None,
            "expected_delta_pct": None,
            "source": "metservice-warnings",
            "hand_entered": False,
            "applied": False,
            "starts": s.isoformat(timespec="minutes"),
            "ends": e.isoformat(timespec="minutes") if e else None,
        })
    reason = None
    if not items:
        reason = (f"{len(feats)} warning(s) active nationally at fetch time, none "
                  "covering the Wellington region. Silence here is a real reading: "
                  "no severe weather is forecast to suppress movement this week.")
    return items, reason


def _parse_iso(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v).astimezone(NZ)
    except ValueError:
        return None


# HAND-ENTERED. Every row was read off a public listing by a person and typed in;
# none of it arrived over a wire, and the UI badges it as such. `verified_against`
# records where a human looked, so the claim can be checked rather than believed.
#
# No row carries an expected magnitude. We have no measured effect size for a
# comedy show at the Michael Fowler Centre, and a percentage a duty officer can
# quote back at us has to be measured, not guessed. The column renders "—".
HAND_ENTERED_EVENTS = [
    {
        "id": "event-mfc-2026-08-08",
        "title": "Alan Davies · Think Ahead, Michael Fowler Centre",
        "detail": ("Evening show in Civic Square. Expect a walk-up peak on "
                   "Wakefield St and the Jervois Quay crossings from about 18:30 "
                   "and a sharper one at turn-out. Direction only — we have no "
                   "measured effect size for this venue."),
        "starts": "2026-08-08T19:30",
        "ends": "2026-08-08T22:00",
        "expected_delta_pct": None,
        "verified_against": "eventfinda.co.nz listing, read 8 Aug 2026",
    },
]


def hand_entered_events(ws: date, we: date) -> tuple[list[dict], str | None]:
    items = []
    for e in HAND_ENTERED_EVENTS:
        s, en = datetime.fromisoformat(e["starts"]), datetime.fromisoformat(e["ends"])
        if not (ws <= s.date() <= we):
            continue
        # source is the FEED id, matching every other row; `hand_entered` is what
        # earns the badge. Setting source to "hand-entered" too printed the words
        # twice in one row — the same fact stated by two different mechanisms.
        items.append({**e, "when": _fmt_window(s, en), "source": "wellington-events",
                      "hand_entered": True, "applied": False})
    reason = None if items else "No hand-entered event falls inside this week."
    return items, reason


def cruise_berthings(ws: date, we: date) -> tuple[list[dict], str | None]:
    """STUB — declared, not connected.

    A berthing puts thousands of people onto the waterfront inside a known window
    and is the single most on-thesis advisement we could carry. CentrePort
    publishes the schedule as a web page, not a feed, so this adapter exists to
    declare the shape one would arrive in and nothing else. It returns nothing,
    and the UI is required to say why: pretending to a live integration is worse
    than admitting to none.
    """
    return [], ("Not connected. CentrePort publishes the cruise schedule as a web "
                "page; the 2026/27 season opens 25 Oct 2026, so there are no "
                "Wellington berthings in this week under any source.")


# Registry. The whole point of the module: a feed is a name, a status and a
# function with one signature.
ADVISEMENT_FEEDS = [
    {
        "id": "nzta-road-events",
        "name": "NZTA road events",
        "status": "connected",
        "real": True,
        "publisher": "NZ Transport Agency Waka Kotahi",
        "provenance": ("NZTA Journey Planner road-events layer, snapshot at fetch "
                       "time. Planned works and hazards on state highways only — "
                       "local-road closures are not in it."),
        "fn": nzta_road_events,
    },
    {
        "id": "metservice-warnings",
        "name": "MetService severe weather",
        "status": "connected",
        "real": True,
        "publisher": "MetService",
        "provenance": ("MetService CAP warnings, snapshot at fetch time. Current "
                       "warnings only — MetService publishes no archive, so this "
                       "feed cannot be replayed against a past date."),
        "fn": metservice_warnings,
    },
    {
        "id": "wellington-events",
        "name": "Named events (duty desk)",
        "status": "hand-entered",
        "real": False,
        "publisher": "Hand-entered by the duty desk",
        "provenance": ("Typed in by a person from public listings. Not a feed. "
                       "Every row records where it was read from."),
        "fn": hand_entered_events,
    },
    {
        "id": "centreport-cruise",
        "name": "Cruise berthings (CentrePort)",
        "status": "stub",
        "real": False,
        "publisher": "CentrePort Wellington",
        "provenance": ("Adapter declared, never connected. Shown so the gap is "
                       "visible on the platform rather than invisible."),
        "fn": cruise_berthings,
    },
]


# ============================================================= risk-area feeds
# Which hazard layers become risk areas, and how to read a name and a class off
# each. Third entry proves the first two are not special-cased.
RISK_LAYERS = [
    {
        "id": "tsunami-evacuation-zones",
        "name": "Tsunami evacuation zones",
        "publisher": "Wellington Region Emergency Management Office",
        "licence_note": "WREMO / GWRC hazard planning layer. Planning use only.",
        "where": lambda p: p.get("LA") == "Wellington City Council",
        "area_name": lambda p: p.get("Location") or "Unnamed",
        "area_class": lambda p: p.get("Evac_Zone") or "Zone",
        # Zone_Class 1 is nearest the water. Rank ascending = worst first.
        "class_rank": lambda p: int(p.get("Zone_Class") or 9),
        "detail": lambda p: p.get("Info"),
    },
    {
        "id": "coastal-inundation-high",
        "name": "Coastal inundation (high)",
        "publisher": "Wellington City Council",
        "licence_note": "WCC District Plan hazard overlay. Planning use only.",
        "where": lambda p: True,
        "area_name": lambda p: p.get("Name") or "Coastal inundation",
        "area_class": lambda p: p.get("Type") or "Overlay",
        "class_rank": lambda p: 2,
        "detail": lambda p: None,
    },
]


def _rings(geom: dict) -> list[list[list[list[float]]]]:
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def _inside(lon: np.ndarray, lat: np.ndarray, polys) -> np.ndarray:
    """Point-in-polygon by ray casting, holes XOR'd out.

    Vectorised over points, looped over rings. numpy over 124 sites and a few
    thousand ring segments is milliseconds; pulling in shapely for this would be
    a dependency for one function.
    """
    out = np.zeros(len(lon), bool)
    for rings in polys:
        acc = np.zeros(len(lon), bool)
        for ri, ring in enumerate(rings):
            r = np.asarray(ring, float)
            hit = _ray(lon, lat, r[:, 0], r[:, 1])
            acc = hit if ri == 0 else acc ^ hit
        out |= acc
    return out


def _ray(px: np.ndarray, py: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    x1, y1, x2, y2 = xs[:-1], ys[:-1], xs[1:], ys[1:]
    Py = py[:, None]
    crosses = (y1 > Py) != (y2 > Py)
    with np.errstate(divide="ignore", invalid="ignore"):
        xint = x1 + (Py - y1) * (x2 - x1) / (y2 - y1)
    return ((crosses & (px[:, None] < xint)).sum(axis=1) % 2).astype(bool)


def _areas() -> list[dict]:
    """Every risk area we can read, with its geometry kept for the join."""
    out = []
    for spec in RISK_LAYERS:
        path = config.GIS_RAW / f"{spec['id']}.geojson"
        if not path.exists():
            continue
        for f in json.loads(path.read_text()).get("features", []):
            p = f["properties"]
            if not spec["where"](p):
                continue
            km2 = round(float(p.get("Shape.STArea()") or p.get("Shape_Area") or 0)
                        / 1e6, 2)
            if km2 < AREA_MIN_KM2:
                continue
            name, cls = spec["area_name"](p), spec["area_class"](p)
            out.append({
                "id": f"{spec['id']}-{p.get('OBJECTID')}",
                "layer": spec["id"],
                "layer_name": spec["name"],
                "publisher": spec["publisher"],
                "licence_note": spec["licence_note"],
                "name": name,
                "class": cls,
                "class_rank": spec["class_rank"](p),
                "detail": spec["detail"](p),
                "area_km2": km2,
                "_polys": _rings(f["geometry"]),
            })
    return out


# ============================================================ the area join ==
def _site_forecast(hist: dict[str, np.ndarray], cal: DayCalendar, dates: list[str],
                   week_start: date, n_sites: int, trend: float) -> np.ndarray:
    """Per-site per-hour forecast, (S, 168, K).

    The same robust same-weekday same-hour median edges.py uses, run again here
    rather than shared: edges.build folds it straight into geometry and returns
    only the finished edge objects, and reaching into that to get the site array
    back out would couple two modules through a private intermediate. The pool
    ends the day before the week starts, so this is out of sample for every hour
    in the week, confirmed ones included.
    """
    fc = np.zeros((n_sites, WEEK_HOURS, len(EDGE_SERIES)))
    lo = week_start - timedelta(days=P.window_days)
    for di, d in enumerate(dates):
        wd = date.fromisoformat(d).weekday()
        pool = sorted(p for p in hist
                      if lo <= date.fromisoformat(p) < week_start
                      and date.fromisoformat(p).weekday() == wd
                      and cal.eligible(p))[-P.max_occurrences:]
        if not pool:
            continue
        med = np.median(np.stack([hist[p] for p in pool]), axis=0)
        fc[:, di * HOURS:(di + 1) * HOURS] = med * trend
    return fc


def _dev(actual: np.ndarray, forecast: np.ndarray) -> list[int | None]:
    """Signed percent, null wherever there is no actual or the hour was too
    quiet to carry a ratio. Mirrors the edge rule so the two cards cannot
    disagree about what "no reading" means."""
    out: list[int | None] = []
    for a, f in zip(actual, forecast):
        out.append(None if (np.isnan(a) or f < AREA_MIN_FORECAST)
                   else int(round((a - f) / f * 100)))
    return out


def build(con: duckdb.DuckDBPyConnection, source: Path, cal: DayCalendar,
          newest: str, trend: float, confirmed: int,
          edges_artefact: dict) -> tuple[dict[str, dict], dict]:
    """Returns ({relative output path: payload}, report)."""
    nd = date.fromisoformat(newest)
    ws = nd - timedelta(days=nd.weekday())
    we = ws + timedelta(days=6)
    dates = [(ws + timedelta(days=i)).isoformat() for i in range(7)]

    files: dict[str, dict] = {}

    # --- advisement feeds --------------------------------------------------
    feed_meta = []
    total_items = 0
    for spec in ADVISEMENT_FEEDS:
        items, reason = spec["fn"](ws, we)
        total_items += len(items)
        meta = {k: spec[k] for k in
                ("id", "name", "status", "real", "publisher", "provenance")}
        meta |= {"kind": "advisement", "items": len(items),
                 "empty_reason": reason if not items else None,
                 "file": f"feeds/advisements/{spec['id']}.json"}
        files[f"feeds/advisements/{spec['id']}.json"] = {"feed": meta, "items": items}
        feed_meta.append(meta)

    # --- risk areas + the join --------------------------------------------
    areas = _areas()

    sites, hist = _site_hours(
        con, source, (ws - timedelta(days=P.window_days)).isoformat(), dates[-1])
    S, K = len(sites), len(EDGE_SERIES)
    fc = _site_forecast(hist, cal, dates, ws, S, trend)
    act = np.full((S, WEEK_HOURS, K), np.nan)
    for di, d in enumerate(dates):
        if d in hist:
            act[:, di * HOURS:(di + 1) * HOURS] = hist[d]
    act[:, confirmed:] = np.nan

    # Site positions: the mean of the countline midpoints on that camera. A
    # viewpoint's countlines sit within metres of each other, so the centroid is
    # the camera, and it is what decides which zone the reading belongs to.
    rows = con.execute(
        f"""select cast(viewpoint_id as varchar) vp,
                   avg((cast(latitude_start_line as double)
                        + cast(latitude_end_line as double)) / 2) lat,
                   avg((cast(longitude_start_line as double)
                        + cast(longitude_end_line as double)) / 2) lon
            from '{config.META}'
            where viewpoint_id is not null and latitude_start_line is not null
            group by 1""").fetchall()
    pos = {r[0]: (r[2], r[1]) for r in rows}
    six = {s: i for i, s in enumerate(sites)}
    have = [s for s in sites if s in pos]
    lon = np.asarray([pos[s][0] for s in have])
    lat = np.asarray([pos[s][1] for s in have])

    # Edge geometry, for evidence. Naming the streets a zone's reading rests on
    # is the difference between a claim and a citation.
    e_names, e_lon, e_lat, e_owner = [], [], [], []
    for e in edges_artefact["edges"]:
        for part in e["path"]:
            for x, y in part:
                e_lon.append(x)
                e_lat.append(y)
                e_owner.append(len(e_names))
        e_names.append(e["name"])
    e_lon = np.asarray(e_lon)
    e_lat = np.asarray(e_lat)
    e_owner = np.asarray(e_owner)

    out_areas = []
    for a in areas:
        polys = a.pop("_polys")
        m = _inside(lon, lat, polys)
        in_sites = [have[i] for i in np.flatnonzero(m)]
        idx = [six[s] for s in in_sites]

        hit = np.unique(e_owner[_inside(e_lon, e_lat, polys)]) if len(e_lon) else []
        streets = sorted({e_names[i] for i in hit})

        rec = dict(a)
        rec |= {
            "sites": len(in_sites),
            "site_ids": in_sites,
            "streets": streets[:12],
            "n_streets": len(streets),
            "judged": len(in_sites) >= AREA_MIN_SITES,
        }
        if idx:
            f_sum = fc[idx].sum(axis=0)
            a_sum = act[idx].sum(axis=0)
            rec |= {
                "forecast": {k: [int(round(v)) for v in f_sum[:, i]]
                             for i, k in enumerate(EDGE_SERIES)},
                "actual": {k: [None if math.isnan(v) else int(round(v))
                               for v in a_sum[:, i]]
                           for i, k in enumerate(EDGE_SERIES)},
                "dev": {k: _dev(a_sum[:, i], f_sum[:, i])
                        for i, k in enumerate(EDGE_SERIES)},
            }
        else:
            # No camera inside the polygon. This is a real and useful output:
            # the zone is unwatched, and saying so beats an empty row.
            rec |= {"forecast": None, "actual": None, "dev": None}
        out_areas.append(rec)

    out_areas.sort(key=lambda r: (r["class_rank"], -r["sites"]))
    watched = sum(1 for r in out_areas if r["judged"])

    files["feeds/area-risk.json"] = {
        "version": 1,
        "week_start": ws.isoformat(),
        "hours": WEEK_HOURS,
        "confirmed_hours": confirmed,
        "series": list(EDGE_SERIES),
        "min_sites": AREA_MIN_SITES,
        "min_forecast_flow": AREA_MIN_FORECAST,
        "n_areas": len(out_areas),
        "n_areas_judged": watched,
        "method": {
            "join": ("Camera sites are placed inside a hazard polygon by "
                     "point-in-polygon on the camera position, then their hourly "
                     "counts are summed. The zone number is the movement past the "
                     "cameras inside it, not the population of the zone."),
            "forecast": ("Same-weekday same-hour robust median per camera over the "
                         "84 days before the week, capped at 12 occurrences, times "
                         "the citywide trend factor. Out of sample for every hour "
                         "in the week."),
            "unjudged_rule": (f"Fewer than {AREA_MIN_SITES} cameras inside a zone, "
                              "or an hour forecasting under "
                              f"{AREA_MIN_FORECAST} movements, is not judged. Too "
                              "few sensors in a zone is a reading in itself."),
            # Kept to one sentence each: these render as card footnotes in a
            # 330 px column, and a four-sentence caveat pushed the card it was
            # qualifying off the bottom of the screen.
            "inference": ("Inference about where people are, not an established "
                          "cause. Hazard-planning polygons, not an active hazard. "
                          "Zones nest, so one camera can sit inside three."),
        },
        "areas": out_areas,
    }

    files["feeds/index.json"] = {
        "version": 1,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "week_start": ws.isoformat(),
        "week_end": we.isoformat(),
        "advisement_feeds": feed_meta,
        "advisements_note": (
            "Feeds are modular: each adapter returns the same shape and adding one "
            "changes nothing else. Nothing here is applied to the forecast — we "
            "have no measured effect size for any of it, so the expected column is "
            "blank rather than guessed."),
        "risk_layers": [
            {"id": s["id"], "name": s["name"], "publisher": s["publisher"],
             "licence_note": s["licence_note"],
             "geometry_file": f"data/gis/{s['id']}.geojson"
             if any(g[0] == s["id"] for g in config.GIS_LAYERS) else None}
            for s in RISK_LAYERS
        ],
        "area_risk_file": "data/feeds/area-risk.json",
    }

    report = {
        "feeds": len(ADVISEMENT_FEEDS),
        "feeds_connected": sum(1 for f in feed_meta if f["status"] == "connected"),
        "items": total_items,
        "feed_meta": feed_meta,
        "areas": len(out_areas),
        "areas_judged": watched,
        "areas_unwatched": sum(1 for r in out_areas if r["sites"] == 0),
        "area_rows": out_areas,
    }
    return files, report
