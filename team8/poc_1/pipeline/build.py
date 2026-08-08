"""Poneke Pulse pipeline entrypoint.

    uv run python -m team8.poc_1.pipeline.build

Reads the parquet on disk, emits static JSON/GeoJSON into
`team8/poc_1/web/public/data/`. The frontend loads these files directly — there
is no server and no API in the critical path.
"""

from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb

from . import (advise, checks, config, context, days, edges, feeds, index,
               vitals, week as week_mod)
from .daycal import build_calendar
from .diagnose import DIAGNOSES

OUT = config.OUT


def _write(path: Path, obj: dict | list) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    # separators: no gratuitous whitespace — these are machine-read arrays of
    # ~9k ints and pretty-printing them doubles the payload for nobody's benefit.
    path.write_text(json.dumps(obj, separators=(",", ":")))
    return path.stat().st_size


def _kb(n: int) -> str:
    return f"{n / 1024:,.0f} KB"


GEOJSON_PRECISION = 5  # ~1 m at this latitude


def _round_coords(node):
    """Round every coordinate in a GeoJSON geometry tree.

    The only transform applied to the context layers. Source files carry up to
    15 significant figures, which is nanometre precision on a hazard polygon —
    2.8 MB of it for the tsunami zones alone. Recorded in the manifest so the
    change is declared rather than silent.
    """
    if isinstance(node, list):
        if node and all(isinstance(v, (int, float)) for v in node):
            return [round(float(v), GEOJSON_PRECISION) for v in node]
        return [_round_coords(v) for v in node]
    if isinstance(node, dict):
        return {k: _round_coords(v) for k, v in node.items()}
    return node


def main() -> None:
    t0 = time.time()
    con = duckdb.connect()
    written: list[tuple[str, int]] = []

    print("Poneke Pulse — building static artefacts")
    print(f"  source: {config.MOVEMENT}")
    print(f"  output: {OUT}")

    # --- calendars, one per source parquet ---------------------------------
    calendars = {src: build_calendar(con, src)
                 for src in {s for _, s, _, _ in config.SHIPPED_DAYS}}

    print("\nDrift assertions")
    for line in checks.run(con, calendars[config.HOURLY_2025]):
        print(line)

    # --- countline index ---------------------------------------------------
    seen: set[str] = set()
    for d, src, _, _ in config.SHIPPED_DAYS:
        seen |= set(index.ids_present(con, src, [d]))
    cidx = index.build(con, seen)
    written.append(("data/countlines.json",
                    _write(OUT / "countlines.json", cidx.to_json())))
    print(f"\nCountline index: {len(cidx.ids)} lines "
          f"({len(cidx.dropped)} seen in the feed with no meta row, excluded)")

    # --- per-day artefacts -------------------------------------------------
    manifest_days = []
    print("\nDays")
    for d, src, role, label in config.SHIPPED_DAYS:
        cal = calendars[src]
        day = days.build_day(con, src, d, cal, cidx, role)
        checks.check_day(day)
        size = _write(OUT / "day" / f"{d}.json", day)
        written.append((f"data/day/{d}.json", size))

        ctx = context.build(d, cal.holidays.get(d))
        csize = _write(OUT / "context" / f"{d}.json", ctx)
        written.append((f"data/context/{d}.json", csize))

        s = day["summary"]
        print(f"  {d} {day['weekday'][:3]} [{day['verdict']:8}] "
              f"n={day['n']:3} baseline={len(day['baseline']['dates']):2}d "
              f"obs={s['citywide_obs']:>9,} exp={s['citywide_exp']:>9,} "
              f"delta={s['citywide_delta_pct']}% "
              f"cells={day['coverage']['cell_presence_pct']}% ({_kb(size)})")
        print(f"       {s['headline']}")
        if day["refusal"]:
            print(f"       REFUSED: naive detector would have reported "
                  f"{day['refusal']['naive_delta_pct']}%")
        nc = s["neighbour_check"]
        if nc["peers"]:
            print(f"       raw vs neighbours {nc['peers']}: {nc['delta_pct']}% "
                  f"({nc['raw_obs']:,} vs {nc['peer_totals']})")
        nz = {k: v for k, v in s["diagnosis_counts"].items() if v}
        print(f"       {nz}")
        if s["worst"]:
            print(f"       worst:  " + ", ".join(
                f"{cidx.rows[cidx.ids[ci]]['name']} "
                f"{next(l['delta_pct'] for l in day['lines'] if l['ci'] == ci):+.0f}%"
                for ci in s["worst"][:4]))
            print(f"       risers: " + ", ".join(
                f"{cidx.rows[cidx.ids[ci]]['name']} "
                f"{next(l['delta_pct'] for l in day['lines'] if l['ci'] == ci):+.0f}%"
                for ci in s["risers"][:4]))

        manifest_days.append({
            "date": d, "weekday": day["weekday"], "role": role, "label": label,
            "verdict": day["verdict"], "file": f"data/day/{d}.json",
            "context_file": f"data/context/{d}.json",
            "n": day["n"],
            "citywide_delta_pct": day["summary"]["citywide_delta_pct"],
        })

    # --- vitals ------------------------------------------------------------
    print("\nVitals")
    manifest_vitals = []
    for stem, src, start, end in config.VITALS_WINDOWS:
        v = vitals.build(con, src, calendars[src], start, end)
        size = _write(OUT / "vitals" / f"{stem}.json", v)
        written.append((f"data/vitals/{stem}.json", size))
        gaps = sum(1 for f in v["flags"] if f == 1)
        print(f"  {stem}: {start} -> {end}, {v['hours']} hours, "
              f"{gaps} flagged as gaps ({_kb(size)})")
        manifest_vitals.append({"file": f"data/vitals/{stem}.json",
                                "start": start, "end": end, "hours": v["hours"]})

    # --- the week artefact -------------------------------------------------
    # The Monday of the newest data through the following Sunday: four settled
    # days and three modelled ones, which is the situation the product models.
    newest, = con.execute(
        f"select cast(max(countline_date) as varchar) from '{config.HOURLY_RECENT}'"
    ).fetchone()
    nd = date.fromisoformat(newest)
    ws = nd - timedelta(days=nd.weekday())
    adv, standing = advise.closures(ws, ws + timedelta(days=6))
    standing += advise.sensor_conditions(con, config.HOURLY_RECENT, ws, nd)
    wk = week_mod.build(con, config.HOURLY_RECENT, calendars[config.HOURLY_RECENT],
                        newest, adv, standing)
    checks.check_week(wk)
    written.append(("data/week.json", _write(OUT / "week.json", wk)))

    print(f"\nWeek {wk['label']}  ({wk['week_start']} -> {wk['week_end']})")
    print(f"  {wk['confirmed_hours']} of 168 hours confirmed, "
          f"newest confirmed hour {wk['horizon']['last_confirmed_hour']}")
    print(f"  trend factor {wk['model']['trend_factor']}, "
          f"{wk['model']['events_applied']} named event(s) applied to the forecast")
    print("  derived day factors (published, NOT applied — the baseline is "
          "already same-weekday):")
    for name, f in wk["day_factors"]["factor"].items():
        print(f"      {name:<10} {f}  (n={wk['day_factors']['n_days'][name]})")
    for d in wk["days"]:
        dev = d["deviation_pct"]["total"] if d["deviation_pct"] else None
        print(f"    {d['short']:<7} {d['state']:<9} pool={d['baseline_n']:2}d "
              f"fcst={d['forecast']['total']:>9,} "
              f"actual={d['actual']['total'] if d['actual'] else '-':>9} "
              f"dev={dev if dev is not None else '-':>6}%")
    print(f"  week to date: {wk['week']['actual_to_date']['total']:,} actual vs "
          f"{wk['week']['forecast_to_date']['total']:,} forecast "
          f"({wk['week']['deviation_pct']['total']:+}%)")
    print(f"  advisements: {len(adv)} · standing conditions: {len(standing)}")

    # --- the edge network --------------------------------------------------
    eg, rep = edges.build(con, config.HOURLY_RECENT, calendars[config.HOURLY_RECENT],
                          newest, wk["model"]["trend_factor"], wk["confirmed_hours"])
    checks.check_edges(eg)
    written.append(("data/edges.json", _write(OUT / "edges.json", eg)))
    print("\nEdge network")
    print(f"  roads: {rep['roads_polylines']:,} polylines, "
          f"{rep['roads_vertices']:,} vertices; largest component "
          f"{rep['graph_largest_component_pct']}% at {edges.JOIN_TOLERANCE_M} m vertex join")
    print(f"  snap: {rep['countlines_snapped']}/{rep['countlines_total']} countlines "
          f"within {edges.SNAP_CAP_M} m — max {rep['snap_max_m']} m, "
          f"median {rep['snap_median_m']} m, {rep['snap_over_cap']} over cap")
    print(f"  {rep['sites']} camera sites -> {rep['seed_polylines']} seed polylines -> "
          f"{rep['reached_polylines']} polylines reached at {edges.BUDGET_M:.0f} m")
    print(f"  {rep['edges']} named edges, "
          f"{rep['edges_with_2plus_sensors']} with 2+ contributing sensors "
          f"({rep['edges'] - rep['edges_with_2plus_sensors']} unjudged)")
    top = [e for e in eg["edges"] if e["sensors"] >= 2][:5]
    for e in top:
        d = e["day"][max(0, (wk["confirmed_hours"] - 1) // 24)]["dev_pct"]
        print(f"    {e['name'][:34]:<34} {e['type']:<9} {e['sensors']}s "
              f"{e['flow_per_hour']:>6}/hr  today {d['total'] if d else '-'}%")

    # --- pluggable feeds and the area-risk read ----------------------------
    # Runs after edges because the join cites STREET NAMES as its evidence, and
    # those only exist once the sensors have been projected onto the network.
    ffiles, frep = feeds.build(con, config.HOURLY_RECENT,
                               calendars[config.HOURLY_RECENT], newest,
                               wk["model"]["trend_factor"], wk["confirmed_hours"], eg)
    for rel, obj in ffiles.items():
        written.append((f"data/{rel}", _write(OUT / rel, obj)))

    print(f"\nFeeds  ({frep['feeds_connected']} of {frep['feeds']} connected, "
          f"{frep['items']} advisement(s) this week)")
    for f in frep["feed_meta"]:
        print(f"  {f['id']:<24} {f['status']:<12} {f['items']} item(s)"
              + (f"  — {f['empty_reason'][:64]}" if f["empty_reason"] else ""))
    print(f"\nRisk areas  ({frep['areas']} areas, {frep['areas_judged']} with "
          f"{feeds.AREA_MIN_SITES}+ cameras, {frep['areas_unwatched']} unwatched)")
    for a in frep["area_rows"]:
        d = a["dev"]["total"][wk["confirmed_hours"] - 1] if a["dev"] else None
        print(f"  {a['class']:<22} {a['name'][:30]:<30} {a['sites']:>3} cameras "
              f"{a['n_streets']:>3} streets  newest hour "
              f"{('+' if d and d > 0 else '') + str(d) + '%' if d is not None else '—':>6}"
              + ("" if a["judged"] else "   UNJUDGED"))

    # --- GIS context layers ------------------------------------------------
    print("\nGIS context layers (reference geography, never scored)")
    gis = []
    for layer_id, publisher, licence in config.GIS_LAYERS:
        raw = json.loads((config.GIS_RAW / f"{layer_id}.geojson").read_text())
        size = _write(OUT / "gis" / f"{layer_id}.geojson", _round_coords(raw))
        written.append((f"data/gis/{layer_id}.geojson", size))
        gis.append({"id": layer_id, "file": f"data/gis/{layer_id}.geojson",
                    "publisher": publisher, "licence_note": licence,
                    "features": len(raw.get("features", [])),
                    "transform": f"coordinates rounded to {GEOJSON_PRECISION} dp; "
                                 "geometry and properties otherwise unchanged"})
        print(f"  {layer_id:32} {_kb(size):>10}  {publisher}")

    # --- manifest ----------------------------------------------------------
    latest = nd
    # The one coverage number the whole interface quotes, counted rather than
    # typed. Four copies of "386 sensors" survived a correction because each was
    # a literal; this is the source all of them now read.
    network = {
        "camera_sites": len({cidx.rows[c]["viewpoint"] for c in cidx.ids}),
        "countlines": len(cidx.ids),
        "note": ("Camera sites are the vendor's viewpoint_id — one physical camera, "
                 "a median of 3 countlines each. A day file covers only the sites "
                 "that reported on that day, which is fewer."),
    }
    disclaimers = {
        k: (v.format(sites=network["camera_sites"]) if "{sites}" in v else v)
        for k, v in config.DISCLAIMERS.items()
    }
    manifest = {
        "version": 1,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_vintage": {"movement_latest_date": latest.isoformat(), "feed_lag": "T+1"},
        "network": network,
        "baseline_params": config.PARAMS.manifest_dict(),
        "diagnoses": list(DIAGNOSES),
        "days": manifest_days,
        "vitals": manifest_vitals,
        "week": {
            "file": "data/week.json",
            "week_start": wk["week_start"], "week_end": wk["week_end"],
            "label": wk["label"], "hours": wk["hours"],
            "confirmed_hours": wk["confirmed_hours"],
            "series": wk["series"],
        },
        "edges": {
            "file": "data/edges.json",
            "n_edges": eg["n_edges"], "n_sites": eg["n_sites"],
            "series": eg["series"], "measured": eg["measured"],
            "note": ("Camera sites projected onto WCC road centrelines. Edge "
                     "numbers are inferred from up to 4 sensors and are not a "
                     "measurement of the whole stretch."),
        },
        "feeds": {
            "file": "data/feeds/index.json",
            "advisement_feeds": frep["feeds"],
            "connected": frep["feeds_connected"],
            "items": frep["items"],
            "area_risk_file": "data/feeds/area-risk.json",
            "areas": frep["areas"], "areas_judged": frep["areas_judged"],
            "note": ("Advisement and risk-area feeds are modular adapters. None of "
                     "them moves the forecast; they are listed so a deviation can "
                     "be explained by a human, not explained away by the model."),
        },
        "countlines_file": "data/countlines.json",
        "gis_layers": gis,
        "gis_layers_omitted": config.GIS_OMITTED,
        "disclaimers": disclaimers,
        "attribution": config.ATTRIBUTION,
    }
    written.append(("data/manifest.json", _write(OUT / "manifest.json", manifest)))

    # --- report ------------------------------------------------------------
    total = sum(s for _, s in written)
    print("\nArtefacts")
    for name, size in sorted(written, key=lambda x: -x[1]):
        print(f"  {size:>9,}  {name}")
    print(f"  {total:>9,}  TOTAL ({total / 1024 / 1024:.2f} MB)")
    assert total < 6 * 1024 * 1024, f"payload {total} exceeds the 6 MB ceiling"
    print(f"\nAll assertions passed in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
