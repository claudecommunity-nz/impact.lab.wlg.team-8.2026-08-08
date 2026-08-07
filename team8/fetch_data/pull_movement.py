"""Pull the countline movement feed to parquet. Idempotent — safe to re-run.

Source: Pōneke Travel Insights, over Opendatasoft.
  countline-mobility-hourly-summary  5.39M rows, one column per mode
  countline-mobility-daily           2.40M rows, long form
  countline-meta-info                410 countlines

Feed reality (verified 2026-08-07):
  - T+1: the newest row is always yesterday. Not a live feed.
  - 386 of 410 countlines still reporting; the rest stopped years ago.
  - Missing rows are NOT zeros — a (countline, direction, hour) cell is omitted
    entirely when there was no activity, so absence carries signal.
  - /records caps limit at 100; /exports/parquet is uncapped.

There is also a public, no-auth S3 mirror of the same data as monthly CSV, if the
Opendatasoft key ever becomes a problem — see README.

Run: `just pull-movement`
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import requests

BASE = "https://wellington-newzealand.opendatasoft.com/api/explore/v2.1/catalog/datasets"
HOURLY = "countline-mobility-hourly-summary"
DAILY = "countline-mobility-daily"
META = "countline-meta-info"

RAW = Path(__file__).resolve().parents[2] / "data" / "raw" / "movement"
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

# Replay window: covers Thu 23 Oct 2025 (MetService RED wind warning) plus enough
# either side to build a same-weekday baseline.
REPLAY_FROM, REPLAY_TO = "2025-08-01", "2025-11-15"
RECENT_FROM = "2026-05-29"  # trailing ~10 weeks


def api_key() -> str:
    """Read-only Opendatasoft key.

    Readable from the public Travel Insights JS bundle, but it is WCC's and permission
    to depend on it is unconfirmed, so it is not committed. Set TRAVEL_INSIGHTS_KEY or
    put it in a gitignored .env.
    """
    key = os.environ.get("TRAVEL_INSIGHTS_KEY")
    if key:
        return key
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip() == "TRAVEL_INSIGHTS_KEY":
                return v.strip().strip("'\"")
    raise RuntimeError(
        "No Opendatasoft key. Set it with:\n"
        "  echo 'TRAVEL_INSIGHTS_KEY=<key>' > .env      # gitignored\n"
        "The key is readable from the Travel Insights dashboard JS bundle."
    )


def _headers() -> dict[str, str]:
    return {"Authorization": f"Apikey {api_key()}"}


def export_parquet(dataset: str, dest: Path, where: str | None = None) -> Path:
    """Bulk-download a dataset to parquet, skipping it if already present."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  = {dest.name} already present ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".partial")
    print(f"  → {dest.name}  where={where or '(all)'}")
    with requests.get(
        f"{BASE}/{dataset}/exports/parquet",
        headers=_headers(),
        params={"where": where} if where else {},
        stream=True,
        timeout=900,
    ) as r:
        r.raise_for_status()
        with tmp.open("wb") as fh:
            for chunk in r.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
    tmp.rename(dest)
    print(f"    {dest.stat().st_size / 1e6:.1f} MB")
    time.sleep(1.0)  # council servers throttle; be polite
    return dest


def latest_date() -> str:
    """Most recent countline_date in the feed. Confirms the T+1 lag."""
    r = requests.get(
        f"{BASE}/{HOURLY}/records",
        headers=_headers(),
        params={"limit": 1, "order_by": "countline_date desc"},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()["results"][0]["countline_date"][:10]


def main() -> None:
    print(f"latest available countline_date: {latest_date()}  (T+1 feed)\n")
    RAW.mkdir(parents=True, exist_ok=True)

    # Date literals MUST be date'YYYY-MM-DD'; a bare string raises
    # IncompatibleTypesInComparisonFilter.
    export_parquet(META, RAW / "meta.parquet")
    export_parquet(DAILY, RAW / "daily_full.parquet")
    export_parquet(
        HOURLY,
        RAW / "hourly_2025.parquet",
        where=f"countline_date>=date'{REPLAY_FROM}' and countline_date<date'{REPLAY_TO}'",
    )
    export_parquet(
        HOURLY,
        RAW / "hourly_recent.parquet",
        where=f"countline_date>=date'{RECENT_FROM}'",
    )
    print("\ndone.")


if __name__ == "__main__":
    main()
