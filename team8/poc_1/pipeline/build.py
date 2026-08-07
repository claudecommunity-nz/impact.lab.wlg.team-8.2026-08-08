"""Poneke Pulse pipeline entrypoint.

    uv run python -m team8.poc_1.pipeline.build

Reads the parquet on disk, emits static JSON/GeoJSON into
`team8/poc_1/web/public/data/`. The frontend loads these files directly — there
is no server and no API in the critical path.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from . import checks, config, context, days, index, vitals
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
    latest, = con.execute(
        f"select max(countline_date) from '{config.HOURLY_RECENT}'").fetchone()
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
