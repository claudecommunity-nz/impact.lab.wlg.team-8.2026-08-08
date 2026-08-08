"""The week artefact: a Monday-anchored 168-hour duty-officer brief.

The demo week is the Monday of the newest data through the following Sunday, so
Mon-Thu are confirmed and Fri-Sun are forecast-only. That asymmetry is the whole
point — a duty officer on Friday morning has four settled days behind them and
three modelled days ahead, and the interface has to say which is which.

Three disciplines this module exists to hold:

* **The forecast is out-of-sample.** The baseline pool is built from days
  strictly BEFORE the week starts. If the pool included Monday, Monday's
  "forecast" would be fitted to Monday and the week-to-date comparison would be
  meaningless. Every number for Mon-Thu is therefore a real prediction that the
  actual can disagree with.
* **Missing is not zero.** `actual` carries `null` past the horizon, never 0.
  A JSON zero would render as a catastrophic citywide collapse on Friday.
* **Day-of-week is not applied twice.** `baseline` here is the same-weekday
  same-hour robust median, so the day-of-week rhythm is ALREADY inside it. The
  derived day factors are published for display and used as a verification
  assertion (the baseline must reproduce them), NOT multiplied back in. The
  first draft did multiply them in and Saturday came out 20% below a Saturday
  baseline that was already a Saturday.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np

from . import config
from .daycal import DayCalendar

P = config.PARAMS
HOURS = 24
WEEK_HOURS = 7 * HOURS

# Citywide series shipped per hour. Mirrors SITE_SERIES in web/src/data/derive.ts
# — the UI's mode pills (All / People / Vehicles) read total / pedestrian / veh,
# and the rest are there so a per-mode signature can be read off the same file.
SERIES = ("total", "pedestrian", "cyclist", "car", "bus", "lgv", "veh")

_SERIES_SQL = {
    "total": " + ".join(config.ALL_MODES),
    "pedestrian": "pedestrian",
    "cyclist": "cyclist",
    "car": "car",
    "bus": "bus",
    "lgv": "lgv",
    # Vehicles = car + bus + LGV, matching derive.ts. NOT total - pedestrian.
    "veh": "car + bus + lgv",
}

# z for an 80% central interval. The band is ±1.2816 sigma from the real
# same-weekday same-hour spread, not a flat percentage: at 03:00 the city is
# genuinely erratic and at 08:00 it is metronomic, and a flat ±12% band claims
# the opposite.
Z80 = 1.2815515655446004

# Trend correction window. One scalar, derived: the most recent four weeks of
# citywide volume against the whole pool window. Applied because a baseline
# built over 10 weeks lags a city that has been drifting up or down; kept to a
# single number because anything richer over 66 days of archive is fitting noise.
TREND_DAYS = 28


def _d(s: str) -> date:
    return date.fromisoformat(s)


def _daterange(start: date, end: date) -> list[str]:
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


def _citywide(con: duckdb.DuckDBPyConnection, source: Path,
              lo: str, hi: str) -> dict[str, np.ndarray]:
    """{date: (24, len(SERIES))} citywide hourly totals.

    Summing over every countline is invariant to the zero-fill, so no reindex is
    needed here — only per-cell medians care about the missing-row trap.
    """
    cols = ", ".join(f"sum({sql}) as s_{name}" for name, sql in _SERIES_SQL.items())
    rows = con.execute(
        f"""
        select cast(countline_date as varchar) d, cast(countline_hour as int) h, {cols}
        from '{source}'
        where countline_date between ? and ?
        group by 1, 2
        """,
        [lo, hi],
    ).fetchall()
    out: dict[str, np.ndarray] = {}
    for r in rows:
        d, h = r[0], r[1]
        out.setdefault(d, np.zeros((HOURS, len(SERIES))))[h] = r[2:]
    return out


def _hours_present(con: duckdb.DuckDBPyConnection, source: Path,
                   lo: str, hi: str) -> dict[str, set[int]]:
    """{date: {hours the feed actually delivered}}. The horizon is defined by
    this, not by max(date): a day that stops at 14:00 must not be claimed as 24
    confirmed hours."""
    rows = con.execute(
        f"""select cast(countline_date as varchar) d, cast(countline_hour as int) h
            from '{source}' where countline_date between ? and ? group by 1, 2""",
        [lo, hi],
    ).fetchall()
    out: dict[str, set[int]] = {}
    for d, h in rows:
        out.setdefault(d, set()).add(h)
    return out


def _mad(x: np.ndarray) -> np.ndarray:
    """Scaled MAD over axis 0, floored the same way baseline.py floors it so a
    deterministically quiet hour cannot produce a zero-width band."""
    med = np.median(x, axis=0)
    mad = np.median(np.abs(x - med), axis=0) * P.mad_scale
    return np.maximum(mad, np.maximum(P.mad_floor_abs, P.mad_floor_frac * med))


def _pool_dates(cal: DayCalendar, week_start: date, weekday: int,
                available: set[str]) -> list[str]:
    """Eligible same-weekday days strictly before the week starts.

    `< week_start`, not `< target` — that is what makes the whole week a single
    out-of-sample forecast rather than four days of hindsight and three of
    prediction.
    """
    lo = week_start - timedelta(days=P.window_days)
    pool = sorted(
        d for d in available
        if lo <= _d(d) < week_start
        and _d(d).weekday() == weekday
        and cal.eligible(d)
    )
    return pool[-P.max_occurrences:]


def _day_factors(cal: DayCalendar, wide: dict[str, np.ndarray],
                 week_start: date) -> dict:
    """Derived day-of-week rhythm: each weekday's median citywide day total
    against the median across all eligible days.

    Published, not applied — see the module docstring. The mock this design came
    from used [1.00, 1.03, 1.06, 1.04, 1.14, 0.80, 0.62]; Wellington's real
    archive is far flatter, which is itself worth showing.
    """
    lo = week_start - timedelta(days=P.window_days)
    by_wd: dict[int, list[float]] = {}
    for d, arr in wide.items():
        if not (lo <= _d(d) < week_start and cal.eligible(d)):
            continue
        by_wd.setdefault(_d(d).weekday(), []).append(float(arr[:, 0].sum()))

    all_days = [v for vs in by_wd.values() for v in vs]
    ref = float(np.median(all_days)) if all_days else 0.0
    names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
             "Saturday", "Sunday"]
    return {
        "reference_day_total": int(round(ref)),
        "factor": {names[w]: (round(float(np.median(by_wd[w])) / ref, 3)
                              if ref and w in by_wd else None)
                   for w in range(7)},
        "n_days": {names[w]: len(by_wd.get(w, [])) for w in range(7)},
    }


def build(con: duckdb.DuckDBPyConnection, source: Path, cal: DayCalendar,
          newest: str, advisements: list[dict],
          standing: list[dict]) -> dict:
    """`newest` is the newest date in `source`; the week is its Monday..Sunday."""
    nd = _d(newest)
    week_start = nd - timedelta(days=nd.weekday())
    week_end = week_start + timedelta(days=6)
    dates = _daterange(week_start, week_end)

    # Pool window reaches back before the week; the week itself is read for actuals.
    pool_lo = (week_start - timedelta(days=P.window_days)).isoformat()
    wide = _citywide(con, source, pool_lo, week_end.isoformat())
    present = _hours_present(con, source, week_start.isoformat(), week_end.isoformat())

    S = len(SERIES)
    baseline = np.zeros((WEEK_HOURS, S))
    spread = np.zeros((WEEK_HOURS, S))
    pool_sizes: list[int] = []
    pool_by_day: list[list[str]] = []

    for di, d in enumerate(dates):
        sl = slice(di * HOURS, (di + 1) * HOURS)
        pool = _pool_dates(cal, week_start, _d(d).weekday(), set(wide))
        pool_by_day.append(pool)
        pool_sizes.append(len(pool))
        stack = np.stack([wide[p] for p in pool]) if pool else None
        if stack is not None:
            baseline[sl] = np.median(stack, axis=0)
            spread[sl] = _mad(stack)

    # --- the trend factor, derived ----------------------------------------
    recent = [float(a[:, 0].sum()) for d, a in wide.items()
              if cal.eligible(d) and week_start - timedelta(days=TREND_DAYS)
              <= _d(d) < week_start]
    window = [float(a[:, 0].sum()) for d, a in wide.items()
              if cal.eligible(d) and _d(pool_lo) <= _d(d) < week_start]
    trend = (round(float(np.median(recent)) / float(np.median(window)), 4)
             if recent and window else 1.0)

    # --- named-event multipliers ------------------------------------------
    # One multiplier per hour, seeded at 1.0. Only advisements marked
    # `applied` move it: an illustrative row is allowed to appear in "what to
    # watch" but is never allowed to move a published number.
    event_mult = np.ones(WEEK_HOURS)
    for a in advisements:
        if not a.get("applied"):
            continue
        for h in range(a["hour_from"], a["hour_to"] + 1):
            event_mult[h] *= a["multiplier"]

    forecast = baseline * trend * event_mult[:, None]
    band_lo = np.maximum(0.0, forecast - Z80 * spread)
    band_hi = forecast + Z80 * spread

    # --- the horizon -------------------------------------------------------
    # Walk forward from hour 0 and stop at the first hour the feed did not
    # deliver. Confirmed means an unbroken run: a hole at 40 followed by data at
    # 41 is not "41 confirmed hours", it is a gap we must not paper over.
    confirmed = 0
    for di, d in enumerate(dates):
        got = present.get(d, set())
        for h in range(HOURS):
            if h in got and confirmed == di * HOURS + h:
                confirmed += 1
    actual = np.full((WEEK_HOURS, S), np.nan)
    for di, d in enumerate(dates):
        if d in wide:
            actual[di * HOURS:(di + 1) * HOURS] = wide[d]
    actual[confirmed:] = np.nan

    # --- per-day rollup ----------------------------------------------------
    days = []
    for di, d in enumerate(dates):
        sl = slice(di * HOURS, (di + 1) * HOURS)
        n_conf = int(np.clip(confirmed - di * HOURS, 0, HOURS))
        state = ("confirmed" if n_conf == HOURS
                 else "partial" if n_conf > 0 else "forecast")
        f_tot = forecast[sl].sum(axis=0)
        # Actual-so-far must be compared against forecast-so-far, never against
        # the whole day: a day 8 hours in is not "down 66%".
        f_sofar = forecast[di * HOURS: di * HOURS + n_conf].sum(axis=0)
        a_tot = actual[di * HOURS: di * HOURS + n_conf].sum(axis=0) if n_conf else None

        days.append({
            "date": d,
            "weekday": _d(d).strftime("%A"),
            "short": _d(d).strftime("%a %-d").upper(),
            "dow": _d(d).weekday(),
            "offset": di * HOURS,
            "state": state,
            "confirmed_hours": n_conf,
            "baseline_n": pool_sizes[di],
            "forecast": {s: int(round(f_tot[i])) for i, s in enumerate(SERIES)},
            "forecast_to_date": ({s: int(round(f_sofar[i])) for i, s in enumerate(SERIES)}
                                 if n_conf else None),
            "actual": ({s: int(round(a_tot[i])) for i, s in enumerate(SERIES)}
                       if a_tot is not None else None),
            "deviation_pct": ({s: (round((a_tot[i] - f_sofar[i]) / f_sofar[i] * 100, 1)
                                   if f_sofar[i] > 0 else None)
                               for i, s in enumerate(SERIES)}
                              if a_tot is not None else None),
            "band_lo": {s: int(round(band_lo[sl][:, i].sum())) for i, s in enumerate(SERIES)},
            "band_hi": {s: int(round(band_hi[sl][:, i].sum())) for i, s in enumerate(SERIES)},
        })

    # --- week rollup -------------------------------------------------------
    wk_fc = forecast.sum(axis=0)
    wk_fc_td = forecast[:confirmed].sum(axis=0)
    wk_ac = actual[:confirmed].sum(axis=0)
    week = {
        "forecast": {s: int(round(wk_fc[i])) for i, s in enumerate(SERIES)},
        "forecast_to_date": {s: int(round(wk_fc_td[i])) for i, s in enumerate(SERIES)},
        "actual_to_date": {s: int(round(wk_ac[i])) for i, s in enumerate(SERIES)},
        "deviation_pct": {s: (round((wk_ac[i] - wk_fc_td[i]) / wk_fc_td[i] * 100, 1)
                              if wk_fc_td[i] > 0 else None)
                          for i, s in enumerate(SERIES)},
    }

    ints = lambda a, i: np.rint(a[:, i]).astype(np.int64).tolist()  # noqa: E731

    def nullable(a: np.ndarray, i: int) -> list[int | None]:
        """None past the horizon. Zero-vs-missing is this codebase's founding
        discipline and a 0 here would read as the city stopping on Friday."""
        return [None if np.isnan(v) else int(round(v)) for v in a[:, i]]

    last_hour = (datetime.combine(week_start, datetime.min.time())
                 + timedelta(hours=confirmed - 1)) if confirmed else None

    return {
        "version": 1,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "iso_week": week_start.isocalendar().week,
        "label": (f"WEEK {week_start.isocalendar().week} · "
                  f"{week_start.day}–{week_end.day} {week_end.strftime('%b').upper()}"),
        "tz": "Pacific/Auckland",
        "t0": f"{week_start.isoformat()}T00:00:00",
        "hours": WEEK_HOURS,
        "confirmed_hours": confirmed,
        "horizon": {
            "cursor_index": max(0, confirmed - 1),
            "last_confirmed_hour": last_hour.isoformat(timespec="hours") if last_hour else None,
            "newest_data_date": newest,
            "feed_lag": "T+1",
            "note": ("Hours at and after index {} have no actual and never will "
                     "until the feed catches up. They are null, not zero."
                     .format(confirmed)),
        },
        "series": list(SERIES),
        "series_note": ("`veh` = car + bus + LGV, matching the UI's Vehicles pill. "
                        "In `actual` the modes add up exactly; in `baseline`, "
                        "`forecast` and the band they do NOT, because each series "
                        "gets its own median and medians do not add. Read a series, "
                        "never a sum of series."),
        "baseline": {s: ints(baseline, i) for i, s in enumerate(SERIES)},
        "forecast": {s: ints(forecast, i) for i, s in enumerate(SERIES)},
        "band_lo": {s: ints(band_lo, i) for i, s in enumerate(SERIES)},
        "band_hi": {s: ints(band_hi, i) for i, s in enumerate(SERIES)},
        "actual": {s: nullable(actual, i) for i, s in enumerate(SERIES)},
        "days": days,
        "week": week,
        "day_factors": {
            **_day_factors(cal, wide, week_start),
            "applied_to_forecast": False,
            "note": ("Published for display only. `baseline` is a same-weekday "
                     "same-hour median, so the day-of-week rhythm is already in "
                     "it; multiplying these back in would count it twice."),
        },
        "model": {
            "formula": "forecast = baseline x trend x named_event_multipliers",
            "baseline": ("robust same-weekday same-hour median over eligible days "
                         f"in the {P.window_days} days before the week starts, "
                         f"capped at the most recent {P.max_occurrences} occurrences"),
            "trend_factor": trend,
            "trend_rule": (f"median citywide day total over the {TREND_DAYS} days "
                           "before the week, against the whole pool window"),
            "band": (f"forecast +/- {Z80:.4f} x scaled MAD of the same pool "
                     "(80% central interval), lower bound clamped at 0"),
            "out_of_sample": ("The pool ends the day before the week starts, so "
                              "every hour in the week — including the confirmed "
                              "ones — is compared against a genuine forecast."),
            "events_applied": int(sum(1 for a in advisements if a.get("applied"))),
            "pool_size_by_day": dict(zip(dates, pool_sizes)),
            "pool_dates_by_day": dict(zip(dates, pool_by_day)),
        },
        "advisements": advisements,
        "advisements_note": (
            "Sourced from the WCC scheduled street-event closure layer. The slot is "
            "deliberately pluggable — a stadium calendar, a MetService warning feed "
            "or a cruise-berth schedule lands in the same shape. Nothing is typed "
            "in to fill an empty week: if the feed has nothing, this is empty, and "
            "an empty list means the sources we have are quiet, not that the week is."
        ),
        "standing_conditions": standing,
    }
