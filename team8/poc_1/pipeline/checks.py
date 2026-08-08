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


def check_week(wk: dict) -> None:
    """Structural invariants for the week artefact.

    The one that matters most is the null check. A zero past the horizon renders
    as the city stopping dead on Friday, which is the exact failure this whole
    codebase is built to refuse.
    """
    n, c = wk["hours"], wk["confirmed_hours"]
    assert n == 168, f"week is {n} hours, not 168"
    assert 0 < c <= n, f"confirmed_hours {c} out of range"
    assert len(wk["days"]) == 7

    for block in ("baseline", "forecast", "band_lo", "band_hi", "actual"):
        for s, arr in wk[block].items():
            assert len(arr) == n, f"week.{block}.{s} is {len(arr)}, not {n}"

    for s, arr in wk["actual"].items():
        assert all(v is not None for v in arr[:c]), f"week.actual.{s} holed inside horizon"
        assert all(v is None for v in arr[c:]), \
            f"week.actual.{s} has a value past the horizon — missing must be null, never 0"

    for s in wk["series"]:
        lo, hi, f = wk["band_lo"][s], wk["band_hi"][s], wk["forecast"][s]
        assert all(a <= b <= d for a, b, d in zip(lo, f, hi)), f"week band inverted for {s}"

    # `veh` is car+bus+lgv. In `actual` that is an exact identity; in the
    # forecast it is not, because medians do not add — `veh` is the median of
    # the sum, which is the correct estimator for the sum, and it lands a few
    # percent off the sum of the three medians. Asserted loosely so a real
    # definition drift still fails while the statistics are allowed to be right.
    for i in range(0, c, 13):
        parts = sum(wk["actual"][k][i] for k in ("car", "bus", "lgv"))
        assert parts == wk["actual"]["veh"][i], \
            f"week hour {i}: actual veh {wk['actual']['veh'][i]} != car+bus+lgv {parts}"
    for i in range(0, n, 17):
        parts = sum(wk["forecast"][k][i] for k in ("car", "bus", "lgv"))
        veh = wk["forecast"]["veh"][i]
        assert abs(parts - veh) <= max(10, 0.08 * veh), \
            f"week hour {i}: forecast veh {veh} vs car+bus+lgv {parts} — too far apart"

    # Day factors are published, not applied. If anything ever wires them into
    # the forecast this fails, because the baseline already carries them.
    assert wk["day_factors"]["applied_to_forecast"] is False

    # Every forecast hour must come from a real pool, or the "forecast" is a zero.
    assert all(d["baseline_n"] >= config.PARAMS.min_baseline_n for d in wk["days"]), \
        f"a day has too small a pool: {[(d['short'], d['baseline_n']) for d in wk['days']]}"

    # The claim that day-of-week is already inside the baseline has to be
    # testable, or it is just a comment. The forecast's own day-total rhythm,
    # normalised, must land on the independently derived day factors.
    fc = [d["forecast"]["total"] for d in wk["days"]]
    ref = sorted(fc)[3]
    derived = list(wk["day_factors"]["factor"].values())
    dref = sorted(v for v in derived if v is not None)[3]
    for d, f, g in zip(wk["days"], fc, derived):
        if g is None:
            continue
        assert abs(f / ref - g / dref) < 0.10, (
            f"{d['short']}: baseline rhythm {f / ref:.3f} disagrees with the derived "
            f"day factor {g / dref:.3f} — the two estimates of day-of-week have drifted")

    states = [d["state"] for d in wk["days"]]
    assert states.count("confirmed") + states.count("partial") >= 1
    assert "forecast" in states, "no forecast-only day — the week is not forward-looking"


def check_edges(eg: dict) -> None:
    """Structural invariants for the edge network."""
    n, c = eg["hours"], eg["confirmed_hours"]
    assert eg["n_edges"] > 0, "no edges — the snap or the graph is broken"
    m = eg["measured"]
    assert m["snap_over_cap"] == 0, \
        f"{m['snap_over_cap']} countlines further than the snap cap from any road"
    assert m["snap_max_m"] < 19.0, \
        f"max snap {m['snap_max_m']} m — the 25 m cap was measured at under 19 m"
    for e in eg["edges"]:
        assert e["path"] and all(len(p) >= 2 for p in e["path"]), f"{e['id']} has no geometry"
        assert len(e["forecast_flow"]) == n and len(e["flow"]) == n
        assert all(v is None for v in e["flow"][c:]), \
            f"{e['id']} has flow past the horizon — missing must be null, never 0"
        for k, arr in e["dev"].items():
            assert len(arr) == n, f"{e['id']}.dev.{k} is {len(arr)}, not {n}"
            assert all(v is None for v in arr[c:]), \
                f"{e['id']}.dev.{k} scores an hour with no actual"
        assert len(e["day"]) == 7
        assert e["sensors"] >= 1


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
