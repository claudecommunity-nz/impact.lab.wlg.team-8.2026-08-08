"""The cold base: every street in the city, geometry only.

Why this exists
---------------
The map has always drawn only the streets we can see — 147 edges out of a 937 km
network — which makes a sparse instrument look like a complete one. Someone reading
the map has no way to tell "nothing happening here" from "nothing watching here",
because the unwatched 95% of the city simply is not drawn.

So we draw all of it, cold. Every street renders in the coldest step of the ramp, and
traffic is heat laid on top. The city is legible as a network; the measured part of it
glows; the difference between them is the honest picture of our coverage.

Geometry only — no attributes. 5,017 features, 112,888 vertices, coordinates rounded to
5 dp (~1 m), which is well under the width of the line that draws them. That lands at
~2.5 MB uncompressed and well under 1 MB over the wire, against a 1.4 MB tsunami layer
we already ship.

Run: part of `just poc-data`, or `uv run python -m team8.poc_1.pipeline.roadbase`
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "data" / "raw" / "gis" / "roads.geojson"
OUT = ROOT / "team8" / "poc_1" / "web" / "public" / "data" / "gis" / "road-base.json"

#: ~1 m. The lines are drawn 1-3 px wide, so more precision is bytes nobody can see.
DP = 5


def build() -> dict:
    src = json.loads(SRC.read_text())
    paths: list[list[list[float]]] = []
    skipped = 0

    for f in src.get("features", []):
        geom = f.get("geometry") or {}
        kind = geom.get("type")
        if kind == "LineString":
            rings = [geom["coordinates"]]
        elif kind == "MultiLineString":
            rings = geom["coordinates"]
        else:
            skipped += 1
            continue
        for ring in rings:
            if len(ring) < 2:
                skipped += 1
                continue
            paths.append([[round(x, DP), round(y, DP)] for x, y in ring])

    return {
        "version": 1,
        "n_paths": len(paths),
        "n_vertices": sum(len(p) for p in paths),
        "source": "Wellington City Council road centrelines (roads.geojson), EPSG:4326",
        "note": (
            "Every street in the city, drawn cold. This layer carries NO measurement — "
            "it exists so the unwatched part of the network is visible. Heat is laid on "
            "top of it from the edges that have a sensor."
        ),
        "skipped": skipped,
        "paths": paths,
    }


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = build()
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    mb = OUT.stat().st_size / 1e6
    print(f"  → {OUT.relative_to(ROOT)}  {data['n_paths']:,} paths, "
          f"{data['n_vertices']:,} vertices, {mb:.1f} MB")
    if data["skipped"]:
        print(f"    skipped {data['skipped']} features with unusable geometry")


if __name__ == "__main__":
    main()
