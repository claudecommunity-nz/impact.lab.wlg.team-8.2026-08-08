"""Non-movement corroboration, with per-item provenance.

Provenance is a field on every item, not a footnote on the page, so the UI
physically cannot render the MetService red warning without also rendering that
it was typed in by hand.

Absent corroboration is stated explicitly rather than omitted — "no closure
record retained for this date" is a different claim from "there were no
closures", and the difference matters to an emergency manager.

One sanitisation is deliberate and hard-coded: a man was killed by a falling
branch during the 21-27 Oct 2025 storm system, but on Tue 21 Oct under an
ORANGE warning, NOT on the 23rd. `warnings_manual.json`'s source note mentions
it. `_sanitise` strips that clause at build time so no artefact can attribute a
death to the replay date.
"""

from __future__ import annotations

import json
import re
from datetime import date

from . import config

_FATALITY = re.compile(r"[;,.]?\s*[^;.]*\b(kill|killed|death|died|fatal|fatalit)\w*\b[^;.]*[.]?",
                       re.IGNORECASE)

HAND = "hand_entered_from_public_reporting"
HAND_CAVEAT = ("MetService publishes no warnings archive; this entry was typed by hand "
               "and is not an automated feed.")

# Hand-entered corroboration for the replay date, from public reporting.
# Kept here rather than in the raw file because it is editorial, not fetched.
REPLAY_DATE = "2025-10-23"
REPLAY_TRANSPORT = [{
    "kind": "rail",
    "status": "all_services_cancelled",
    "window": ["08:00", "18:00"],
    "detail": ("All Metlink train services cancelled after KiwiRail closed every "
               "Wellington line."),
    "provenance": HAND,
}]
REPLAY_COUNCIL = [
    {"kind": "facilities_closed",
     "detail": "Wellington City Council closed all council facilities for the day.",
     "provenance": HAND},
    {"kind": "eoc_activated",
     "detail": "WCC activated its Emergency Operations Centre.",
     "provenance": HAND},
]
QUAKES_NOTE = (
    "GeoNet lists only four quakes near Wellington on this date, all M1.2-M2.0, "
    "none felt. Earthquake is not an explanation for this day. The local GeoNet "
    "extract on disk covers 2026 only, so the events themselves are not shipped — "
    "this verdict is hand-entered from the GeoNet catalogue, not computed here."
)


def _sanitise(text: str) -> str:
    return re.sub(r"\s+", " ", _FATALITY.sub("", text)).strip(" ;,.") + "."


def _warnings_for(d: str) -> list[dict]:
    raw = json.loads((config.CONTEXT_RAW / "warnings_manual.json").read_text())
    out = []
    for w in raw.get("warnings", []):
        if w.get("date") != d:
            continue
        out.append({
            "type": w.get("type"),
            "level": w.get("level"),
            "region": w.get("region"),
            "valid_from": w.get("valid_from", f"{d}T08:00:00+13:00"),
            # The raw file says 19:00. Public reporting, the scrubber marks and
            # the hourly recovery in the data all say the warning ran 08:00-18:00.
            # Normalised here so no two elements on screen give different times.
            "valid_until": f"{d}T18:00:00+13:00" if d == REPLAY_DATE
                           else w.get("valid_until"),
            "headline": ("MetService RED severe wind warning. Gusts forecast to "
                         "140 km/h; 109 km/h recorded at Kelburn, 153 km/h at "
                         "Mount Kaukau."),
            "provenance": HAND,
            "source_note": _sanitise(w.get("source", "")),
            "caveat": HAND_CAVEAT,
        })
    return out


def build(d: str, holiday: str | None) -> dict:
    is_replay = d == REPLAY_DATE
    return {
        "date": d,
        "weekday": date.fromisoformat(d).strftime("%A"),
        "warnings": _warnings_for(d),
        "warnings_note": (
            "No warning record retained for this date; absence here is absence of "
            "record, not absence of weather. MetService publishes no warnings archive."
        ) if not _warnings_for(d) else None,
        "transport": REPLAY_TRANSPORT if is_replay else [],
        "council": REPLAY_COUNCIL if is_replay else [],
        "quakes": [],
        "quakes_verdict": "ruled_out" if is_replay else "not_assessed",
        "quakes_note": QUAKES_NOTE if is_replay else (
            "No earthquake assessment made for this date."),
        "road_closures": None,
        "road_closures_note": (
            "No closure record retained for this date; absence here is absence of "
            "record, not absence of closures."
        ),
        "holiday": {"name": holiday} if holiday else None,
    }
