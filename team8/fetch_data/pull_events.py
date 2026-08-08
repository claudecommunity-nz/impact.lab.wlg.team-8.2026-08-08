"""Capture public major-event source pages and feeds.

Capture is intentionally separate from normalization. Downloaded publisher-owned
content is ignored under ``data/raw/events``; reviewed rows are maintained in the
committed seed consumed by ``team8.fetch_data.events``.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
RAW_ROOT = ROOT / "data" / "raw" / "events"

SOURCE_REGISTRY: tuple[dict[str, str], ...] = (
    {
        "source_id": "wellingtonnz-major-events",
        "name": "WellingtonNZ major events",
        "url": "https://www.wellingtonnz.com/major-events",
        "format": "html",
        "coverage": "past and future public major events",
        "notes": "Major-events overview and planning calendar.",
    },
    {
        "source_id": "wellingtonnz-event-pages",
        "name": "WellingtonNZ events",
        "url": "https://www.wellingtonnz.com/visit/events",
        "format": "html",
        "coverage": "future public events",
        "notes": "Event landing page and links to individual event records.",
    },
    {
        "source_id": "venue-calendars",
        "name": "Official Wellington venue calendars",
        "url": "https://www.hnrystadium.co.nz/",
        "format": "html",
        "coverage": "future venue events",
        "notes": "Venue calendar family; individual venues are reviewed during normalization.",
    },
    {
        "source_id": "centreport-cruise",
        "name": "CentrePort cruise schedule",
        "url": "https://www.centreport.co.nz/what-we-do/cruise-ships/cruise-schedule",
        "format": "html",
        "coverage": "future cruise calls",
        "notes": "Arrival, departure and PAX capacity proxy; subject to change.",
    },
    {
        "source_id": "metlink-gtfs",
        "name": "Metlink GTFS",
        "url": "https://static.opendata.metlink.org.nz/v1/gtfs/full.zip",
        "format": "gtfs",
        "coverage": "scheduled public transport",
        "notes": "Static GTFS schedule ZIP used for transport context.",
    },
    {
        "source_id": "interislander-timetable",
        "name": "Interislander timetable",
        "url": "https://www.interislander.co.nz/plan/ferry-timetable",
        "format": "html",
        "coverage": "future Cook Strait sailings",
        "notes": "Official Wellington–Picton timetable and service information.",
    },
    {
        "source_id": "bluebridge-timetable",
        "name": "Bluebridge timetable",
        "url": "https://www.bluebridge.co.nz/timetable/",
        "format": "html",
        "coverage": "future Cook Strait sailings",
        "notes": "Official Wellington–Picton timetable and seasonal pattern.",
    },
)

EXTENSIONS = {"html": "html", "pdf": "pdf", "gtfs": "zip"}


def _safe_filename(source_id: str, captured_at: str, extension: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]+", "-", source_id.lower()).strip("-")
    date_part = captured_at[:10]
    return f"{slug}-{date_part}.{extension}"


def capture_source(
    source: dict[str, str], *, captured_at: str, raw_root: Path
) -> dict[str, Any]:
    """Download one registered source and return its capture-manifest row."""

    source_id = source["source_id"]
    source_format = source["format"]
    if source_format not in EXTENSIONS:
        raise ValueError(f"unsupported source format for {source_id}: {source_format}")

    request = Request(
        source["url"],
        headers={"User-Agent": "PonekePulse/1.0 major-events snapshot"},
    )
    with urlopen(request, timeout=60) as response:
        content = response.read()

    raw_root.mkdir(parents=True, exist_ok=True)
    path = raw_root / _safe_filename(source_id, captured_at, EXTENSIONS[source_format])
    if source_format == "html":
        content = content.decode("utf-8", errors="replace").encode("utf-8")
    path.write_bytes(content)

    return {
        "source_id": source_id,
        "name": source["name"],
        "url": source["url"],
        "format": source_format,
        "coverage": source["coverage"],
        "notes": source["notes"],
        "captured_at": captured_at,
        "path": path.as_posix(),
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def main() -> None:
    captured_at = datetime.now().astimezone().isoformat(timespec="seconds")
    manifest: list[dict[str, Any]] = []
    for source in SOURCE_REGISTRY:
        try:
            row = capture_source(source, captured_at=captured_at, raw_root=RAW_ROOT)
        except OSError as exc:
            raise SystemExit(f"failed to capture {source['source_id']} ({source['url']}): {exc}") from exc
        manifest.append(row)
        print(f"captured {source['source_id']}: {row['bytes']:,} bytes")

    manifest_path = RAW_ROOT / "capture-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"wrote {manifest_path}")


if __name__ == "__main__":
    main()
