"""The countline index — the one file that defines ordering.

Every per-hour array in every day file is *positional* against `countlines.json`.
`countline_id` is the only stable key: names are not unique (two distinct ids
are both called "Aro St path right hand side"), so nothing may key off a name.

Shipped as parallel typed arrays rather than an array of objects so the
frontend can build deck.gl buffers without a reshape.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import duckdb

from . import config

_CBD = {(False, False): 0, (True, False): 1, (False, True): 2, (True, True): 3}


@dataclass(frozen=True)
class CountlineIndex:
    ids: list[str]
    rows: dict[str, dict]          # countline_id -> meta row
    dropped: list[str]             # ids seen in movement data but absent from meta

    def pos(self, cid: str) -> int:
        return self._pos[cid]

    def __post_init__(self):
        object.__setattr__(self, "_pos", {c: i for i, c in enumerate(self.ids)})

    def to_json(self) -> dict:
        rows = [self.rows[c] for c in self.ids]
        return {
            "version": 2,
            "n": len(self.ids),
            "ids": self.ids,
            "names": [r["name"] for r in rows],
            # The vendor's camera. One viewpoint carries a median of 3 countlines
            # — one per direction, per lane, per path-vs-road — so drawing every
            # countline stacks two or three marks on the same 5 m of street. The
            # UI rolls up on this to get one mark per real place.
            "viewpoint": [r["viewpoint"] for r in rows],
            "geom": [r["geom"] for r in rows],
            "mid": [r["mid"] for r in rows],
            "cbd": [r["cbd"] for r in rows],
            "group": [r["group"] for r in rows],
            "first_seen": [r["first_seen"] for r in rows],
            "last_seen": [r["last_seen"] for r in rows],
            "active": [r["active"] for r in rows],
            "note": (
                "Positional index. Every per-hour array in every day file is "
                "indexed against this file via that day's line_index. "
                f"{len(self.dropped)} countline(s) appearing in the movement feed "
                "have no meta row and are excluded — they have no geometry to draw."
            ),
        }


def ids_present(con: duckdb.DuckDBPyConnection, source: Path, dates: list[str]) -> list[str]:
    """Countlines that appear in `source` on any of `dates`, sorted."""
    rows = con.execute(
        f"select distinct countline_id from '{source}' "
        f"where countline_date in ({','.join('?' * len(dates))}) order by 1",
        dates,
    ).fetchall()
    return [r[0] for r in rows]


def build(con: duckdb.DuckDBPyConnection, seen: set[str]) -> CountlineIndex:
    """`seen` is the union of countline ids across every shipped day."""
    meta = con.execute(
        f"""
        select countline_id, name, cast(viewpoint_id as varchar) as viewpoint,
               cast(latitude_start_line  as double) as lat0,
               cast(longitude_start_line as double) as lon0,
               cast(latitude_end_line    as double) as lat1,
               cast(longitude_end_line   as double) as lon1,
               cast(earliest as varchar) as earliest,
               cast(latest   as varchar) as latest,
               cbd_entry, cbd_exit, countlines_group
        from '{config.META}'
        """
    ).fetchall()

    rows: dict[str, dict] = {}
    for (cid, name, viewpoint, lat0, lon0, lat1, lon1, earliest, latest,
         cbd_entry, cbd_exit, group) in meta:
        if cid not in seen or None in (lat0, lon0, lat1, lon1):
            continue
        r5 = lambda v: round(float(v), 5)  # noqa: E731
        rows[cid] = {
            "name": name,
            # A countline with no viewpoint is its own site: falling back to the
            # countline id keeps the rollup total, so no line is silently dropped.
            "viewpoint": viewpoint or f"cl:{cid}",
            "geom": [r5(lat0), r5(lon0), r5(lat1), r5(lon1)],
            "mid": [r5((lat0 + lat1) / 2), r5((lon0 + lon1) / 2)],
            "cbd": _CBD[(cbd_entry is not None, cbd_exit is not None)],
            "group": group,
            "first_seen": earliest,
            "last_seen": latest,
            "active": int(latest >= config.ACTIVE_SINCE),
        }

    ids = sorted(rows)
    return CountlineIndex(ids=ids, rows=rows, dropped=sorted(seen - set(ids)))
