"""Drift assertions against figures verified by hand against the raw data.

These exist so a change to the reindex, the mode set or the baseline that
silently moves a headline number fails the build instead of reaching a demo.

Two definitions of "citywide total" are in play and both are asserted:

* ``total`` (all nine modes) — what the day artefacts ship as `citywide_obs`,
  and what `daily_full.parquet` independently agrees with.
* ``six-mode`` (total minus ogv1, ogv2, e_scooter) — the figure quoted in the
  project brief. Kept as a second assertion so the two never drift apart
  unnoticed.
"""

from __future__ import annotations

import duckdb

from . import config

# date -> (all-nine-mode total, six-mode total as quoted in the brief)
CITYWIDE = {
    "2025-10-16": (1_434_168, 1_412_584),
    "2025-10-23": (818_706, 805_729),
    "2025-10-30": (1_458_651, 1_436_758),
}
MIDDAY_PED_CAR = {"2025-10-16": 0.815, "2025-10-23": 0.238}

# What actually reaches the screen, which is NOT the parquet total above: the
# day file sums only lines that have geometry AND a non-zero expectation, so a
# regression in the reindex, the countline index or the basis mask moves this
# and not CITYWIDE. Asserting both is what makes the gap visible rather than
# silent.
SHIPPED_CITYWIDE_OBS = {
    "2025-10-16": 1_428_674,
    "2025-10-23": 806_399,
}
EXPECTED_PARTIAL_DATES = ["2025-10-04", "2025-10-05"]


def run(con: duckdb.DuckDBPyConnection, cal_2025) -> list[str]:
    """Raises AssertionError on drift. Returns human lines for the summary."""
    out: list[str] = []
    src = config.HOURLY_2025
    six = " + ".join(m for m in config.ALL_MODES
                     if m not in ("ogv1", "ogv2", "e_scooter"))
    allm = " + ".join(config.ALL_MODES)

    for d, (want_all, want_six) in CITYWIDE.items():
        got_all, got_six = con.execute(
            f"select sum({allm}), sum({six}) from '{src}' where countline_date = ?", [d]
        ).fetchone()
        assert round(got_all) == want_all, f"{d} all-mode total {got_all} != {want_all}"
        assert round(got_six) == want_six, f"{d} six-mode total {got_six} != {want_six}"
        out.append(f"  citywide {d}: {want_all:,} (all modes) / {want_six:,} (brief's six)")

    for d, want in MIDDAY_PED_CAR.items():
        got, = con.execute(
            f"select sum(pedestrian)/sum(car) from '{src}' "
            "where countline_date = ? and cast(countline_hour as int) = 12", [d]
        ).fetchone()
        assert round(got, 3) == want, f"{d} midday ped:car {got:.3f} != {want}"
        out.append(f"  midday ped:car {d}: {want}")

    got_partial = cal_2025.partial_dates()
    assert got_partial == EXPECTED_PARTIAL_DATES, \
        f"coverage guard flagged {got_partial}, expected {EXPECTED_PARTIAL_DATES}"
    assert "2025-10-23" not in got_partial, "coverage guard must NOT flag the event day"
    out.append(f"  coverage guard flags exactly {got_partial}, and not 2025-10-23")
    return out


def check_day(day: dict) -> None:
    """Structural invariants every day artefact must hold."""
    n = day["n"]
    assert len(day["line_index"]) == n
    assert len(day["lines"]) == n
    for block in ("actual", "expected"):
        for s, arr in day[block].items():
            assert len(arr) == n * 24, f"{day['date']} {block}.{s} wrong length"
    if day["verdict"] == "refused":
        assert day["refusal"] is not None
        assert all(ln["diagnosis"] == "not_observed" for ln in day["lines"]), \
            f"{day['date']} refused but has a scored line"
        assert all(ln["confidence"] == "low" for ln in day["lines"])
        assert all("partial_hours" in ln["caveats"] for ln in day["lines"])
        assert day["summary"]["lines_assessed"] == 0
    else:
        assert day["coverage"]["hours_reported"] >= config.PARAMS.coverage_min_hours

    want = SHIPPED_CITYWIDE_OBS.get(day["date"])
    if want is not None:
        got = day["summary"]["citywide_obs"]
        assert got == want, f"{day['date']} shipped citywide_obs {got:,} != {want:,}"

    # The list under the "Went up" heading must contain only lines that went up.
    by_ci = {ln["ci"]: ln for ln in day["lines"]}
    for ci in day["summary"]["risers"]:
        assert by_ci[ci]["delta_pct"] > 0, \
            f"{day['date']} riser {ci} has delta {by_ci[ci]['delta_pct']}"
