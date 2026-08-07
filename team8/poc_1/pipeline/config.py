"""Paths, constants and baseline parameters for the Poneke Pulse pipeline.

Single source of truth. Nothing below this module hardcodes a threshold.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path

# --- paths -----------------------------------------------------------------
# .../team8/poc_1/pipeline/config.py -> repo root is four parents up.
REPO_ROOT = Path(__file__).resolve().parents[3]

RAW = REPO_ROOT / "data" / "raw"
MOVEMENT = RAW / "movement"
CONTEXT_RAW = RAW / "context"
GIS_RAW = RAW / "gis"

HOURLY_2025 = MOVEMENT / "hourly_2025.parquet"
HOURLY_RECENT = MOVEMENT / "hourly_recent.parquet"
META = MOVEMENT / "meta.parquet"

OUT = REPO_ROOT / "team8" / "poc_1" / "web" / "public" / "data"

# --- modes -----------------------------------------------------------------
# Every mode the feed carries. `total` is the sum of all nine: this is what the
# published Poneke Travel Insights daily totals agree with, so it is what we
# ship as the citywide number.
ALL_MODES = (
    "bus", "car", "cyclist", "e_scooter", "lgv",
    "motorbike", "ogv1", "ogv2", "pedestrian",
)

# The only modes with enough mass to carry a ratio. At cell level ogv1 is 81%
# zero, motorbike 82%, e_scooter 85%, ogv2 91% — a ratio built on those is noise.
MASS_MODES = ("pedestrian", "cyclist", "car", "bus", "lgv")

# Series actually shipped per day file (contract: actual/expected keys).
SHIPPED_SERIES = ("total",) + MASS_MODES
# Series the UI scores, so the only ones that need a spread estimate.
SCORED_SERIES = ("total", "pedestrian", "car")

ACTIVE_SINCE = "2026-07-01"  # meta.latest >= this => countline considered active


@dataclass(frozen=True)
class BaselineParams:
    """Robust-baseline parameters. Echoed verbatim into manifest.baseline_params
    so the UI can display the rules it is rendering the output of."""

    method: str = "trailing_same_weekday_same_hour_median_mad"
    window_days: int = 84
    max_occurrences: int = 12
    min_baseline_n: int = 5
    expected_floor_per_hour: float = 5.0
    mad_scale: float = 1.4826
    mad_floor_rule: str = "max(2.0, 0.10*median)"
    holiday_excluded: bool = True
    partial_ingest_excluded: bool = True
    partial_ingest_rule: str = "day citywide distinct hours < 22"
    mode_viability_gate: str = "baseline mean >= 5.0/hr over hours 07-19 for that line+mode"
    min_reporting_rate: float = 0.6

    # --- values used by code, not just displayed ---------------------------
    mad_floor_abs: float = 2.0
    mad_floor_frac: float = 0.10
    coverage_min_hours: int = 22          # < this distinct citywide hours => refused
    reporting_day_min_hours: int = 20     # hours a line must report to count as a "full" day
    mode_viability_min_per_hour: float = 5.0
    mode_viability_hours: tuple[int, int] = (7, 19)  # inclusive-exclusive upper handled in code

    # --- diagnosis (contract step 9) ---------------------------------------
    diag_deadband_pct: float = 20.0   # below this in both modes => 'normal'
    diag_collapse_pct: float = -30.0  # a mode has "collapsed" at or below this
    # Only below this in BOTH modes may the copy say "movement of every kind has
    # gone". Between the two thresholds it is "reduced access", because a -30%
    # street is still a street people are using.
    diag_absolute_collapse_pct: float = -80.0
    diag_ratio: float = 1.6           # one mode dominates if it is this much worse
    diag_riser_pct: float = 15.0      # pedestrians up by this much => people-friendly
    diag_elevated_z: float = 3.0

    def manifest_dict(self) -> dict:
        """Only the descriptive fields belong in the manifest."""
        d = asdict(self)
        for internal in (
            "mad_floor_abs", "mad_floor_frac", "coverage_min_hours",
            "reporting_day_min_hours", "mode_viability_min_per_hour",
            "mode_viability_hours", "diag_deadband_pct", "diag_collapse_pct",
            "diag_absolute_collapse_pct",
            "diag_ratio", "diag_riser_pct", "diag_elevated_z",
        ):
            d.pop(internal)
        return d


PARAMS = BaselineParams()

# --- the days we ship ------------------------------------------------------
# (date, source parquet, narrative role, label)
SHIPPED_DAYS = [
    ("2025-10-23", HOURLY_2025, "event",
     "Red wind warning. The city stops walking."),
    ("2025-10-16", HOURLY_2025, "healthy",
     "An ordinary Thursday. This is what the rhythm looks like."),
    ("2025-10-04", HOURLY_2025, "refusal",
     "13 of 24 hours delivered. We could not see, so we are not calling it."),
    ("2025-10-05", HOURLY_2025, "refusal",
     "The other half of the same ingest gap, not a second event."),
    ("2026-08-06", HOURLY_RECENT, "latest",
     "The newest data this tool can ever have. It is yesterday."),
]

# Vitals windows: (filename stem, source parquet, start, end)
VITALS_WINDOWS = [
    ("2025-window", HOURLY_2025, "2025-08-07", "2025-11-14"),
    ("2026-window", HOURLY_RECENT, "2026-05-29", "2026-08-06"),
]

# --- GIS context layers ----------------------------------------------------
# Reference geography only, never scored. Deliberately a small subset: `roads`
# is omitted because the CARTO basemap already draws every road in the city and
# the layer is 7.7 MB on its own — a third of the entire payload for a duplicate.
GIS_LAYERS = [
    ("emergency-routes", "Wellington City Council",
     "WCC open data; licence per publisher, check before republishing."),
    ("community-emergency-hubs", "Wellington City Council",
     "WCC open data; licence per publisher, check before republishing."),
    ("tsunami-evacuation-zones", "Wellington Region Emergency Management Office",
     "WREMO / GWRC hazard planning layer. Planning use only."),
    ("street-events-road-closures", "Wellington City Council",
     "Scheduled street-event closures, snapshot at fetch time. Not the closures "
     "in force on any replay date, and not an emergency closure feed."),
    ("metservice-warnings", "MetService",
     "Current warnings snapshot at fetch time. MetService publishes no archive."),
]
GIS_OMITTED = [
    {"id": "roads", "reason": "7.7 MB and redundant with the CARTO basemap, "
                              "which already renders the road network."},
]

# --- honesty copy ----------------------------------------------------------
# Lives here, not in React, so the constraint travels with the data.
DISCLAIMERS = {
    "not_live": (
        "This is an after-action and next-morning tool. The movement feed is T+1: "
        "the newest thing it can ever know is yesterday. Nothing here is live detection."
    ),
    "hazard_planning_only": (
        "Movement counts and GIS layers here are hazard-planning and after-action "
        "material, not operational emergency information."
    ),
    "emergency": "In an emergency, call 111.",
    # Counted in camera sites, not countlines. The countlines stack a median of 3
    # to a camera, so quoting countlines would claim ~3x the spatial coverage we
    # actually have. The count is a PLACEHOLDER, filled by build.py from the real
    # viewpoint set: it drifted once already (it read 386 after the countline set
    # grew, and stayed wrong on disk because nothing re-ran the pipeline), and a
    # number nobody can type is a number that cannot drift.
    "sparse_coverage": (
        "{sites} camera sites cover a whole city. Absence of an anomaly means nothing — it "
        "usually means nothing was watching. The map shows where we can and cannot see."
    ),
    "warning_provenance": (
        "MetService warning for 23 Oct 2025 is HAND-ENTERED from public reporting. "
        "MetService publishes no warnings archive."
    ),
}

ATTRIBUTION = {
    "movement": "WCC / VivaCity via Poneke Travel Insights",
    "gis": (
        "GIS layers belong to their publishers (WCC, Greater Wellington, GNS Science, "
        "NIWA, Wellington Water, MBIE, NZTA, MetService). Licences vary per layer — "
        "check before republishing anything derived."
    ),
    "basemap": "(c) OpenStreetMap, (c) CARTO",
}
