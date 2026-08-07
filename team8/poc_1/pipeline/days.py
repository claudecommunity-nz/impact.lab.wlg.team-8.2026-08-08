"""Per-day artefacts: the pulse map, the ghost overlay and the evidence.

One file per shipped day. Two verdicts:

* ``assessed`` — the day reported >= 22 distinct citywide hours, so lines get
  scored and typed.
* ``refused`` — it did not. The matrices are still shipped so the map can grey
  out truthfully, but every `scorable` bit is 0, every diagnosis is
  `not_observed`, and a `refusal` block carries the naive delta the tool
  declined to report. This check sits upstream of every anomaly path, so it
  cannot be bypassed.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import duckdb
import numpy as np

from . import config, diagnose, grid
from .baseline import Baseline, compute as compute_baseline
from .daycal import DayCalendar
from .grid import HOURS, SERIES, SERIES_IX, Cube
from .index import CountlineIndex, ids_present

P = config.PARAMS
REFUSAL_MESSAGE = (
    "The feed delivered {h} of 24 hours. The missing volume is missing data, "
    "not missing people. No anomaly is claimed for this day."
)
SEAM_NOTE = (
    "This gap is one continuous ~24h ingest truncation running 2025-10-04 13:00 "
    "to 2025-10-05 12:00. {partner} is the other half of the same seam, not a "
    "second event."
)
SEAM_PARTNERS = {"2025-10-04": "2025-10-05", "2025-10-05": "2025-10-04"}


def _pct(obs: float, exp: float) -> float | None:
    return None if exp <= 0 else round((obs - exp) / exp * 100.0, 1)


def _ints(a: np.ndarray) -> list[int]:
    """Flatten line-major and round to int. Halves the payload versus floats
    and nothing downstream needs sub-count precision."""
    return np.rint(a).astype(np.int64).reshape(-1).tolist()


def build_day(
    con: duckdb.DuckDBPyConnection,
    source: Path,
    target: str,
    cal: DayCalendar,
    cindex: CountlineIndex,
    role: str,
) -> dict:
    """Build one day artefact. Returns the dict; the caller writes it."""
    day_ids = [c for c in ids_present(con, source, [target]) if c in cindex.rows]
    day_ids.sort(key=cindex.pos)
    n = len(day_ids)

    pool = cal.baseline_dates(target)
    day_cube = grid.load_cube(con, source, [target], day_ids)
    base_cube = grid.load_cube(con, source, pool, day_ids) if pool else \
        Cube([], day_ids, np.zeros((0, n, HOURS, len(SERIES)), np.float32),
             np.zeros((0, n, HOURS), bool))
    bl = compute_baseline(base_cube)

    actual, reported = day_cube.day(target)          # (n,24,S), (n,24)
    refused = cal.is_partial(target)
    hours_present = cal.hours_present(con, target)
    hours_missing = [h for h in range(HOURS) if h not in hours_present]

    scorable = np.zeros((n, HOURS), bool) if refused else bl.scorable()

    lines = _build_lines(day_ids, cindex, actual, reported, bl, refused)
    summary = _summarise(lines, actual, reported, bl, cindex, refused)
    summary["neighbour_check"] = _neighbour_check(con, source, target, cal)

    out: dict = {
        "version": 1,
        "date": target,
        "weekday": date.fromisoformat(target).strftime("%A"),
        "verdict": "refused" if refused else "assessed",
        "refusal": _refusal(target, hours_present, hours_missing, actual, bl) if refused else None,
        "n": n,
        "line_index": [cindex.pos(c) for c in day_ids],
        "layout": {"order": "line_major", "stride": HOURS,
                   "length": n * HOURS, "cell": "value[i*24 + hour]"},
        "coverage": {
            "hours_reported": len(hours_present),
            "hours_missing": hours_missing,
            "lines_reporting": int(reported.any(axis=1).sum()),
            "lines_in_index": n,
            "cells_present": int(reported.sum()),
            "cells_expected": n * HOURS,
            "cell_presence_pct": round(float(reported.mean()) * 100, 1),
            "note": (
                "cells_present counts cells the feed actually delivered. The "
                "matrices below are zero-filled onto the full grid — use the "
                "`reported` bitset to tell no traffic from no sensor."
            ),
        },
        "actual": {s: _ints(actual[:, :, SERIES_IX[s]]) for s in SERIES},
        "expected": {s: _ints(bl.expected[:, :, SERIES_IX[s]]) for s in SERIES},
        "expected_mad": {s: _ints(bl.spread[:, :, SERIES_IX[s]])
                         for s in config.SCORED_SERIES},
        "reported": grid.pack_bits(reported),
        "scorable": grid.pack_bits(scorable),
        "baseline": {
            "dates": pool,
            "n_days": len(pool),
            "weekday": date.fromisoformat(target).strftime("%A"),
            "excluded": {
                d: ("partial_ingest" if cal.is_partial(d) else cal.holidays[d])
                for d in sorted(cal.hours)
                if date.fromisoformat(d).weekday() == date.fromisoformat(target).weekday()
                and d < target and not cal.eligible(d)
            },
        },
        "lines": lines,
        "summary": summary,
    }
    if role == "latest":
        out["freshness"] = {
            "feed_lag_days": 1,
            "as_of": target,
            "note": ("Newest data available. The feed is next-morning; this tool "
                     "cannot detect anything happening right now."),
        }
    return out


def _neighbour_check(con, source, target: str, cal: DayCalendar) -> dict:
    """The simplest possible sanity check, alongside the robust one.

    Raw citywide totals for the target and the nearest eligible same-weekday day
    either side — no baseline, no gates, no line filtering. It reproduces the
    figure quoted in the brief (23 Oct vs 16 and 30 Oct = -43%) and exists so a
    sceptical viewer can check the robust number against arithmetic they can do
    in their head. Differs slightly from citywide_delta_pct, which is a median
    over the full qualifying pool and drops countlines that have no geometry.
    """
    t = date.fromisoformat(target)
    same_wd = sorted(d for d in cal.hours
                     if date.fromisoformat(d).weekday() == t.weekday() and cal.eligible(d))
    before = [d for d in same_wd if d < target][-1:]
    after = [d for d in same_wd if d > target][:1]
    peers = before + after
    if not peers:
        return {"peers": [], "note": "No eligible same-weekday neighbour in this window."}

    total_sql = " + ".join(config.ALL_MODES)
    q = (f"select cast(countline_date as varchar), sum({total_sql}) from '{source}' "
         f"where countline_date in ({','.join('?' * (len(peers) + 1))}) group by 1")
    totals = dict(con.execute(q, peers + [target]).fetchall())
    obs = float(totals.get(target, 0))
    peer_vals = [float(totals[p]) for p in peers if p in totals]
    mean = sum(peer_vals) / len(peer_vals)
    return {
        "peers": peers,
        "peer_totals": [int(v) for v in peer_vals],
        # Per-peer as well as the mean: a neighbour can itself be the anomalous
        # day (16 Oct's later neighbour IS 23 Oct), and averaging that in
        # silently is exactly the sort of thing this tool is meant not to do.
        "peer_deltas_pct": [_pct(obs, v) for v in peer_vals],
        "raw_obs": int(obs),
        "delta_pct": _pct(obs, mean),
        "note": ("Raw citywide totals, all countlines, no baseline and no gates — "
                 "a check anyone can redo by hand. Peers are the nearest eligible "
                 "same-weekday days either side and are not themselves vetted for "
                 "being ordinary; read peer_deltas_pct, not just the mean."),
    }


def _expected_over_reported(bl: Baseline, reported: np.ndarray) -> np.ndarray:
    """Day expectation restricted to the hours the feed actually delivered.

    The matrices are zero-filled onto the full grid, so `actual.sum(axis=1)` is
    already a sum over reported hours only — but the denominator was the whole
    day. That renders a gap as a zero in the one number people read: on 23 Oct
    `Miramar Ave path right hand side` shipped -81.1% off four reported hours,
    where those same four hours were dead on expected; `Hutt Rd path` shipped
    -83.3% against a true +100%. 45 scored countlines moved >=5pp, several
    inverting sign.

    Prorating rather than re-summing keeps `day_expected`'s estimator, which is
    a median of day TOTALS and deliberately not a sum of hourly medians (see
    baseline.py). The share is the fraction of a normal day's hourly expectation
    that falls inside the delivered hours; a line that reported all 24 gets 1.0
    and is untouched, which is 96% of them.
    """
    hourly = bl.expected                                     # (n, 24, S)
    kept = np.sum(hourly * reported[:, :, None], axis=1)     # (n, S)
    whole = np.sum(hourly, axis=1)                           # (n, S)
    share = np.divide(kept, whole, out=np.ones_like(whole), where=whole > 0)
    return bl.day_expected * share


def _build_lines(day_ids, cindex, actual, reported, bl: Baseline, refused: bool) -> list[dict]:
    tot_ix = SERIES_IX["total"]
    day_obs = actual.sum(axis=1)                 # (n, S)
    day_exp = _expected_over_reported(bl, reported)
    hours_reported = reported.sum(axis=1)        # (n,)
    line_ok = bl.line_scorable()

    lines: list[dict] = []
    for i, cid in enumerate(day_ids):
        obs = float(day_obs[i, tot_ix])
        exp = float(day_exp[i, tot_ix])
        # z stays on the whole-day spread: MAD is an estimate of how far a day
        # total normally strays, and there is no partial-day version of it.
        spread = float(bl.day_spread[i, tot_ix])
        z = round((obs - exp) / spread, 1) if spread > 0 else 0.0

        modes = {}
        for m in config.MASS_MODES:
            mi = SERIES_IX[m]
            viable = bool(bl.viable[i, mi]) and not refused
            modes[m] = {
                "obs": int(round(day_obs[i, mi])),
                "exp": int(round(day_exp[i, mi])),
                "delta_pct": _pct(day_obs[i, mi], day_exp[i, mi]) if viable else None,
                "viable": viable,
            }

        scorable_line = bool(line_ok[i]) and not refused
        diagnosis, reason = diagnose.classify(
            ped=modes["pedestrian"]["delta_pct"],
            car=modes["car"]["delta_pct"],
            z=z, scorable=scorable_line, observed_day=not refused,
            ped_exp=float(bl.day_expected[i, SERIES_IX["pedestrian"]]),
        )
        cav = diagnose.caveats(
            baseline_n=int(bl.baseline_n[i]),
            reporting_rate=float(bl.reporting_rate[i]),
            hours_reported=int(hours_reported[i]),
            day_expected_total=exp,
            viable_count=sum(m["viable"] for m in modes.values()),
            day_partial=refused,
        )
        confidence = "high" if (
            scorable_line
            and bl.reporting_rate[i] >= P.min_reporting_rate
            and bl.baseline_n[i] >= P.min_baseline_n
            and not refused
        ) else "low"

        lines.append({
            "i": i,
            "ci": cindex.pos(cid),
            "obs": int(round(obs)),
            "exp": int(round(exp)),
            "delta_pct": _pct(obs, exp),
            "z": z,
            "baseline_n": int(bl.baseline_n[i]),
            "hours_reported": int(hours_reported[i]),
            "reporting_rate": round(float(bl.reporting_rate[i]), 2),
            "diagnosis": diagnosis,
            "diagnosis_reason": reason,
            "confidence": confidence,
            "modes": modes,
            "caveats": cav,
        })
    return lines


def _summarise(lines, actual, reported, bl: Baseline, cindex, refused: bool) -> dict:
    tot_ix = SERIES_IX["total"]
    # Numerator and denominator must cover the same lines or the ratio is not a
    # comparison. Four lines on 23 Oct carry 8,490 counts against an expectation
    # of zero; including them on one side only moved the headline -40.3 -> -40.9.
    # …and the same hours, which is what _expected_over_reported buys. Citywide
    # that is worth 0.2pp; per countline it inverts signs.
    basis = bl.day_expected[:, tot_ix] > 0
    day_exp = _expected_over_reported(bl, reported)
    obs = int(round(actual[basis, :, tot_ix].sum()))
    exp = int(round(day_exp[basis, tot_ix].sum()))
    delta = _pct(obs, exp)

    counts: dict[str, int] = {d: 0 for d in diagnose.DIAGNOSES}
    for ln in lines:
        counts[ln["diagnosis"]] += 1

    high = [ln for ln in lines if ln["confidence"] == "high" and ln["delta_pct"] is not None]
    ranked = sorted(high, key=lambda x: x["delta_pct"])
    worst = [ln["ci"] for ln in ranked[:10]]
    # A riser is a line that ROSE. Ranking by delta and taking the top ten put
    # eight lines that fell under a heading reading "Went up".
    risers = [ln["ci"] for ln in reversed(ranked) if ln["delta_pct"] > 0][:10]
    # The near-normal tail, kept on screen but under its own honest heading.
    least_affected = [ln["ci"] for ln in reversed(ranked) if ln["delta_pct"] <= 0][:10]

    if refused:
        headline = "Not assessed — the feed did not deliver enough of the day to look at."
    elif delta is None:
        headline = "No usable citywide baseline for this day."
    elif delta <= -20:
        headline = (f"Citywide movement {delta:+.0f}% against the expected rhythm, "
                    f"across {len(high)} confidently-scored countlines.")
    elif delta >= 20:
        headline = f"Citywide movement {delta:+.0f}% above the expected rhythm."
    else:
        headline = (f"An ordinary day: citywide movement {delta:+.0f}% against "
                    "the expected rhythm.")

    return {
        "citywide_obs": obs,
        "citywide_exp": exp,
        # Deliberately null on a refused day. The only place the number appears
        # is refusal.naive_delta_pct, labelled as the alert we declined — so no
        # UI can accidentally render an ingest gap as a citywide drop.
        "citywide_delta_pct": None if refused else delta,
        "citywide_basis_lines": int(basis.sum()),
        "lines_assessed": len(high),
        "lines_unscorable": len(lines) - len(high),
        "diagnosis_counts": counts,
        "headline": headline,
        "worst": worst,
        "risers": risers,
        "least_affected": least_affected,
        "lines_ranked": len(high),
        "note": ("worst/risers list only confidence='high' lines. A brand-new or "
                 "intermittent sensor can post a huge percentage and is deliberately "
                 "kept out of both lists. `risers` contains only lines that actually "
                 "rose, so it is often short or empty."),
    }


def _refusal(target, hours_present, hours_missing, actual, bl: Baseline) -> dict:
    """What a detector *without* the coverage guard would have fired, shipped
    deliberately so the demo can show the alert we declined rather than merely
    assert we would have."""
    tot_ix = SERIES_IX["total"]
    obs = float(actual[:, :, tot_ix].sum())
    exp = float(bl.day_expected[:, tot_ix].sum())
    out = {
        "reason": "partial_ingest",
        "hours_reported": len(hours_present),
        "hours_present": hours_present,
        "hours_missing": hours_missing,
        "threshold": P.coverage_min_hours,
        "naive_delta_pct": _pct(obs, exp),
        "message": REFUSAL_MESSAGE.format(h=len(hours_present)),
    }
    if target in SEAM_PARTNERS:
        partner = SEAM_PARTNERS[target]
        out["seam"] = {"note": SEAM_NOTE.format(partner=partner), "partner_date": partner}
    return out
