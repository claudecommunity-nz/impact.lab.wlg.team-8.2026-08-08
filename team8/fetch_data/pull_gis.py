"""Pull the GIS layers we actually join against, as GeoJSON in EPSG:4326.

Deliberately not all 74. Each layer here earns its place; the notes say why, and where
a layer looked useful but isn't, the note says that too so nobody re-litigates it at 11am.

Run: `just pull-gis`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "vendor"))

import wcc_gis  # noqa: E402  (vendored, single-file, stdlib-only)

RAW = Path(__file__).resolve().parents[2] / "data" / "raw" / "gis"
ROOT_CAT = Path(__file__).resolve().parents[2] / "data" / "catalogue"

WGN = wcc_gis.WELLINGTON  # (w, s, e, n)

# (filename, dataset, kwargs, note)
LAYERS: list[tuple[str, str, dict, str]] = [
    # --- geometry we attach names and context to -------------------------------
    (
        "roads",
        "roads",
        {},
        "5,017 polylines. `location` gives a street name and `category`/`ONRC` a road "
        "class. This is how a countline gets a human-readable label — there is no "
        "attribute join, only nearest-line.",
    ),
    (
        "transport-sensors",
        "transport-sensors",
        {"layer": 0},
        "408 sensor cut-lines, WCC's own copy of the countline geometry. Only carries "
        "COUNTLINE_ID and Status; the movement feed's meta is richer.",
    ),
    # --- corroborators: time-varying, the real ones -----------------------------
    (
        "metservice-warnings",
        "metservice-warnings",
        {},
        "LIVE CAP weather warnings. Current state only — 5 rows, no archive. Usable for "
        "the live path; the 23 Oct 2025 replay must use a hand-entered warning.",
    ),
    (
        "nzta-warnings-road-events",
        "nzta-warnings",
        {"layer": 0},
        "LIVE state-highway road events (closures, incidents). Current state only.",
    ),
    (
        "nema-cap-alerts",
        "nema-cap-alerts",
        {},
        "NEMA emergency mobile alerts. 108 rows spanning Jan 2025 - Jul 2026, so it does "
        "cover the replay period — but zero alerts in Oct 2025, because an EMA is only "
        "issued for life-threatening events and a red wind warning is not one.",
    ),
    (
        "electricity-outages",
        "electricity-outages",
        {},
        "LIVE national electricity outages. Current state only.",
    ),
    (
        "water-network-faults",
        "water-network-faults",
        {},
        "LIVE Wellington Water faults, 1,509 points. Current state only.",
    ),
    # --- static context, used carefully ----------------------------------------
    (
        "tsunami-evacuation-zones",
        "tsunami-evacuation-zones",
        {},
        "19 polygons. Zone_Class 1/2/3 = red/orange/yellow, 1 = closest to shore. "
        "Filter LA='Wellington City Council' — 6 polygons are Porirua/Hutt. "
        "NB only ~15 countlines actually cross a zone boundary, so egress-flow "
        "statistics per zone are n<=3. Kept for context shading, not for statistics.",
    ),
    (
        "community-emergency-hubs",
        "community-emergency-hubs",
        {"where": "TA_NAME='Wellington City'"},
        "WREMO hubs. X/Y columns are NZTM metres, not lat/lng — use lat/lng.",
    ),
    (
        "emergency-routes",
        "emergency-routes",
        {},
        "429 post-quake route segments. WARNING: wccReopStg has only TWO values (1 and "
        "11), not a 1..N priority ranking, and there are no road names. Any 'priority "
        "route N' framing is not supported by this layer.",
    ),
]


PAGE = 1000  # mapping.gw.govt.nz and Flood_Hazards_Areas cap at 1000, not 2000


def pull(fname: str, dataset: str, kwargs: dict, note: str) -> None:
    """Page through a layer keeping geometry, and fail loudly rather than truncate."""
    dest = RAW / f"{fname}.geojson"
    if dest.exists():
        print(f"  = {fname} present")
        return

    feats: list = []
    offset = 0
    try:
        while True:
            fc = wcc_gis.query(dataset, limit=PAGE, offset=offset, **kwargs)
            page = fc.get("features", [])
            feats.extend(page)
            # Advance by rows actually received — servers silently shrink page size.
            if not fc.get("truncated") or not page:
                break
            offset += len(page)
    except wcc_gis.GisError as e:
        # mapping.gw.govt.nz / mapping1.gw.govt.nz serve an incomplete TLS chain that
        # urllib rejects but requests+certifi accepts. Retry there rather than lose it.
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            try:
                url = wcc_gis.layer_url(dataset, kwargs.get("layer"))
            except wcc_gis.GisError:
                print(f"  ! {fname}: {str(e)[:90]}")
                return
            params = {"where": kwargs.get("where", "1=1")}
            if kwargs.get("extra"):
                params.update(kwargs["extra"])
            print(f"  ~ {fname}: TLS chain rejected, retrying via certifi")
            pull_direct(fname, url, params, "")
            return
        print(f"  ! {fname}: {e}")
        return

    dest.write_text(
        json.dumps({"type": "FeatureCollection", "features": feats})
    )
    print(f"  → {fname}.geojson  {len(feats)} features")


# Layers wcc_gis can't reach: one is not in the catalogue at all, the other sits on a
# host whose TLS chain urllib rejects but certifi accepts.
DIRECT: list[tuple[str, str, dict, str]] = [
    (
        "street-events-road-closures",
        "https://gis.wcc.govt.nz/arcgis/rest/services/Transportation/"
        "StreetEventsAndRoadClosures/MapServer/1",
        {"where": "1=1"},
        "NOT in the 74-dataset catalogue and not surfaced on the open data portal — "
        "found by walking the ArcGIS service directory. Only 60 records back to Feb "
        "2021, so it is a sparse events/closures register, NOT a complete closure log. "
        "Do not claim coverage. Fields: Event_Name, Start_Date, End_Date, EventType, "
        "Approved, EventDetails.",
    ),
    (
        "community-emergency-hubs",
        "https://mapping.gw.govt.nz/arcgis/rest/services/GW/Emergencies_P/MapServer/2",
        {"where": "TA_NAME='Wellington City'"},
        "WREMO hubs. mapping.gw.govt.nz serves an incomplete TLS chain — urllib "
        "rejects it, requests+certifi accepts it. X/Y columns are NZTM metres.",
    ),
]


def pull_direct(fname: str, url: str, params: dict, note: str) -> None:
    import requests

    dest = RAW / f"{fname}.geojson"
    if dest.exists():
        print(f"  = {fname} present")
        return
    feats: list = []
    offset = 0
    while True:
        r = requests.get(
            f"{url}/query",
            params={
                "outFields": "*", "outSR": 4326, "f": "geojson",
                "resultRecordCount": PAGE, "resultOffset": offset, **params,
            },
            timeout=120,
        )
        r.raise_for_status()
        fc = r.json()
        page = fc.get("features", [])
        feats.extend(page)
        # ArcGIS Server puts the flag at the top level; ArcGIS Online nests it under
        # `properties`. Checking only one silently truncates at the page cap.
        more = (fc.get("exceededTransferLimit")
                or fc.get("properties", {}).get("exceededTransferLimit"))
        if not more or not page:
            break
        offset += len(page)
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"  → {fname}.geojson  {len(feats)} features")


# Everything else the inventory says is a directly-queryable single vector layer.
# Pulled without hand-written notes — the inventory already documents their schemas.
# tree-cover (160k polygons) is excluded: it is 100 MB of foliage and answers no
# question we have.
BULK_SKIP = {"tree-cover"}

#: Metres of allowable geometry offset for the bulk pull. These are hazard-modelling
#: polygons digitised at sub-metre precision — ponding-areas at full fidelity is 161 MB,
#: which exceeds GitHub's per-file limit and would choke a browser. 5 m is
#: indistinguishable at city zoom and cuts them by one to two orders of magnitude.
#: The named layers above are pulled at FULL fidelity; only the bulk set is generalised.
BULK_OFFSET_M = 5


def pull_rest() -> list[str]:
    """Pull the remaining queryable vector layers named by the inventory.

    Geometry is generalised — see BULK_OFFSET_M. Attributes are untouched.
    """
    cat = ROOT_CAT / "sources.json"
    if not cat.exists():
        print("  ! no inventory yet — run `just inventory` first")
        return []
    done = {n for n, *_ in LAYERS} | {n for n, *_ in DIRECT}
    ids = [
        r["source_id"] for r in json.loads(cat.read_text())
        if r["group"] == "gis" and r["fields"] and not r["raster"]
        and not r.get("needs_layer") and r["source_id"] not in done
        and r["source_id"] not in BULK_SKIP
    ]
    for did in ids:
        pull(did, did, {"extra": {"maxAllowableOffset": BULK_OFFSET_M}}, "")
    return ids


def raster_thumbnails() -> int:
    """Rasters refuse queries, so grab a PNG each so the dashboard can still show them."""
    import urllib.request

    dest = RAW.parent / "gis_rasters"
    dest.mkdir(parents=True, exist_ok=True)
    cat = json.loads((ROOT_CAT / "sources.json").read_text())
    n = 0
    for r in cat:
        if r["group"] != "gis" or not r["raster"]:
            continue
        p = dest / f"{r['source_id']}.png"
        if p.exists():
            n += 1
            continue
        try:
            url = wcc_gis.image_url(r["source_id"], size=(640, 420))
            urllib.request.urlretrieve(url, p)
            n += 1
        except Exception as e:  # noqa: BLE001 — a missing thumbnail is not fatal
            print(f"  ! raster {r['source_id']}: {str(e)[:70]}")
    print(f"  → {n} raster thumbnails in data/raw/gis_rasters/")
    return n


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    notes = {}
    for fname, dataset, kwargs, note in LAYERS:
        pull(fname, dataset, kwargs, note)
        notes[fname] = {"dataset": dataset, "query": kwargs, "note": note,
                        "publisher": wcc_gis.get(dataset).get("prepared_by")}
    for fname, url, params, note in DIRECT:
        pull_direct(fname, url, params, note)
        notes[fname] = {"url": url, "query": params, "note": note}
    for did in pull_rest():
        notes[did] = {"dataset": did, "note": "see data/catalogue/sources.json"}
    (RAW / "_layers.json").write_text(json.dumps(notes, indent=2))
    print(f"\nwrote _layers.json ({len(notes)} layers documented)")
    raster_thumbnails()


if __name__ == "__main__":
    main()
