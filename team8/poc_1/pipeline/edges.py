"""The edge network: camera sites projected onto real street geometry.

A countline is a 20 m line across a road. Drawing 123 of them on a city map
gives you 123 dots and no sense of a network. This module turns those dots into
named stretches of street, so a duty officer reads "Thorndon Quay is down 40%"
instead of "sensor 5722 is down 40%".

The rules below are measured, not guessed (see the build report):

* **Snap cap 25 m.** Every countline in this dataset lands within 25 m of a road
  centreline in `roads.geojson`, median ~4 m. Nothing is dropped for distance.
* **Group by `ramm_road_id`.** `location` is a from->to descriptor
  ("(PRIVATE) Hawker St -> Dead End") and is useless as a name; `ramm_alias` is
  the street name and `ramm_road_id` is the stable key.
* **Graph on endpoint-to-any-VERTEX at 1 m.** Endpoint-to-endpoint only
  fragments the network, because RAMM carriageways commonly T into the middle
  of another carriageway's vertex run rather than at its tip.
* **No perpendicularity gate.** 64 countlines are drawn ALONG the road by
  design (cycle lanes, path counters). Rejecting non-perpendicular snaps would
  throw away exactly the pedestrian and cycle sensors this product needs.
* **Not footpaths.geojson.** Every feature in it is a straight 2-point chord
  between its endpoints, so a "footpath" edge would be a line through buildings.

Propagation is deliberately conservative: a sensor's reading is spread along the
street for a 300 m budget, decaying linearly to zero, and crossing to a
different road costs an extra 150 m of budget. A sensor knows about the street
it is on; it does not know about the next suburb.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, timedelta
from heapq import heappop, heappush
from pathlib import Path

import duckdb
import numpy as np

from . import config
from .daycal import DayCalendar
from .week import HOURS, WEEK_HOURS, Z80

P = config.PARAMS

SNAP_CAP_M = 25.0        # measured max is well under this; asserted in the report
JOIN_TOLERANCE_M = 1.0   # endpoint-to-any-vertex
BUDGET_M = 300.0         # how far one sensor's reading is allowed to travel
CROSS_ROAD_PENALTY_M = 150.0  # soft, not a wall: a corner sensor still informs the corner

# Hourly series carried per edge. Three, not seven: the map colours by one of
# these and the payload is 168 x n_edges per series. Per-mode day totals below
# carry the rest of the signature.
EDGE_SERIES = ("total", "pedestrian", "veh")
_EDGE_SQL = {
    "total": " + ".join(config.ALL_MODES),
    "pedestrian": "pedestrian",
    "veh": "car + bus + lgv",
}

# Deviations are clamped before they are shipped. A +4000% edge is a baseline
# failure, not a story, and it destroys every diverging colour ramp it lands on.
DEV_CLAMP_PCT = 200


# ---------------------------------------------------------------- geometry --
# Local equirectangular metres about Wellington. Good to ~0.1% over a city and
# it keeps the whole thing to numpy — no geopandas, no shapely, 0.2 s.
LAT0 = -41.29
_MX = 111_320.0 * math.cos(math.radians(LAT0))
_MY = 110_540.0


def _to_m(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return lon * _MX, lat * _MY


def _load_roads(path: Path) -> dict:
    """Flatten roads.geojson into vertex arrays plus per-polyline slices."""
    feats = json.loads(path.read_text())["features"]
    xs, ys, lons, lats = [], [], [], []
    starts, counts, props = [], [], []
    for f in feats:
        g = f["geometry"]
        parts = ([g["coordinates"]] if g["type"] == "LineString"
                 else g["coordinates"])
        for co in parts:
            if len(co) < 2:
                continue
            arr = np.asarray(co, dtype=np.float64)[:, :2]
            starts.append(len(xs))
            counts.append(len(arr))
            x, y = _to_m(arr[:, 0], arr[:, 1])
            xs.extend(x)
            ys.extend(y)
            lons.extend(arr[:, 0])
            lats.extend(arr[:, 1])
            props.append(f["properties"])
    return {
        "x": np.asarray(xs), "y": np.asarray(ys),
        "lon": np.asarray(lons), "lat": np.asarray(lats),
        "start": np.asarray(starts), "count": np.asarray(counts),
        "props": props,
    }


def _segments(R: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Every (p0, p1) segment across every polyline, plus its owning polyline."""
    keep = np.ones(len(R["x"]) - 1, dtype=bool)
    # A segment must not straddle two polylines, so drop the last index of each.
    keep[(R["start"] + R["count"] - 1)[:-1]] = False
    keep[R["start"][-1] + R["count"][-1] - 1:] = False
    idx = np.flatnonzero(keep)
    owner = np.repeat(np.arange(len(R["start"])), R["count"] - 1)
    return R["x"][idx], R["y"][idx], R["x"][idx + 1], R["y"][idx + 1], owner


def _snap(px: np.ndarray, py: np.ndarray, seg) -> tuple[np.ndarray, np.ndarray]:
    """Nearest polyline for each point, and the distance in metres.

    Point-to-segment, not point-to-vertex: a 200 m carriageway drawn with two
    vertices would otherwise read as 100 m away from a sensor sitting on it.
    """
    x0, y0, x1, y1, owner = seg
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy
    L2 = np.where(L2 == 0, 1e-9, L2)
    best_d = np.full(len(px), np.inf)
    best_i = np.zeros(len(px), dtype=np.int64)
    for i in range(len(px)):
        t = np.clip(((px[i] - x0) * dx + (py[i] - y0) * dy) / L2, 0.0, 1.0)
        ex, ey = px[i] - (x0 + t * dx), py[i] - (y0 + t * dy)
        d = np.hypot(ex, ey)
        j = int(np.argmin(d))
        best_d[i], best_i[i] = d[j], owner[j]
    return best_i, best_d


def _adjacency(R: dict) -> dict[int, list[int]]:
    """Polyline adjacency: an endpoint of A within 1 m of ANY vertex of B.

    Endpoint-to-endpoint alone fragments this network badly, because RAMM
    carriageways T into the middle of their neighbour's vertex run.
    """
    cell = JOIN_TOLERANCE_M
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    gx = np.floor(R["x"] / cell).astype(np.int64)
    gy = np.floor(R["y"] / cell).astype(np.int64)
    owner = np.repeat(np.arange(len(R["start"])), R["count"])
    for k in range(len(gx)):
        grid[(gx[k], gy[k])].append(k)

    adj: dict[int, set[int]] = defaultdict(set)
    ends = np.concatenate([R["start"], R["start"] + R["count"] - 1])
    for k in ends:
        a = owner[k]
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                for m in grid.get((gx[k] + ox, gy[k] + oy), ()):
                    if np.hypot(R["x"][k] - R["x"][m], R["y"][k] - R["y"][m]) <= cell:
                        b = owner[m]
                        if a != b:
                            adj[a].add(b)
                            adj[b].add(a)
    return {k: sorted(v) for k, v in adj.items()}


def _lengths(R: dict) -> np.ndarray:
    out = np.zeros(len(R["start"]))
    for i, (s, c) in enumerate(zip(R["start"], R["count"])):
        out[i] = np.hypot(np.diff(R["x"][s:s + c]), np.diff(R["y"][s:s + c])).sum()
    return out


def _propagate(seeds: dict[int, list[str]], adj, lengths, road_id) -> dict[int, dict[str, float]]:
    """{polyline -> {site -> weight}} within the budget, decaying to zero."""
    reach: dict[int, dict[str, float]] = defaultdict(dict)
    for seed, sites in seeds.items():
        best: dict[int, float] = {seed: 0.0}
        pq = [(0.0, seed)]
        while pq:
            cost, node = heappop(pq)
            if cost > best.get(node, math.inf):
                continue
            w = 1.0 - cost / BUDGET_M
            for s in sites:
                reach[node][s] = max(reach[node].get(s, 0.0), w)
            for nb in adj.get(node, ()):
                step = lengths[nb]
                if road_id[nb] != road_id[node]:
                    step += CROSS_ROAD_PENALTY_M
                nc = cost + step
                if nc < BUDGET_M and nc < best.get(nb, math.inf):
                    best[nb] = nc
                    heappush(pq, (nc, nb))
    return reach


# ------------------------------------------------------------ site history --
def _site_hours(con: duckdb.DuckDBPyConnection, source: Path,
                lo: str, hi: str) -> tuple[list[str], dict[str, np.ndarray]]:
    """{date: (n_sites, 24, 3)} per camera site. Rolls countlines up on
    `viewpoint_id` — one camera carries a median of 3 countlines, and scoring
    them separately triple-counts the same 5 m of street."""
    cols = ", ".join(f"sum({sql}) as s_{k}" for k, sql in _EDGE_SQL.items())
    rows = con.execute(
        f"""
        with m as (select countline_id, cast(viewpoint_id as varchar) vp
                   from '{config.META}' where viewpoint_id is not null)
        select m.vp, cast(f.countline_date as varchar) d,
               cast(f.countline_hour as int) h, {cols}
        from '{source}' f join m using (countline_id)
        where f.countline_date between ? and ?
        group by 1, 2, 3
        """,
        [lo, hi],
    ).fetchall()
    sites = sorted({r[0] for r in rows})
    six = {s: i for i, s in enumerate(sites)}
    out: dict[str, np.ndarray] = {}
    for vp, d, h, *vals in rows:
        out.setdefault(d, np.zeros((len(sites), HOURS, len(EDGE_SERIES))))[six[vp], h] = vals
    return sites, out


def build(con: duckdb.DuckDBPyConnection, source: Path, cal: DayCalendar,
          newest: str, trend: float, confirmed: int) -> tuple[dict, dict]:
    """Returns (artefact, report). `report` is printed by build.py."""
    nd = date.fromisoformat(newest)
    week_start = nd - timedelta(days=nd.weekday())
    dates = [(week_start + timedelta(days=i)).isoformat() for i in range(7)]
    pool_lo = (week_start - timedelta(days=P.window_days)).isoformat()

    # --- site history, forecast and actual --------------------------------
    sites, hist = _site_hours(con, source, pool_lo, dates[-1])
    S, K = len(sites), len(EDGE_SERIES)
    fc = np.zeros((S, WEEK_HOURS, K))
    sp = np.zeros((S, WEEK_HOURS, K))
    for di, d in enumerate(dates):
        lo = week_start - timedelta(days=P.window_days)
        pool = sorted(p for p in hist
                      if lo <= date.fromisoformat(p) < week_start
                      and date.fromisoformat(p).weekday() == date.fromisoformat(d).weekday()
                      and cal.eligible(p))[-P.max_occurrences:]
        if not pool:
            continue
        stack = np.stack([hist[p] for p in pool])            # (n, S, 24, K)
        med = np.median(stack, axis=0)
        mad = np.median(np.abs(stack - med), axis=0) * P.mad_scale
        fc[:, di * HOURS:(di + 1) * HOURS] = med * trend
        sp[:, di * HOURS:(di + 1) * HOURS] = np.maximum(
            mad, np.maximum(P.mad_floor_abs, P.mad_floor_frac * med))

    act = np.full((S, WEEK_HOURS, K), np.nan)
    for di, d in enumerate(dates):
        if d in hist:
            act[:, di * HOURS:(di + 1) * HOURS] = hist[d]
    act[:, confirmed:] = np.nan

    # --- geometry ----------------------------------------------------------
    R = _load_roads(config.GIS_RAW / "roads.geojson")
    seg = _segments(R)
    adj = _adjacency(R)
    lengths = _lengths(R)
    road_id = np.asarray([p.get("ramm_road_id") for p in R["props"]])

    meta = con.execute(
        f"""select countline_id, name, cast(viewpoint_id as varchar) vp,
                   (cast(latitude_start_line as double)+cast(latitude_end_line as double))/2 lat,
                   (cast(longitude_start_line as double)+cast(longitude_end_line as double))/2 lon
            from '{config.META}'
            where viewpoint_id is not null and latitude_start_line is not null""").fetchall()
    meta = [m for m in meta if m[2] in set(sites)]
    cl_lon = np.asarray([m[4] for m in meta])
    cl_lat = np.asarray([m[3] for m in meta])
    px, py = _to_m(cl_lon, cl_lat)
    snap_i, snap_d = _snap(px, py, seg)

    # A countline further than the cap has no street we can honestly attach it
    # to. Measured max is far below the cap, so this drops nothing today — it is
    # here so that a future data pull that DOES break the assumption fails
    # visibly instead of gluing a sensor onto the wrong street.
    ok = snap_d <= SNAP_CAP_M

    # --- sites -> seed polylines ------------------------------------------
    votes: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    kinds: dict[str, list[str]] = defaultdict(list)
    for j, (cid, name, vp, _lat, _lon) in enumerate(meta):
        if not ok[j]:
            continue
        votes[vp][int(snap_i[j])] += 1
        kinds[vp].append(_kind(name))
    seeds: dict[int, list[str]] = defaultdict(list)
    for vp, v in votes.items():
        seeds[max(v, key=lambda k: (v[k], -k))].append(vp)

    reach = _propagate(dict(seeds), adj, lengths, road_id)

    # --- reached polylines -> named edges ---------------------------------
    # One edge = one RAMM road id. Two sensors on the same street must not
    # produce two rows called "Thorndon Quay" in a ranked list.
    by_road: dict[object, list[int]] = defaultdict(list)
    for poly in reach:
        by_road[road_id[poly]].append(poly)

    six = {s: i for i, s in enumerate(sites)}
    edges = []
    for rid, polys in sorted(by_road.items(), key=lambda kv: -sum(lengths[p] for p in kv[1])):
        w: dict[str, float] = {}
        for p in polys:
            for site, weight in reach[p].items():
                w[site] = max(w.get(site, 0.0), weight)
        w = {s: v for s, v in w.items() if v > 0.02}
        if not w:
            continue
        ws = np.asarray([w[s] for s in w])[:, None, None]
        rows = np.asarray([six[s] for s in w])

        e_fc = (fc[rows] * ws).sum(axis=0) / ws.sum()          # (168, K)
        with np.errstate(invalid="ignore"):
            e_ac = (act[rows] * ws).sum(axis=0) / ws.sum()

        prop = R["props"][polys[0]]
        direct = sorted({s for p in polys for s in seeds.get(p, [])})
        edges.append({
            "id": f"r{rid}",
            "name": (prop.get("ramm_alias") or prop.get("location")
                     or f"road {rid}").strip(),
            "suburb": prop.get("suburb"),
            "road_category": prop.get("category"),
            "onrc": prop.get("ONRC"),
            # What the sensors on it actually count. The geometry is always a
            # road centreline, so this is the sensor's subject, not the line's.
            "type": _dominant([k for s in w for k in kinds.get(s, [])]),
            "length_m": int(round(sum(lengths[p] for p in polys))),
            "path": [_poly(R, p) for p in polys],
            "sensors": len(w),
            "sensors_direct": len(direct),
            "sensor_sites": sorted(w),
            "weights": {s: round(v, 3) for s, v in sorted(w.items())},
            "flow_per_hour": (int(round(np.nanmean(e_ac[:confirmed, 0])))
                              if confirmed else None),
            "forecast_flow": _ints(e_fc[:, 0]),
            "flow": _nullable(e_ac[:, 0]),
            "dev": {k: _dev(e_ac[:, i], e_fc[:, i]) for i, k in enumerate(EDGE_SERIES)},
            "day": _day_rollup(e_ac, e_fc, confirmed),
        })

    edges.sort(key=lambda e: (-(e["sensors_direct"] > 0), -(e["flow_per_hour"] or 0)))

    report = {
        "roads_polylines": len(R["start"]),
        "roads_vertices": int(len(R["x"])),
        "countlines_snapped": int(ok.sum()),
        "countlines_total": len(meta),
        "snap_max_m": round(float(snap_d[ok].max()), 2),
        "snap_median_m": round(float(np.median(snap_d[ok])), 2),
        "snap_over_cap": int((~ok).sum()),
        "sites": len(sites),
        "seed_polylines": len(seeds),
        "reached_polylines": len(reach),
        "edges": len(edges),
        "edges_with_2plus_sensors": sum(1 for e in edges if e["sensors"] >= 2),
        "graph_largest_component_pct": _component_pct(adj, len(R["start"])),
    }

    art = {
        "version": 1,
        "week_start": week_start.isoformat(),
        "hours": WEEK_HOURS,
        "confirmed_hours": confirmed,
        "series": list(EDGE_SERIES),
        "n_edges": len(edges),
        "n_sites": len(sites),
        "dev_clamp_pct": DEV_CLAMP_PCT,
        "method": {
            "snap_cap_m": SNAP_CAP_M,
            "join_tolerance_m": JOIN_TOLERANCE_M,
            "budget_m": BUDGET_M,
            "cross_road_penalty_m": CROSS_ROAD_PENALTY_M,
            "grouping": "one edge = one RAMM road id (ramm_road_id), named by ramm_alias",
            "geometry_source": "WCC roads.geojson road centrelines",
            "inference": ("An edge's numbers are INFERRED: a sensor's reading is "
                          "spread along the street it sits on, decaying to zero at "
                          f"{BUDGET_M:.0f} m. It is not a measurement of that whole "
                          "stretch of street, and it is not established cause."),
            "unjudged_rule": ("Fewer than 2 contributing sensors means one camera is "
                              "speaking for the whole edge. Rank it, grey it, do not "
                              "call an anomaly on it."),
            "forecast": ("Same-weekday same-hour median per camera site over the pool "
                         "ending the day before the week started, x the citywide trend "
                         "factor. Out of sample for every hour in the week."),
        },
        "measured": report,
        "edges": edges,
    }
    return art, report


# --------------------------------------------------------------- helpers ----
def _poly(R: dict, i: int) -> list[list[float]]:
    s, c = R["start"][i], R["count"][i]
    # 5 dp is ~1 m at this latitude; the source carries 14, which is 2 MB of
    # nanometres for a street.
    return [[round(float(lo), 5), round(float(la), 5)]
            for lo, la in zip(R["lon"][s:s + c], R["lat"][s:s + c])]


def _kind(name: str) -> str:
    n = (name or "").lower()
    if "cycle" in n:
        return "cycleway"
    if "path" in n or "walkway" in n or "crossing" in n:
        return "footpath"
    return "road"


def _dominant(kinds: list[str]) -> str:
    """Most common sensor kind, ties broken deterministically.

    `max(set(...))` iterates a set of strings, whose order moves with the hash
    seed — the same edge came out "road" on one run and "footpath" on the next.
    An artefact that changes between identical builds is not an artefact.
    """
    if not kinds:
        return "road"
    return max(sorted(set(kinds)), key=kinds.count)


def _ints(a: np.ndarray) -> list[int]:
    return [int(round(v)) for v in np.nan_to_num(a)]


def _nullable(a: np.ndarray) -> list[int | None]:
    return [None if np.isnan(v) else int(round(v)) for v in a]


def _dev(actual: np.ndarray, forecast: np.ndarray) -> list[int | None]:
    """Signed percent, null wherever there is no actual OR no usable forecast.

    A forecast under the per-hour floor cannot carry a ratio — 1 expected
    pedestrian against 4 observed is +300% and means nothing.
    """
    out: list[int | None] = []
    for a, f in zip(actual, forecast):
        if np.isnan(a) or f < P.expected_floor_per_hour:
            out.append(None)
        else:
            out.append(int(round(float(np.clip((a - f) / f * 100,
                                               -DEV_CLAMP_PCT, DEV_CLAMP_PCT)))))
    return out


def _day_rollup(act: np.ndarray, fc: np.ndarray, confirmed: int) -> list[dict]:
    days = []
    for di in range(7):
        s, e = di * HOURS, (di + 1) * HOURS
        n = int(np.clip(confirmed - s, 0, HOURS))
        f_all = fc[s:e].sum(axis=0)
        f_sf = fc[s:s + n].sum(axis=0)
        a_sf = act[s:s + n].sum(axis=0) if n else None
        days.append({
            "confirmed_hours": n,
            "forecast": {k: int(round(f_all[i])) for i, k in enumerate(EDGE_SERIES)},
            "actual": ({k: int(round(a_sf[i])) for i, k in enumerate(EDGE_SERIES)}
                       if a_sf is not None else None),
            "dev_pct": ({k: (int(round(np.clip((a_sf[i] - f_sf[i]) / f_sf[i] * 100,
                                               -DEV_CLAMP_PCT, DEV_CLAMP_PCT)))
                             if f_sf[i] >= P.expected_floor_per_hour * max(n, 1) else None)
                         for i, k in enumerate(EDGE_SERIES)}
                        if a_sf is not None else None),
        })
    return days


def _component_pct(adj: dict[int, list[int]], n: int) -> float:
    """Largest connected component as a percentage of polylines. Reported so the
    1 m vertex-join rule is defended by a number, not a claim."""
    seen: set[int] = set()
    best = 0
    for start in range(n):
        if start in seen:
            continue
        stack, size = [start], 0
        seen.add(start)
        while stack:
            node = stack.pop()
            size += 1
            for nb in adj.get(node, ()):
                if nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        best = max(best, size)
    return round(best / n * 100, 1)
