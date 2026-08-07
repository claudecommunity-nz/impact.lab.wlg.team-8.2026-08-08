"""The zero-fill reindex. Trap 1, and every downstream number depends on it.

The feed omits a `(countline_id, direction, countline_hour)` cell entirely when
there was no activity. Roughly 10% of the expected grid is absent on a normal
day and 12% on 23 Oct 2025 — so "movement stopped" arrives as row *absence*.

Two things follow, and conflating them is the single most common misreading of
this dataset:

* Missing rows **are zeros in reality**, so we reindex onto the full
  `(line x hour)` cross product and zero-fill before any aggregation.
* Missing rows are **not zeros in the feed**, so we carry a separate boolean
  `reported` per cell all the way to the client. Only that lets the UI say
  "no traffic" versus "sensor offline".

Direction is a compass bearing (N/S/E/W/NE/...), never in/out. It is summed
away here and never exposed.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np

from . import config

HOURS = 24
# Index of each shipped series inside the cube's last axis.
SERIES = config.SHIPPED_SERIES
SERIES_IX = {s: i for i, s in enumerate(SERIES)}


@dataclass(frozen=True)
class Cube:
    """Zero-filled counts on the full grid, plus what the feed actually sent.

    values:   float32 (n_days, n_lines, 24, n_series) — zero-filled
    reported: bool    (n_days, n_lines, 24)           — a row existed
    """

    dates: list[str]
    line_ids: list[str]
    values: np.ndarray
    reported: np.ndarray

    def series(self, name: str) -> np.ndarray:
        return self.values[..., SERIES_IX[name]]

    def day(self, d: str) -> tuple[np.ndarray, np.ndarray]:
        i = self.dates.index(d)
        return self.values[i], self.reported[i]

    def live(self) -> np.ndarray:
        """(n_days, n_lines) — did this line report at least one cell that day?

        This is the sensor-age gate in practice: a countline installed on
        2025-10-17 is simply not live on any earlier day, so it contributes
        nothing to its own baseline instead of contributing a spurious zero.
        """
        return self.reported.any(axis=2)

    def full_days(self) -> np.ndarray:
        """(n_days, n_lines) — did the line report >= 20 of 24 hours?"""
        return self.reported.sum(axis=2) >= config.PARAMS.reporting_day_min_hours


_MODE_SQL = {
    "total": " + ".join(config.ALL_MODES),
    **{m: m for m in config.MASS_MODES},
}


def load_cube(
    con: duckdb.DuckDBPyConnection,
    source: Path,
    dates: list[str],
    line_ids: list[str],
) -> Cube:
    """Read `dates` from `source` and reindex onto the full grid.

    `line_ids` fixes row order — never rely on the order the parquet happens to
    return, and never assume row *i* is the same countline across two days.
    """
    if not dates:
        raise ValueError("load_cube needs at least one date")

    line_ix = {cid: i for i, cid in enumerate(line_ids)}
    date_ix = {d: i for i, d in enumerate(dates)}

    sums = ", ".join(f"sum({sql}) as {name}" for name, sql in _MODE_SQL.items())
    tbl = con.execute(
        f"""
        select countline_id,
               cast(countline_date as varchar) as d,
               cast(countline_hour as int)     as h,   -- countline_hour is a DOUBLE
               {sums}
        from '{source}'
        where countline_date in ({','.join('?' * len(dates))})
        group by 1, 2, 3                                -- collapses direction
        """,
        dates,
    ).arrow().read_all()

    D, L, S = len(dates), len(line_ids), len(SERIES)
    values = np.zeros((D, L, HOURS, S), dtype=np.float32)
    reported = np.zeros((D, L, HOURS), dtype=bool)

    cid = tbl.column("countline_id").to_pylist()
    dd = tbl.column("d").to_pylist()
    hh = np.asarray(tbl.column("h").to_pylist(), dtype=np.int64)

    # Rows referencing a countline outside the index (no meta row) are dropped
    # here; the caller records how many rather than letting them vanish quietly.
    keep = np.fromiter((c in line_ix for c in cid), dtype=bool, count=len(cid))
    di = np.fromiter((date_ix[x] for x in dd), dtype=np.int64, count=len(dd))[keep]
    li = np.fromiter((line_ix[c] for c in cid if c in line_ix), dtype=np.int64,
                     count=int(keep.sum()))
    hi = hh[keep]

    for name in SERIES:
        col = np.asarray(tbl.column(name).to_pylist(), dtype=np.float32)[keep]
        values[di, li, hi, SERIES_IX[name]] = col
    reported[di, li, hi] = True

    return Cube(dates=list(dates), line_ids=list(line_ids),
                values=values, reported=reported)


def pack_bits(mask: np.ndarray) -> str:
    """Pack a boolean grid into an LSB-first bitset, base64 encoded.

    `mask` is flattened line-major (cell = index i*24 + hour), matching the
    `layout` block every day file ships. ~1.1 KB per day per bitset.
    """
    flat = np.asarray(mask, dtype=bool).reshape(-1)
    return base64.b64encode(np.packbits(flat, bitorder="little").tobytes()).decode()
