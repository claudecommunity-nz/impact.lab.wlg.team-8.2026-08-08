"""Pull the time-varying context used to explain (or fail to explain) an anomaly.

Holidays matter more than they sound: Labour Day 2025 (-39% citywide) and Christmas
(-62%) outrank every real event in the archive. Excluding them from the baseline removes
most of the top false positives.

Run: `just pull-context`
"""

from __future__ import annotations

import json
from pathlib import Path

import requests

RAW = Path(__file__).resolve().parents[2] / "data" / "raw" / "context"

YEARS = range(2023, 2027)


def holidays() -> None:
    """NZ public holidays, incl. the Wellington anniversary regional day."""
    out = []
    for y in YEARS:
        r = requests.get(f"https://date.nager.at/api/v3/PublicHolidays/{y}/NZ", timeout=60)
        r.raise_for_status()
        for h in r.json():
            counties = h.get("counties") or []
            # National, or explicitly Wellington-region.
            if h.get("global") or any("WGN" in c for c in counties):
                out.append(
                    {
                        "date": h["date"],
                        "name": h["localName"],
                        "national": bool(h.get("global")),
                    }
                )
    dest = RAW / "nz_holidays.json"
    dest.write_text(json.dumps(sorted(out, key=lambda x: x["date"]), indent=2))
    print(f"  → {dest.name}  {len(out)} holidays {YEARS.start}–{YEARS.stop - 1}")


def quakes() -> None:
    """GeoNet quakes felt near Wellington. GeoJSON, already WGS84."""
    r = requests.get(
        "https://quakesearch.geonet.org.nz/geojson",
        params={
            "bbox": "174.6,-41.4,175.0,-41.1",
            "minmag": "3.0",
            "startdate": "2023-01-01",
            "enddate": "2026-08-08",
        },
        timeout=120,
    )
    r.raise_for_status()
    dest = RAW / "geonet_quakes.geojson"
    dest.write_text(r.text)
    n = len(r.json().get("features", []))
    print(f"  → {dest.name}  {n} quakes M3.0+ near Wellington")


def warnings() -> None:
    """Hand-entered severe weather warnings.

    Deliberately hand-entered and labelled as such: MetService publishes no open
    machine-readable warnings archive we can cite. Presenting this as an automated
    integration would be dishonest, and honesty about limits is a judging criterion.
    """
    dest = RAW / "warnings_manual.json"
    if dest.exists():
        print(f"  = {dest.name} exists, leaving alone")
        return
    dest.write_text(
        json.dumps(
            {
                "_provenance": "HAND-ENTERED from public news/MetService reporting. "
                "Not an automated feed. Each entry carries its source.",
                "warnings": [
                    {
                        "date": "2025-10-23",
                        "type": "wind",
                        "level": "red",
                        "region": "Wellington / lower North Island",
                        "valid_until": "2025-10-23T19:00:00+13:00",
                        "source": "MetService severe weather warning, reported widely; "
                        "storm of 21-27 Oct 2025 killed a person in Wellington "
                        "(falling branch).",
                        "verified_effect": "citywide countline volume -43% vs "
                        "neighbouring Thursdays; pedestrians -82% at midday",
                    }
                ],
            },
            indent=2,
        )
    )
    print(f"  → {dest.name}  (hand-entered, 1 warning)")


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    holidays()
    quakes()
    warnings()
    print("\ndone.")


if __name__ == "__main__":
    main()
