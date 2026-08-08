import unittest

from team8.fetch_data.events import normalize_row


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


if __name__ == "__main__":
    unittest.main()
