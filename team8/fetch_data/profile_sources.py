"""Automatic per-source profile reports — schema, distributions, missingness.

One HTML per source under docs/profiles/. This is what covers "each source, each schema"
without hand-writing a page per dataset.

Cost control: the hourly tables are ~1-1.4M rows and daily_full is 2.4M. `minimal=True`
skips the O(n^2) correlation and interaction passes, and large tables are sampled. The
sample size goes in the report title so nobody reads a sampled distribution as a
population one.

Run: `just profile`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "profiles"
CAT = ROOT / "data" / "catalogue" / "sources.json"

#: Above this many rows we profile a random sample instead of the whole table.
SAMPLE_ABOVE = 200_000


def _report(df: pd.DataFrame, title: str, dest: Path) -> None:
    from data_profiling import ProfileReport

    ProfileReport(
        df,
        title=title,
        minimal=True,
        progress_bar=False,
        explorative=False,
    ).to_file(dest)


def profile_movement(con: duckdb.DuckDBPyConnection) -> list[dict]:
    done = []
    for p in sorted((ROOT / "data" / "raw" / "movement").glob("*.parquet")):
        dest = OUT / f"movement__{p.stem}.html"
        n = con.execute(f"select count(*) from '{p}'").fetchone()[0]
        if dest.exists():
            print(f"  = {dest.name}")
            done.append({"source_id": p.stem, "group": "movement",
                         "profile": dest.name, "rows": n})
            continue

        if n > SAMPLE_ABOVE:
            frac = SAMPLE_ABOVE / n
            df = con.execute(
                f"select * from '{p}' using sample {frac * 100:.4f}%"
            ).df()
            title = (f"{p.stem} — random sample of {len(df):,} of {n:,} rows "
                     f"(sampled for speed; distributions are of the sample)")
        else:
            df = con.execute(f"select * from '{p}'").df()
            title = f"{p.stem} — all {n:,} rows"

        print(f"  → {dest.name}  ({len(df):,} rows)")
        _report(df, title, dest)
        done.append({"source_id": p.stem, "group": "movement",
                     "profile": dest.name, "rows": n, "profiled_rows": len(df)})
    return done


def profile_gis() -> list[dict]:
    """Profile GeoJSON attribute tables (geometry dropped — it isn't summarisable)."""
    done = []
    for p in sorted((ROOT / "data" / "raw" / "gis").glob("*.geojson")):
        dest = OUT / f"gis__{p.stem}.html"
        try:
            feats = json.loads(p.read_text()).get("features", [])
        except json.JSONDecodeError:
            continue
        if not feats:
            continue
        rows = [f.get("properties", {}) for f in feats]
        if dest.exists():
            print(f"  = {dest.name}")
            done.append({"source_id": p.stem, "group": "gis",
                         "profile": dest.name, "rows": len(rows)})
            continue
        df = pd.DataFrame(rows)
        if df.empty or df.shape[1] == 0:
            continue
        print(f"  → {dest.name}  ({len(df):,} features x {df.shape[1]} attrs)")
        _report(df, f"{p.stem} — {len(df):,} features (attributes only)", dest)
        done.append({"source_id": p.stem, "group": "gis",
                     "profile": dest.name, "rows": len(rows)})
    return done


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    done = profile_movement(con) + profile_gis()
    (OUT / "_index.json").write_text(json.dumps(done, indent=2))

    # Link each profile back into the inventory so the dashboard can find it.
    if CAT.exists():
        cat = json.loads(CAT.read_text())
        by_id = {d["source_id"]: d["profile"] for d in done}
        for r in cat:
            if r["source_id"] in by_id:
                r["profile"] = f"profiles/{by_id[r['source_id']]}"
        CAT.write_text(json.dumps(cat, indent=2))

    print(f"\n  {len(done)} profiles in docs/profiles/")


if __name__ == "__main__":
    main()
