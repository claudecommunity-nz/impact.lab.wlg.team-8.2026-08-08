"""Inventory every data source we can reach, with its schema.

This is the scoping deliverable: one JSON record per source describing what it is, who
publishes it, how big it is, and exactly what columns/fields it has — so nobody has to
guess a column name tomorrow.

Built offline where possible. The vendored `probe-results.json` and `samples/` come from
the upstream catalogue repo's own live probe, so we only hit the network for what they
don't cover.

Run: `just inventory`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
VENDOR = Path(__file__).parent / "vendor"
OUT = ROOT / "data" / "catalogue"
sys.path.insert(0, str(VENDOR))

import wcc_gis  # noqa: E402

ESRI_TYPE = {
    "esriFieldTypeOID": "oid",
    "esriFieldTypeInteger": "int",
    "esriFieldTypeSmallInteger": "smallint",
    "esriFieldTypeDouble": "double",
    "esriFieldTypeSingle": "float",
    "esriFieldTypeString": "string",
    "esriFieldTypeDate": "date",
    "esriFieldTypeGeometry": "geometry",
    "esriFieldTypeGlobalID": "globalid",
    "esriFieldTypeGUID": "guid",
    "esriFieldTypeBlob": "blob",
}
GEOM = {
    "esriGeometryPoint": "point",
    "esriGeometryPolyline": "polyline",
    "esriGeometryPolygon": "polygon",
    "esriGeometryMultipoint": "multipoint",
}


def _probe_index() -> dict[str, dict]:
    p = VENDOR / "probe-results.json"
    if not p.exists():
        return {}
    return {r["id"]: r for r in json.loads(p.read_text()).get("results", [])}


def _sample_fields(dataset_id: str) -> list[dict] | None:
    """Typed field list from the upstream probe's saved layer JSON."""
    p = VENDOR / "samples" / f"{dataset_id}.json"
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text())
    except json.JSONDecodeError:
        return None
    fields = d.get("fields")
    if not fields:
        return None
    return [
        {"name": f.get("name"), "type": ESRI_TYPE.get(f.get("type"), f.get("type")),
         "alias": f.get("alias")}
        for f in fields
    ]


def gis_sources() -> list[dict]:
    probes = _probe_index()
    out = []
    for ds in wcc_gis.datasets():
        did = ds["id"]
        pr = probes.get(did, {})
        fields = _sample_fields(did)
        if fields is None and pr.get("fields"):
            # names only — better than nothing, mark the type as unknown
            fields = [{"name": n, "type": None, "alias": None} for n in pr["fields"]]

        raster = bool(ds.get("raster")) or pr.get("layer_type") == "Raster Layer"
        rec = {
            "source_id": did,
            "group": "gis",
            "title": ds.get("display_name") or ds.get("name"),
            "publisher": ds.get("prepared_by"),
            "scope": ds.get("scope"),
            "theme": ds.get("theme"),
            "url": pr.get("url") or ds.get("url"),
            "layer_name": pr.get("layer_name"),
            "layer_type": pr.get("layer_type"),
            "geometry": GEOM.get(pr.get("geometry_type"), pr.get("geometry_type")),
            "raster": raster,
            "queryable": bool(fields) and not raster,
            "max_record_count": pr.get("max_record_count"),
            "native_wkid": pr.get("wkid"),
            "feature_count": ds.get("feature_count") or pr.get("feature_count"),
            "field_count": len(fields) if fields else (pr.get("field_count") or 0),
            "fields": fields or [],
            "probe_status": pr.get("status"),
            "downloaded": None,   # filled in below
            "notes": [],
        }
        if raster:
            rec["notes"].append(
                "Raster — advertises Query but refuses it. Use wcc_gis.image_url() for "
                "a PNG."
            )
        if not fields and not raster:
            rec["notes"].append(
                "No field list: this id addresses a whole service or a group layer, so "
                "it needs an explicit layer= before it can be queried."
            )
            rec["needs_layer"] = True
        out.append(rec)
    return out


def movement_sources() -> list[dict]:
    con = duckdb.connect()
    mv = ROOT / "data" / "raw" / "movement"
    out = []
    for p in sorted(mv.glob("*.parquet")):
        rel = p.relative_to(ROOT).as_posix()
        cols = con.execute(f"describe select * from '{p}'").fetchall()
        n = con.execute(f"select count(*) from '{p}'").fetchone()[0]

        fields = []
        for name, dtype, *_ in cols:
            nulls = con.execute(
                f'select count(*) - count("{name}") from \'{p}\''
            ).fetchone()[0]
            distinct = con.execute(
                f'select count(distinct "{name}") from \'{p}\''
            ).fetchone()[0]
            f = {"name": name, "type": dtype,
                 "null_count": int(nulls), "distinct": int(distinct)}
            if distinct <= 12:
                vals = con.execute(
                    f'select distinct "{name}" from \'{p}\' order by 1'
                ).fetchall()
                f["values"] = [str(v[0]) for v in vals]
            fields.append(f)

        date_col = next((c[0] for c in cols if c[1] == "DATE"), None)
        rng = None
        if date_col:
            lo, hi = con.execute(
                f'select min("{date_col}"), max("{date_col}") from \'{p}\''
            ).fetchone()
            rng = [str(lo), str(hi)]

        out.append({
            "source_id": p.stem,
            "group": "movement",
            "title": f"Countline movement — {p.stem}",
            "publisher": "Wellington City Council / VivaCity",
            "url": "https://wellington-newzealand.opendatasoft.com/api/explore/v2.1"
                   "/catalog/datasets",
            "path": rel,
            "rows": int(n),
            "field_count": len(fields),
            "fields": fields,
            "date_range": rng,
            "downloaded": True,
            "notes": [
                "T+1 feed — the newest row is always yesterday.",
                "Missing rows are NOT zeros: a (countline, direction, hour) cell is "
                "omitted entirely when there was no activity.",
            ],
        })
    return out


def context_sources() -> list[dict]:
    ctx = ROOT / "data" / "raw" / "context"
    out = []
    for p in sorted(ctx.glob("*.json")) + sorted(ctx.glob("*.geojson")):
        try:
            d = json.loads(p.read_text())
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict) and d.get("type") == "FeatureCollection":
            feats = d.get("features", [])
            keys = sorted({k for f in feats[:50] for k in f.get("properties", {})})
            n = len(feats)
        elif isinstance(d, list):
            keys = sorted({k for r in d[:50] for k in r})
            n = len(d)
        else:
            keys = sorted(d)
            n = len(d.get("warnings", [])) if "warnings" in d else 1
        out.append({
            "source_id": p.stem,
            "group": "context",
            "title": p.stem.replace("_", " "),
            "path": p.relative_to(ROOT).as_posix(),
            "rows": n,
            "field_count": len(keys),
            "fields": [{"name": k, "type": None} for k in keys],
            "downloaded": True,
            "notes": (["HAND-ENTERED, not an automated feed."]
                      if "manual" in p.stem else []),
        })
    return out


def probe_live(records: list[dict]) -> None:
    """Fill gaps the vendored probe left, one service at a time.

    Only for non-raster datasets with no field list. Group/service ids get their child
    layers enumerated instead, since they cannot be queried without a `layer=`.
    """
    todo = [r for r in records if not r["fields"] and not r["raster"]]
    if not todo:
        return
    print(f"  probing {len(todo)} datasets live (serial, be patient)…")
    for r in todo:
        did = r["source_id"]
        try:
            subs = wcc_gis.sublayers(did)
        except wcc_gis.GisError:
            subs = []
        if subs:
            r["sublayers"] = [{"id": s.get("id"), "name": s.get("name"),
                               "type": s.get("type")} for s in subs]
            r["needs_layer"] = True
            r["notes"].append(
                "Addresses a service/group: pick one of `sublayers` as layer=."
            )
        try:
            info = wcc_gis.info(did)
            flds = info.get("fields") or []
            if flds:
                r["fields"] = [{"name": f, "type": None, "alias": None} for f in flds]
                r["queryable"] = True
                r["layer_resolved"] = info.get("layer")
                r["geometry"] = GEOM.get(info.get("geometry_type"),
                                         info.get("geometry_type")) or r["geometry"]
            if info.get("type") == "Raster Layer":
                r["raster"] = True
                r["queryable"] = False
        except wcc_gis.GisError as e:
            r["probe_error"] = str(e)[:180]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    have = {p.stem for p in (ROOT / "data" / "raw" / "gis").glob("*.geojson")}

    gis = gis_sources()
    probe_live(gis)
    for r in gis:
        r["downloaded"] = r["source_id"] in have

    records = gis + movement_sources() + context_sources()
    (OUT / "sources.json").write_text(json.dumps(records, indent=2))

    n_fields = sum(1 for r in records if r["fields"])
    print(f"  → data/catalogue/sources.json  {len(records)} sources")
    print(f"    gis={len(gis)} movement={len(movement_sources())} "
          f"context={len(context_sources())}")
    print(f"    with a field list: {n_fields}/{len(records)}")
    print(f"    gis downloaded:    {sum(1 for r in gis if r['downloaded'])}/{len(gis)}")
    missing = [r["source_id"] for r in records if not r["fields"]]
    if missing:
        print(f"    no fields yet ({len(missing)}): {', '.join(missing[:8])}"
              f"{' …' if len(missing) > 8 else ''}")


if __name__ == "__main__":
    main()
