import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from team8.fetch_data.events import (
    CAPTURE_DATE,
    FUTURE_END,
    PAST_START,
    SEED_PATH,
    build_snapshot,
    deduplicate,
    normalize_row,
    validate_snapshot,
)


def example_row() -> dict:
    return {
        "event_type": "concert",
        "name": "Example Concert",
        "venue_or_terminal": "TSB Arena",
        "latitude": -41.29,
        "longitude": 174.78,
        "start_time_local": "2026-09-01T19:30:00+12:00",
        "end_time_local": "2026-09-01T22:00:00+12:00",
        "expected_scale": 1000,
        "scale_basis": "venue_capacity",
        "status": "scheduled",
        "source_url": "https://example.test/event",
        "confidence": "high",
        "record_type": "event",
        "capture_method": "html",
    }


class TestNormalizeRow(unittest.TestCase):
    def test_normalizes_identity_and_capture_fields(self):
        row = normalize_row(
            example_row(), captured_at="2026-08-08T10:00:00+12:00"
        )

        self.assertEqual(len(row["event_id"]), 16)
        self.assertEqual(row["name"], "Example Concert")
        self.assertEqual(row["start_time_local"], "2026-09-01T19:30:00+12:00")
        self.assertEqual(row["captured_at"], "2026-08-08T10:00:00+12:00")
        self.assertEqual(row["first_seen"], row["captured_at"])
        self.assertEqual(row["last_seen"], row["captured_at"])
        self.assertEqual(row["source_urls"], [])
        self.assertEqual(row["scale_notes"], "")

    def test_collapses_whitespace(self):
        raw = example_row()
        raw["name"] = "  Example   Concert\n"
        raw["venue_or_terminal"] = " TSB   Arena "

        row = normalize_row(raw, captured_at="2026-08-08T10:00:00+12:00")

        self.assertEqual(row["name"], "Example Concert")
        self.assertEqual(row["venue_or_terminal"], "TSB Arena")

    def test_rejects_missing_name(self):
        raw = example_row()
        raw["name"] = ""
        with self.assertRaises(ValueError):
            normalize_row(raw, captured_at="2026-08-08T10:00:00+12:00")

    def test_rejects_missing_source_url(self):
        raw = example_row()
        raw["source_url"] = ""
        with self.assertRaises(ValueError):
            normalize_row(raw, captured_at="2026-08-08T10:00:00+12:00")

    def test_rejects_invalid_event_type(self):
        raw = example_row()
        raw["event_type"] = "parade"
        with self.assertRaises(ValueError):
            normalize_row(raw, captured_at="2026-08-08T10:00:00+12:00")

    def test_rejects_naive_timestamp(self):
        raw = example_row()
        raw["start_time_local"] = "2026-09-01T19:30:00"
        with self.assertRaises(ValueError):
            normalize_row(raw, captured_at="2026-08-08T10:00:00+12:00")

    def test_rejects_scale_without_basis(self):
        raw = example_row()
        raw["scale_basis"] = None
        with self.assertRaises(ValueError):
            normalize_row(raw, captured_at="2026-08-08T10:00:00+12:00")


class TestSnapshot(unittest.TestCase):
    def test_deduplicate_merges_corroborating_sources(self):
        first = normalize_row(
            example_row(), captured_at="2026-08-08T10:00:00+12:00"
        )
        second = dict(first, source_url="https://example.test/corroboration")

        merged = deduplicate([first, second])

        self.assertEqual(len(merged), 1)
        self.assertIn("https://example.test/corroboration", merged[0]["source_urls"])

    def test_build_snapshot_accepts_historical_and_future_records(self):
        historical = example_row()
        historical.update(
            {
                "name": "Historical Concert",
                "start_time_local": "2026-05-08T19:30:00+12:00",
                "end_time_local": "2026-05-08T22:00:00+12:00",
            }
        )
        seed = {
            "sources": [
                {"source_id": source_id}
                for source_id in (
                    "wellingtonnz-major-events",
                    "venue-calendars",
                    "centreport-cruise",
                    "metlink-gtfs",
                )
            ],
            "events": [historical, example_row()],
        }

        snapshot = build_snapshot(seed, captured_at="2026-08-08T10:00:00+12:00")

        self.assertEqual(len(snapshot["events"]), 2)
        self.assertEqual(
            {source["source_id"] for source in snapshot["sources"]},
            {
                "wellingtonnz-major-events",
                "venue-calendars",
                "centreport-cruise",
                "metlink-gtfs",
            },
        )

    def test_build_snapshot_rejects_record_before_window(self):
        raw = example_row()
        raw["start_time_local"] = "2026-05-07T19:30:00+12:00"
        raw["end_time_local"] = "2026-05-07T22:00:00+12:00"
        seed = {"sources": [{"source_id": "source"}], "events": [raw]}

        with self.assertRaises(ValueError):
            build_snapshot(seed, captured_at="2026-08-08T10:00:00+12:00")

    def test_build_snapshot_rejects_record_after_window(self):
        raw = example_row()
        raw["start_time_local"] = "2026-11-09T19:30:00+12:00"
        raw["end_time_local"] = "2026-11-09T22:00:00+12:00"
        seed = {"sources": [{"source_id": "source"}], "events": [raw]}

        with self.assertRaises(ValueError):
            build_snapshot(seed, captured_at="2026-08-08T10:00:00+12:00")

    def test_expands_dated_scheduled_service_templates(self):
        template = example_row()
        template.update(
            {
                "event_type": "ferry",
                "name": "Example ferry departure",
                "venue_or_terminal": "Example terminal",
                "expected_scale": None,
                "scale_basis": "unknown",
                "record_type": "scheduled_service",
                "start_date": "2026-08-08",
                "end_date": "2026-08-10",
                "time_local": "08:15",
                "weekdays": [5, 6],
                "duration_minutes": 1,
            }
        )
        template.pop("start_time_local")
        template.pop("end_time_local")
        seed = {"sources": [{"source_id": "ferry"}], "scheduled_services": [template]}

        snapshot = build_snapshot(seed, captured_at="2026-08-08T10:00:00+12:00")

        self.assertEqual(len(snapshot["events"]), 2)
        self.assertTrue(all(row["record_type"] == "scheduled_service" for row in snapshot["events"]))
        self.assertEqual(snapshot["events"][0]["start_time_local"], "2026-08-08T08:15:00+12:00")


class TestSeed(unittest.TestCase):
    def test_committed_seed_has_required_source_families_and_round_trips(self):
        seed = json.loads(SEED_PATH.read_text())

        self.assertEqual(
            seed["window"],
            {
                "past_start": PAST_START,
                "capture_date": CAPTURE_DATE,
                "future_end": FUTURE_END,
            },
        )
        self.assertGreaterEqual(
            {source["source_id"] for source in seed["sources"]},
            {
                "wellingtonnz-major-events",
                "venue-calendars",
                "centreport-cruise",
                "metlink-gtfs",
                "interislander-timetable",
                "bluebridge-timetable",
            },
        )
        self.assertTrue(any(row["start_time_local"][:10] < CAPTURE_DATE for row in seed["events"]))
        self.assertTrue(any(row["start_time_local"][:10] >= CAPTURE_DATE for row in seed["events"]))
        self.assertTrue(all(row.get("source_url") for row in seed["events"]))

        snapshot = build_snapshot(seed, captured_at=seed["captured_at"])
        round_trip = json.loads(json.dumps(snapshot))
        validate_snapshot(round_trip)
        self.assertEqual(
            [row["event_id"] for row in round_trip["events"]],
            [row["event_id"] for row in snapshot["events"]],
        )


class _FakeContext:
    def __init__(self, content: bytes):
        self.content = content

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return self.content


class TestSourceCapture(unittest.TestCase):
    def test_capture_source_writes_safe_path_and_manifest_row(self):
        from team8.fetch_data.pull_events import capture_source

        source = {
            "source_id": "venue-calendars",
            "url": "https://example.test/calendar",
            "format": "html",
            "name": "Venue calendars",
            "coverage": "future",
            "notes": "test source",
        }
        with TemporaryDirectory() as temporary:
            with patch(
                "team8.fetch_data.pull_events.urlopen",
                return_value=_FakeContext(b"<html>events</html>"),
            ):
                manifest = capture_source(
                    source,
                    captured_at="2026-08-08T10:00:00+12:00",
                    raw_root=Path(temporary),
                )

            path = Path(manifest["path"])
            self.assertTrue(path.exists())
            self.assertNotIn("/", path.name)
            self.assertEqual(manifest["source_id"], "venue-calendars")
            self.assertEqual(manifest["format"], "html")
            self.assertEqual(manifest["captured_at"], "2026-08-08T10:00:00+12:00")
            self.assertEqual(path.read_text(), "<html>events</html>")


if __name__ == "__main__":
    unittest.main()
