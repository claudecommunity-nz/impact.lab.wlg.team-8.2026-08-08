"""Diagnosis from the RATIO of per-mode change, never from magnitude.

The point of the product: a countline that dropped 80% is not interesting on
its own. A countline where *pedestrians* dropped 80% while *cars* dropped 37%
is telling you people stopped walking first — which is an exposure hazard, not
a road closure. The same two numbers the other way round is a road closure.

Typing requires both pedestrian and car to be viable on that line. They are not
on roughly 83% of the network, and `cannot_type` is therefore the honest
majority verdict. It is a first-class value with its own count in the summary,
not a silent fallback.
"""

from __future__ import annotations

from . import config

P = config.PARAMS

# All values the `diagnosis` field can take, so the frontend can exhaustively
# switch on it.
DIAGNOSES = (
    "exposure_hazard",
    "road_closure",
    "loss_of_access",
    "closed_to_traffic_open_to_people",
    "elevated",
    "normal",
    "cannot_type",
    "no_baseline",
    "not_observed",
)


def classify(
    ped: float | None,
    car: float | None,
    z: float,
    scorable: bool,
    observed_day: bool,
    ped_exp: float = 0.0,
) -> tuple[str, str]:
    """Return `(diagnosis, human reason)`.

    `ped` / `car` are per-mode delta_pct, or None when the mode failed its
    viability gate on this line. `ped_exp` is the line's expected pedestrian
    day total, used to stop a percentage rise off a near-zero base from being
    typed at all.

    Every reason string is phrased as an inference from movement alone. Nothing
    here is checked against a closure or incident record, so no string may
    assert a cause as established fact.
    """
    if not observed_day:
        return "not_observed", "The day was not observed well enough to score."
    if not scorable:
        return ("no_baseline",
                "No usable history for this sensor — too few qualifying days, "
                "too little volume, or it reports intermittently.")
    if ped is None or car is None:
        missing = "cars" if car is None else "pedestrians"
        return ("cannot_type",
                f"Only one mode carries usable volume here (no {missing} baseline), "
                "so the change cannot be typed.")

    quiet = abs(ped) < P.diag_deadband_pct and abs(car) < P.diag_deadband_pct
    if quiet:
        if z >= P.diag_elevated_z:
            return "elevated", f"Volume is {z:.1f} robust deviations above normal."
        return "normal", f"Pedestrians {ped:+.0f}%, cars {car:+.0f}% — within normal spread."

    # People kept moving on foot but traffic went: the street is walkable.
    # The percentage alone is not enough — a line expecting 5 pedestrians a day
    # can post +8000% on a quiet afternoon. Require a real denominator first.
    if ped >= P.diag_riser_pct and car <= P.diag_collapse_pct:
        if ped_exp < P.expected_floor_per_hour * 12:
            return ("cannot_type",
                    "Pedestrian baseline too small for a percentage rise to mean "
                    f"anything (expected {ped_exp:.0f} for the day).")
        return ("closed_to_traffic_open_to_people",
                f"Pedestrians {ped:+.0f}% while cars {car:+.0f}%: consistent with "
                "a street closed to traffic but still open to people.")

    ped_gone = ped <= P.diag_collapse_pct
    car_gone = car <= P.diag_collapse_pct

    exposure = ("exposure_hazard",
                f"pedestrians {ped:.0f}% vs cars {car:.0f}%: pedestrians fell "
                "harder — consistent with people stopping walking first")
    closure = ("road_closure",
               f"cars {car:.0f}% vs pedestrians {ped:.0f}%: vehicles fell harder — "
               "consistent with a road closure, street still walkable")

    if ped_gone and car_gone:
        # Which collapsed harder, by ratio not by size?
        if ped <= P.diag_ratio * car:
            return exposure
        if car <= P.diag_ratio * ped:
            return closure
        # Neither mode dominates. "Movement of every kind has gone" is the
        # strongest phrase in the vocabulary and is reserved for the cases that
        # earn it — at -30/-37 Courtenay Place was open at two-thirds of normal.
        if ped <= P.diag_absolute_collapse_pct and car <= P.diag_absolute_collapse_pct:
            return ("loss_of_access",
                    f"pedestrians {ped:.0f}% and cars {car:.0f}%: movement of "
                    "every kind has gone")
        return ("loss_of_access",
                f"pedestrians {ped:.0f}% and cars {car:.0f}% fell together, neither "
                "dominating — consistent with reduced access")

    if ped_gone:
        return exposure
    if car_gone:
        return closure

    if z >= P.diag_elevated_z:
        return "elevated", f"Volume is {z:.1f} robust deviations above normal."
    return "normal", f"Pedestrians {ped:+.0f}%, cars {car:+.0f}% — no collapse in either mode."


def caveats(
    baseline_n: int,
    reporting_rate: float,
    hours_reported: int,
    day_expected_total: float,
    viable_count: int,
    day_partial: bool,
) -> list[str]:
    """The evidence flags that travel with every line, so nothing is scored
    without the reasons to doubt it attached."""
    out: list[str] = []
    if baseline_n == 0:
        out.append("new_sensor_no_baseline")
    elif baseline_n < P.min_baseline_n:
        out.append("low_baseline_volume" if day_expected_total > 0
                   else "new_sensor_no_baseline")
    if reporting_rate < P.min_reporting_rate:
        out.append("intermittent_sensor")
    if 0 < day_expected_total < P.expected_floor_per_hour * 24:
        out.append("low_baseline_volume")
    if viable_count <= 1:
        out.append("single_mode_only")
    if hours_reported == 0:
        out.append("sensor_silent_all_day")
    elif hours_reported < 24 or day_partial:
        out.append("partial_hours")
    return sorted(set(out))
