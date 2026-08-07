"""The robust expected value: median + scaled MAD per (countline, hour, mode).

Computed independently for each target day over a clean pool of same-weekday
days (see `daycal`). Four gates sit on top of the raw statistics, and each one
exists because of a specific failure observed in this dataset:

* **Sensor age** — a line contributes to its own baseline only on days it was
  actually live. Without this every newly installed countline reads as an
  infinite riser. The Aro St lines (57228-57231, installed 2025-10-17) have
  their first ever Thursday *on* 23 Oct, so their true `baseline_n` is 0.
* **Intermittency** — `reporting_rate` below 0.6 forces confidence to low.
  Johnston St crossing otherwise reads +570% purely from having been offline
  for most of the baseline and coming back.
* **Scorability floors** — `baseline_n >= 5`, `expected >= 5/hr`. A quiet line
  must not fire nightly.
* **Per-mode viability** — ~70 of ~390 active countlines never see a car at
  all. Without a per-line per-mode gate a fifth of the network reports "cars
  vanished" forever.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import config
from .grid import HOURS, SERIES, SERIES_IX, Cube

P = config.PARAMS


def _masked(values: np.ndarray, live: np.ndarray) -> np.ndarray:
    """values (D,L,...) with non-live (day, line) pairs set to NaN so the
    median ignores them instead of being dragged toward zero. `live` must
    broadcast against `values`."""
    return np.where(live, values.astype(np.float64), np.nan)


def _median_mad(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Median and MAD over axis 0, ignoring NaN. Returns (median, scaled MAD)
    with the MAD floored at max(2.0, 0.10*median) so a deterministically quiet
    line cannot generate an infinite z."""
    with np.errstate(all="ignore"):
        med = np.nanmedian(x, axis=0)
        mad = np.nanmedian(np.abs(x - med), axis=0) * P.mad_scale
    med = np.nan_to_num(med, nan=0.0)
    mad = np.nan_to_num(mad, nan=0.0)
    floor = np.maximum(P.mad_floor_abs, P.mad_floor_frac * med)
    return med, np.maximum(mad, floor)


@dataclass(frozen=True)
class Baseline:
    """All baseline statistics for one target day, aligned to `line_ids`."""

    dates: list[str]                 # the retained pool
    line_ids: list[str]
    expected: np.ndarray             # (L, 24, S) median
    spread: np.ndarray               # (L, 24, S) scaled, floored MAD
    day_expected: np.ndarray         # (L, S) median of day totals
    day_spread: np.ndarray           # (L, S) scaled, floored MAD of day totals
    baseline_n: np.ndarray           # (L,)  days the line was actually live
    reporting_rate: np.ndarray       # (L,)  fraction of pool days with >=20h
    viable: np.ndarray               # (L, S) per-mode viability gate
    mode_hour_mean: np.ndarray       # (L, S) robust baseline rate/hr over 07-19

    @property
    def n_days(self) -> int:
        return len(self.dates)

    def scorable(self) -> np.ndarray:
        """(L, 24) — cells the UI is allowed to call an anomaly on.

        Everything else ships with its numbers intact but must render as
        "cannot see", never as an anomaly.
        """
        line_ok = (self.baseline_n >= P.min_baseline_n) & \
                  (self.reporting_rate >= P.min_reporting_rate)
        cell_ok = self.expected[:, :, SERIES_IX["total"]] >= P.expected_floor_per_hour
        return line_ok[:, None] & cell_ok

    def line_scorable(self) -> np.ndarray:
        """(L,) — is the line's *day total* fit to be scored at all?"""
        return (
            (self.baseline_n >= P.min_baseline_n)
            & (self.reporting_rate >= P.min_reporting_rate)
            & (self.day_expected[:, SERIES_IX["total"]]
               >= P.expected_floor_per_hour * HOURS)
        )


def compute(cube: Cube) -> Baseline:
    """`cube` must contain only the retained baseline days, in order."""
    L, S = len(cube.line_ids), len(SERIES)

    if cube.values.shape[0] == 0:  # no qualifying pool at all
        z = np.zeros
        return Baseline(
            dates=[], line_ids=list(cube.line_ids),
            expected=z((L, HOURS, S)), spread=np.full((L, HOURS, S), P.mad_floor_abs),
            day_expected=z((L, S)), day_spread=np.full((L, S), P.mad_floor_abs),
            baseline_n=z(L, dtype=int), reporting_rate=z(L),
            viable=z((L, S), dtype=bool), mode_hour_mean=z((L, S)),
        )

    live = cube.live()                       # (D, L)
    live_hw = live[:, :, None, None]         # broadcast over hour + series

    hourly = _masked(cube.values, live_hw)   # (D, L, 24, S)
    expected, spread = _median_mad(hourly)

    day_tot = cube.values.sum(axis=2)        # (D, L, S)
    day_expected, day_spread = _median_mad(_masked(day_tot, live[:, :, None]))

    baseline_n = live.sum(axis=0).astype(int)
    reporting_rate = cube.full_days().mean(axis=0)

    # Per-mode viability: mean counts/hr over the daytime window, across live
    # days only. Measured on the 23 Oct pool this leaves 173/372 lines viable
    # for car, 235 for pedestrian, and only 63 for both.
    # Robust on purpose: mean ACROSS the daytime window, median ACROSS days.
    # A plain nanmean over both axes lets a single freak day carry a line
    # through a gate the median `expected` then contradicts — Johnston St road
    # has pedestrian day totals [5,4,2,3,5,6,2571] and cleared the gate at
    # 27.6/hr against a median expectation of 5/day, shipping +8280% at high
    # confidence. Using the same estimator as `expected` lifts the minimum
    # viable pedestrian expectation from 2 to 72.
    lo, hi = P.mode_viability_hours
    with np.errstate(all="ignore"):
        mode_hour_mean = np.nan_to_num(
            np.nanmedian(np.nanmean(hourly[:, :, lo:hi + 1, :], axis=2), axis=0), nan=0.0
        )
    viable = mode_hour_mean >= P.mode_viability_min_per_hour

    return Baseline(
        dates=list(cube.dates), line_ids=list(cube.line_ids),
        expected=expected, spread=spread,
        day_expected=day_expected, day_spread=day_spread,
        baseline_n=baseline_n, reporting_rate=reporting_rate,
        viable=viable, mode_hour_mean=mode_hour_mean,
    )
