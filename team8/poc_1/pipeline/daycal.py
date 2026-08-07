"""Which days are allowed into a baseline.

Two independent exclusions, both load-bearing:

* **Partial ingest.** A day whose citywide distinct-hour count is < 22 is a
  broken feed, not an event. Healthy days report 24; the broken ones report
  11-13. This is also the day-level *verdict* gate — see `is_partial`.
* **Holidays.** The gazette is not enough. Labour Day is -39%, Christmas -59%,
  and the Christmas-New Year dead week does not appear in the gazette at all,
  so we blackout 24 Dec - 5 Jan and the Thursday-Tuesday around Easter too.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import duckdb

from . import config


def _d(s: str) -> date:
    return date.fromisoformat(s)


@lru_cache(maxsize=1)
def gazetted_holidays() -> dict[str, str]:
    """{'YYYY-MM-DD': name} from the fetched NZ holidays file."""
    raw = json.loads((config.CONTEXT_RAW / "nz_holidays.json").read_text())
    return {h["date"]: h["name"] for h in raw}


def _easter_sunday(year: int) -> date:
    """Anonymous Gregorian algorithm. Easter is not in the gazette file by name
    in a form we can key off reliably, and the days either side behave like
    holidays regardless of whether they are gazetted."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    ll = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ll) // 451
    month, day = divmod(h + ll - 7 * m + 114, 31)
    return date(year, month, day + 1)


@lru_cache(maxsize=8)
def blackout_dates(year_lo: int, year_hi: int) -> frozenset[str]:
    """Non-gazetted stretches that behave like holidays."""
    out: set[str] = set()
    for y in range(year_lo - 1, year_hi + 2):
        # Christmas - New Year dead week: 24 Dec through 5 Jan.
        cur = date(y, 12, 24)
        while cur <= date(y + 1, 1, 5):
            out.add(cur.isoformat())
            cur += timedelta(days=1)
        # Easter Thursday through the Tuesday after Easter Monday.
        es = _easter_sunday(y)
        for off in range(-3, 3):
            out.add((es + timedelta(days=off)).isoformat())
    return frozenset(out)


@dataclass(frozen=True)
class DayCalendar:
    """Per-source-parquet calendar: what each date reported, and why it is or
    is not eligible to sit in a baseline."""

    source: Path
    hours: dict[str, int]        # date -> distinct citywide hours reported
    holidays: dict[str, str]     # date -> holiday/blackout name

    # --- predicates --------------------------------------------------------
    def is_partial(self, d: str) -> bool:
        """The coverage guard. Also the day-level refusal test."""
        return self.hours.get(d, 0) < config.PARAMS.coverage_min_hours

    def is_holiday(self, d: str) -> bool:
        return d in self.holidays

    def eligible(self, d: str) -> bool:
        return d in self.hours and not self.is_partial(d) and not self.is_holiday(d)

    def partial_dates(self) -> list[str]:
        return sorted(d for d in self.hours if self.is_partial(d))

    def hours_present(self, con: duckdb.DuckDBPyConnection, d: str) -> list[int]:
        rows = con.execute(
            f"select distinct cast(countline_hour as int) h from '{self.source}' "
            "where countline_date = ? order by h", [d]
        ).fetchall()
        return [r[0] for r in rows]

    def baseline_dates(self, target: str) -> list[str]:
        """Candidate pool for `target`, per contract step 1-2:
        same weekday, strictly before, inside the trailing window, eligible,
        capped at the most recent N occurrences.
        """
        t = _d(target)
        lo = t - timedelta(days=config.PARAMS.window_days)
        pool = [
            d for d in self.hours
            if lo <= _d(d) < t
            and _d(d).weekday() == t.weekday()
            and self.eligible(d)
        ]
        pool.sort()
        return pool[-config.PARAMS.max_occurrences:]


def build_calendar(con: duckdb.DuckDBPyConnection, source: Path) -> DayCalendar:
    rows = con.execute(
        f"""select cast(countline_date as varchar) d,
                   count(distinct cast(countline_hour as int)) h
            from '{source}' group by 1"""
    ).fetchall()
    hours = {d: h for d, h in rows}
    if not hours:
        raise ValueError(f"no rows in {source}")

    years = (min(_d(d).year for d in hours), max(_d(d).year for d in hours))
    gaz = gazetted_holidays()
    black = blackout_dates(*years)
    holidays = {
        d: gaz.get(d, "seasonal blackout")
        for d in hours if d in gaz or d in black
    }
    return DayCalendar(source=source, hours=hours, holidays=holidays)
