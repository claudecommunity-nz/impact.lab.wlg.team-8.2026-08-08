"""Normalize and emit the major-events snapshot used by the demo.

This module is deliberately independent of the movement pipeline. Network capture
lives in :mod:`team8.fetch_data.pull_events`; this module consumes reviewed seed rows
and produces a deterministic, committed artefact.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = ROOT / "data" / "curated" / "major_events_seed.json"
OUT_PATH = ROOT / "team8" / "poc_1" / "web" / "public" / "data" / "events" / "major-events.json"

PAST_START = "2026-05-08"
CAPTURE_DATE = "2026-08-08"
FUTURE_END = "2026-11-08"

EVENT_TYPES = frozenset({"stadium", "concert", "festival", "cruise", "airport", "ferry"})
STATUSES = frozenset({"scheduled", "cancelled", "completed", "unknown"})
SCALE_BASES = frozenset({"audience_estimate", "venue_capacity", "cruise_pax", "unknown"})
RECORD_TYPES = frozenset({"event", "scheduled_service"})
CAPTURE_METHODS = frozenset({"html", "pdf", "gtfs", "manual"})
CONFIDENCE_ORDER = {"low": 0, "medium": 1, "high": 2}
LOCAL_ZONE = ZoneInfo("Pacific/Auckland")


def _text(value: Any, field: str, *, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    result = " ".join(value.split())
    if required and not result:
        raise ValueError(f"{field} is required")
    return result


def _timestamp(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone offset")
    return parsed.isoformat(timespec="seconds")


def _coordinate(value: Any, field: str, low: float, high: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be numeric or null") from exc
    if not low <= number <= high:
        raise ValueError(f"{field} is outside its valid range")
    return number


def _source_urls(raw: dict[str, Any]) -> list[str]:
    values = raw.get("source_urls") or []
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        raise ValueError("source_urls must be a list of strings")
    return list(dict.fromkeys(value for value in values if value))


def _identity(row: dict[str, Any]) -> str:
    parts = (
        row["event_type"],
        row["name"],
        row["venue_or_terminal"] or "",
        row["start_time_local"],
    )
    return "|".join(parts)


def event_id(row: dict[str, Any]) -> str:
    """Return the stable identity for an already normalized event row."""

    return hashlib.sha256(_identity(row).encode("utf-8")).hexdigest()[:16]


def normalize_row(raw: dict[str, Any], *, captured_at: str) -> dict[str, Any]:
    """Validate and normalize one reviewed seed row."""

    if not isinstance(raw, dict):
        raise ValueError("event row must be an object")

    event_type = _text(raw.get("event_type"), "event_type", required=True)
    if event_type not in EVENT_TYPES:
        raise ValueError(f"invalid event_type: {event_type}")

    name = _text(raw.get("name"), "name", required=True)
    venue = _text(raw.get("venue_or_terminal"), "venue_or_terminal") or None
    start = _timestamp(raw.get("start_time_local"), "start_time_local")
    end = _timestamp(raw.get("end_time_local"), "end_time_local")
    if datetime.fromisoformat(end) < datetime.fromisoformat(start):
        raise ValueError("end_time_local must not precede start_time_local")

    source_url = _text(raw.get("source_url"), "source_url", required=True)
    status = _text(raw.get("status"), "status", required=True)
    if status not in STATUSES:
        raise ValueError(f"invalid status: {status}")

    confidence = _text(raw.get("confidence"), "confidence", required=True)
    if confidence not in CONFIDENCE_ORDER:
        raise ValueError(f"invalid confidence: {confidence}")

    record_type = _text(raw.get("record_type"), "record_type", required=True)
    if record_type not in RECORD_TYPES:
        raise ValueError(f"invalid record_type: {record_type}")

    capture_method = _text(raw.get("capture_method"), "capture_method", required=True)
    if capture_method not in CAPTURE_METHODS:
        raise ValueError(f"invalid capture_method: {capture_method}")

    scale = raw.get("expected_scale")
    if scale is not None:
        if isinstance(scale, bool):
            raise ValueError("expected_scale must be numeric or null")
        try:
            scale = float(scale)
        except (TypeError, ValueError) as exc:
            raise ValueError("expected_scale must be numeric or null") from exc
        if scale < 0:
            raise ValueError("expected_scale must not be negative")

    scale_basis = _text(raw.get("scale_basis"), "scale_basis") or "unknown"
    if scale_basis not in SCALE_BASES:
        raise ValueError(f"invalid scale_basis: {scale_basis}")
    if scale is not None and scale_basis == "unknown":
        raise ValueError("non-null expected_scale requires a scale_basis")
    if scale is not None and scale.is_integer():
        scale = int(scale)

    captured = _timestamp(captured_at, "captured_at")
    first_seen = _timestamp(raw.get("first_seen", captured), "first_seen")
    last_seen = _timestamp(raw.get("last_seen", captured), "last_seen")

    row = {
        "event_id": "",
        "event_type": event_type,
        "name": name,
        "venue_or_terminal": venue,
        "latitude": _coordinate(raw.get("latitude"), "latitude", -90.0, 90.0),
        "longitude": _coordinate(raw.get("longitude"), "longitude", -180.0, 180.0),
        "start_time_local": start,
        "end_time_local": end,
        "expected_scale": scale,
        "scale_basis": scale_basis,
        "status": status,
        "source_url": source_url,
        "source_urls": _source_urls(raw),
        "captured_at": captured,
        "first_seen": first_seen,
        "last_seen": last_seen,
        "confidence": confidence,
        "record_type": record_type,
        "capture_method": capture_method,
        "scale_notes": _text(raw.get("scale_notes"), "scale_notes"),
    }
    row["event_id"] = event_id(row)
    return row


def deduplicate(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge rows with the same stable identity, retaining corroborating sources."""

    merged: dict[str, dict[str, Any]] = {}
    for incoming in rows:
        identity = incoming["event_id"]
        current = merged.get(identity)
        if current is None:
            merged[identity] = dict(incoming, source_urls=list(incoming["source_urls"]))
            continue

        urls = set(current["source_urls"])
        urls.add(current["source_url"])
        urls.add(incoming["source_url"])
        urls.update(incoming["source_urls"])
        current["source_urls"] = sorted(url for url in urls if url != current["source_url"])

        if CONFIDENCE_ORDER[incoming["confidence"]] > CONFIDENCE_ORDER[current["confidence"]]:
            current.update({
                "expected_scale": incoming["expected_scale"],
                "scale_basis": incoming["scale_basis"],
                "status": incoming["status"],
                "confidence": incoming["confidence"],
                "scale_notes": incoming["scale_notes"],
            })
        elif incoming["scale_notes"] and incoming["scale_notes"] != current["scale_notes"]:
            notes = [note for note in (current["scale_notes"], incoming["scale_notes"]) if note]
            current["scale_notes"] = " ".join(dict.fromkeys(notes))
    return list(merged.values())


def _expand_scheduled_services(templates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expand compact recurring-service templates into dated event rows."""

    expanded: list[dict[str, Any]] = []
    for template in templates:
        if not isinstance(template, dict):
            raise ValueError("scheduled service template must be an object")
        try:
            start_date = date.fromisoformat(template["start_date"])
            end_date = date.fromisoformat(template["end_date"])
            departure_time = time.fromisoformat(template["time_local"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("scheduled service template has invalid date/time") from exc
        if end_date < start_date:
            raise ValueError("scheduled service end_date must not precede start_date")

        weekdays = template.get("weekdays", list(range(7)))
        if not isinstance(weekdays, list) or any(day not in range(7) for day in weekdays):
            raise ValueError("scheduled service weekdays must contain values from 0 to 6")
        duration_minutes = template.get("duration_minutes", 1)
        if isinstance(duration_minutes, bool) or not isinstance(duration_minutes, int):
            raise ValueError("scheduled service duration_minutes must be an integer")
        if duration_minutes < 0:
            raise ValueError("scheduled service duration_minutes must not be negative")

        row_template = {
            key: value
            for key, value in template.items()
            if key not in {"start_date", "end_date", "time_local", "weekdays", "duration_minutes"}
        }
        current = start_date
        while current <= end_date:
            if current.weekday() in weekdays:
                start = datetime.combine(current, departure_time, tzinfo=LOCAL_ZONE)
                end = start + timedelta(minutes=duration_minutes)
                row = dict(row_template)
                row["start_time_local"] = start.isoformat(timespec="seconds")
                row["end_time_local"] = end.isoformat(timespec="seconds")
                expanded.append(row)
            current += timedelta(days=1)
    return expanded


def build_snapshot(seed: dict[str, Any], *, captured_at: str) -> dict[str, Any]:
    """Build a validated snapshot from a reviewed seed object."""

    captured = _timestamp(captured_at, "captured_at")
    raw_rows = list(seed.get("events", []))
    raw_rows.extend(_expand_scheduled_services(seed.get("scheduled_services", [])))
    rows = [normalize_row(row, captured_at=captured) for row in raw_rows]
    snapshot = {
        "version": 1,
        "captured_at": captured,
        "window": {
            "past_start": PAST_START,
            "capture_date": CAPTURE_DATE,
            "future_end": FUTURE_END,
        },
        "sources": seed.get("sources", []),
        "events": deduplicate(rows),
        "transport_context": seed.get("transport_context", {}),
    }
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(snapshot: dict[str, Any]) -> None:
    """Raise ``ValueError`` when a snapshot violates the published contract."""

    if snapshot.get("version") != 1:
        raise ValueError("snapshot version must be 1")
    _timestamp(snapshot.get("captured_at"), "captured_at")
    window = snapshot.get("window")
    if window != {"past_start": PAST_START, "capture_date": CAPTURE_DATE, "future_end": FUTURE_END}:
        raise ValueError("snapshot window does not match the demo window")
    sources = snapshot.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("snapshot sources must be a non-empty list")
    source_ids = {source.get("source_id") for source in sources}
    if None in source_ids:
        raise ValueError("every source must have a source_id")

    seen: set[str] = set()
    start_date = datetime.fromisoformat(f"{PAST_START}T00:00:00+12:00").date()
    end_date = datetime.fromisoformat(f"{FUTURE_END}T23:59:59+12:00").date()
    for row in snapshot.get("events", []):
        required = ("event_id", "event_type", "name", "start_time_local", "end_time_local", "source_url")
        missing = [field for field in required if not row.get(field)]
        if missing:
            raise ValueError(f"event {row.get('event_id', '<unknown>')} missing {missing}")
        if row["event_id"] in seen:
            raise ValueError(f"duplicate event ID: {row['event_id']}")
        seen.add(row["event_id"])
        start = datetime.fromisoformat(row["start_time_local"])
        end = datetime.fromisoformat(row["end_time_local"])
        if start.date() < start_date or start.date() > end_date:
            raise ValueError(f"event outside snapshot window: {row['name']}")
        if end < start:
            raise ValueError(f"event end precedes start: {row['name']}")
        if row.get("expected_scale") is not None and row.get("scale_basis") == "unknown":
            raise ValueError(f"event scale has no basis: {row['name']}")


def main() -> None:
    if not SEED_PATH.exists():
        raise SystemExit(f"seed not found: {SEED_PATH}")
    seed = json.loads(SEED_PATH.read_text())
    captured_at = seed.get("captured_at", f"{CAPTURE_DATE}T10:00:00+12:00")
    snapshot = build_snapshot(seed, captured_at=captured_at)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(snapshot, separators=(",", ":")))

    unknown_scale = sum(row["expected_scale"] is None for row in snapshot["events"])
    unknown_coords = sum(row["latitude"] is None or row["longitude"] is None for row in snapshot["events"])
    historical = sum(row["start_time_local"][:10] < CAPTURE_DATE for row in snapshot["events"])
    future = len(snapshot["events"]) - historical
    scheduled = sum(row["record_type"] == "scheduled_service" for row in snapshot["events"])
    print(f"wrote {OUT_PATH}")
    print(
        f"source_rows={len(seed.get('events', [])) + len(seed.get('scheduled_services', []))} "
        f"events={len(snapshot['events'])} scheduled_service={scheduled} "
        f"historical={historical} future={future}"
    )
    print(f"unknown_scale={unknown_scale} unknown_coordinates={unknown_coords}")


if __name__ == "__main__":
    main()
