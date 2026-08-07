"""The ECG: citywide hourly volume as one continuous trace.

A normal week is a clean repeating waveform. On 23 Oct 2025 it flattens. On
4-5 Oct it is *cut* — and that is the point of the `flags` array: a partial
ingest hour is flagged 1 and must be drawn as a gap in the line, never as a low
value. Drawing missing data as a low reading is exactly the mistake the tool
exists to refuse.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import duckdb
import numpy as np

from . import config
from .daycal import DayCalendar

P = config.PARAMS
HOURS = 24
SERIES = ("total", "pedestrian", "car")

FLAG_OK, FLAG_PARTIAL, FLAG_HOLIDAY, FLAG_NO_BASELINE = 0, 1, 2, 3


def _dates(start: str, end: str) -> list[str]:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return [(a + timedelta(days=i)).isoformat() for i in range((b - a).days + 1)]


def _citywide(con: duckdb.DuckDBPyConnection, source: Path,
              dates: list[str]) -> dict[str, np.ndarray]:
    """{date: (24, 3)} citywide hourly totals. Summing is invariant to the
    zero-fill, so no reindex is needed here — only per-cell medians care."""
    rows = con.execute(
        f"""
        select cast(countline_date as varchar) d, cast(countline_hour as int) h,
               sum({' + '.join(config.ALL_MODES)}) total,
               sum(pedestrian) pedestrian, sum(car) car
        from '{source}'
        where countline_date between ? and ?
        group by 1, 2
        """,
        [min(dates), max(dates)],
    ).fetchall()
    out = {d: np.zeros((HOURS, len(SERIES))) for d in dates}
    for d, h, t, p, c in rows:
        if d in out:
            out[d][h] = (t, p, c)
    return out


def build(con: duckdb.DuckDBPyConnection, source: Path, cal: DayCalendar,
          start: str, end: str) -> dict:
    dates = _dates(start, end)
    # Pull the trailing window too, so early dates in the trace still have a pool.
    lo = (date.fromisoformat(start) - timedelta(days=P.window_days)).isoformat()
    wide = _citywide(con, source, _dates(lo, end))

    H = len(dates) * HOURS
    actual = np.zeros((H, len(SERIES)))
    expected = np.zeros((H, len(SERIES)))
    band_lo = np.zeros((H, len(SERIES)))
    band_hi = np.zeros((H, len(SERIES)))
    flags = np.zeros(H, dtype=np.int64)

    day_index = []
    for di, d in enumerate(dates):
        sl = slice(di * HOURS, (di + 1) * HOURS)
        actual[sl] = wide.get(d, np.zeros((HOURS, len(SERIES))))

        pool = [wide[p] for p in cal.baseline_dates(d) if p in wide]
        if pool:
            stack = np.stack(pool)                       # (P, 24, 3)
            expected[sl] = np.median(stack, axis=0)
            band_lo[sl] = np.percentile(stack, 10, axis=0)
            band_hi[sl] = np.percentile(stack, 90, axis=0)

        if cal.is_partial(d):
            f = FLAG_PARTIAL
        elif cal.is_holiday(d):
            f = FLAG_HOLIDAY
        elif len(pool) < P.min_baseline_n:
            f = FLAG_NO_BASELINE
        else:
            f = FLAG_OK
        flags[sl] = f
        # Hours the feed never delivered are a gap regardless of the day verdict.
        present = np.asarray(wide.get(d, np.zeros((HOURS, 1))))[:, 0] > 0
        flags[sl] = np.where(present, flags[sl], FLAG_PARTIAL)

        total = float(actual[sl, 0].sum())
        exp_total = float(expected[sl, 0].sum())
        day_index.append({
            "date": d,
            "offset": di * HOURS,
            "weekday": date.fromisoformat(d).strftime("%A"),
            "verdict": ("refused" if cal.is_partial(d)
                        else "excluded" if cal.is_holiday(d) else "assessed"),
            "total": int(round(total)),
            "delta_pct": (None if exp_total <= 0 or cal.is_partial(d)
                          else round((total - exp_total) / exp_total * 100, 1)),
            "marker": _marker(d, cal),
        })

    ints = lambda a, i: np.rint(a[:, i]).astype(np.int64).tolist()  # noqa: E731
    return {
        "version": 1,
        "start": start,
        "end": end,
        "tz": "Pacific/Auckland",
        "hours": H,
        "t0": f"{start}T00:00:00",
        "actual": {s: ints(actual, i) for i, s in enumerate(SERIES)},
        "expected": {s: ints(expected, i) for i, s in enumerate(SERIES)},
        "band_lo": {s: ints(band_lo, i) for i, s in enumerate(SERIES)},
        "band_hi": {s: ints(band_hi, i) for i, s in enumerate(SERIES)},
        "flags": flags.tolist(),
        "flag_legend": {
            "0": "scorable",
            "1": "partial ingest — render as a gap in the line, NEVER as a low value",
            "2": "holiday, excluded from baselines",
            "3": "insufficient baseline",
        },
        "day_index": day_index,
    }


def _marker(d: str, cal: DayCalendar) -> dict | None:
    if cal.is_partial(d):
        return {"kind": "ingest_gap", "label": f"Feed delivered {cal.hours.get(d, 0)} of 24 hours"}
    if cal.is_holiday(d):
        return {"kind": "holiday", "label": cal.holidays[d]}
    if d == "2025-10-23":
        return {"kind": "warning", "label": "MetService RED severe wind warning, 08:00-18:00"}
    return None
