"""What a duty officer should EXPECT to move the numbers this week.

Two lists, and the difference between them is the point:

* **advisements** — things that will happen, with a window and an expected
  direction. This is the pluggable slot: today it is fed by the WCC street-event
  closure layer, and a stadium calendar, a MetService warning feed or a cruise
  schedule would land in the same shape.
* **standing_conditions** — things that are already true and stay true, which
  suppress or distort the baseline for the whole week. These are DERIVED from
  the feed itself, not typed: which sites went dark, which countlines are too
  new to have a baseline.

Nothing invented is allowed to move a number. An advisement only enters the
forecast when `applied` is true, and only a real sourced record ever gets that.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import duckdb

from . import config

# WCC EventType 1 is a street-event closure. The layer is a snapshot at fetch
# time, so it is what was scheduled when we pulled it, not a live closure feed.
CLOSURE_LAYER = "street-events-road-closures"

# A countline first seen inside this many days of the week start has no usable
# same-weekday pool yet. A naive read calls it a riser out of nothing.
NEW_SITE_DAYS = 42
# A site that reported in this window but is silent in the confirmed week is
# dark, not quiet. The distinction is the whole product.
DARK_LOOKBACK_DAYS = 28


def _ms_to_local(ms: int) -> datetime:
    """The layer stores epoch milliseconds. Rendered in UTC — these are
    all-day-ish scheduling windows, and shifting them to NZT would imply a
    precision the source does not carry."""
    return datetime.fromtimestamp(ms / 1000, timezone.utc).replace(tzinfo=None)


def closures(week_start: date, week_end: date) -> tuple[list[dict], list[dict]]:
    """(advisements, standing) from the real WCC street-events layer.

    A closure that starts inside the week is something to watch. One that has
    been in force for months is a standing condition — it is already inside the
    baseline, and listing it as news would be wrong.
    """
    path = config.GIS_RAW / f"{CLOSURE_LAYER}.geojson"
    feats = json.loads(path.read_text()).get("features", [])
    adv: list[dict] = []
    standing: list[dict] = []

    ws = datetime.combine(week_start, datetime.min.time())
    we = datetime.combine(week_end, datetime.max.time())

    for f in feats:
        p = f["properties"]
        if not p.get("Start_Date") or not p.get("End_Date"):
            continue
        s, e = _ms_to_local(p["Start_Date"]), _ms_to_local(p["End_Date"])
        if e < ws or s > we:
            continue
        item = {
            "source": "wcc-street-events-road-closures",
            "provenance": ("Wellington City Council scheduled street-event closures, "
                           "snapshot at fetch time. Not a live closure feed."),
            "title": (p.get("Event_Name") or "Unnamed closure").strip(),
            "detail": (p.get("EventDetails") or "").strip() or None,
            "starts": s.isoformat(timespec="minutes"),
            "ends": e.isoformat(timespec="minutes"),
        }
        if s >= ws:
            # Starts inside the week: something to watch, but we have no measured
            # effect size for it, so it is listed and NOT applied to the forecast.
            item.update({
                "kind": "closure",
                "when": s.strftime("%a %H").upper() + "–" + e.strftime("%H"),
                "hour_from": int((s - ws).total_seconds() // 3600),
                "hour_to": min(167, int((e - ws).total_seconds() // 3600)),
                "multiplier": None,
                "applied": False,
                "applied_note": ("Listed, not modelled. We have no measured effect "
                                 "size for this closure, and inventing one would "
                                 "put a made-up number in a published forecast."),
            })
            adv.append(item)
        else:
            item.update({
                "kind": "closure",
                "tag": "ROADWORKS",
                "window": f"IN FORCE SINCE {s.strftime('%d %b %Y').upper()}",
                "effect": ("In force before the pool window opened, so it is "
                           "already inside the baseline."),
            })
            standing.append(item)
    return adv, standing


def sensor_conditions(con: duckdb.DuckDBPyConnection, source, week_start: date,
                      confirmed_end: date) -> list[dict]:
    """Derived standing conditions: dark sites, and sites too new to judge.

    Both are measured off the feed, not typed. The mock had these as hand-written
    copy; making them real is the difference between a caveat and a check.
    """
    lookback = (week_start - timedelta(days=DARK_LOOKBACK_DAYS)).isoformat()
    before = week_start.isoformat()

    q = f"""
    with m as (select countline_id, cast(viewpoint_id as varchar) vp,
                      cast(earliest as varchar) earliest
               from '{config.META}' where viewpoint_id is not null),
    prior as (select distinct m.vp from '{source}' f join m using (countline_id)
              where f.countline_date >= ? and f.countline_date < ?),
    week  as (select distinct m.vp from '{source}' f join m using (countline_id)
              where f.countline_date >= ? and f.countline_date <= ?),
    -- Silent for the whole week is rare and reassuring; silent on the newest
    -- confirmed day is the number a duty officer actually needs, because it is
    -- the coverage behind this morning's map.
    newest as (select distinct m.vp from '{source}' f join m using (countline_id)
               where f.countline_date = ?)
    select (select count(*) from prior),
           (select count(*) from week),
           (select count(*) from prior where vp not in (select vp from week)),
           (select count(*) from newest),
           (select count(*) from prior where vp not in (select vp from newest))
    """
    n_prior, n_week, n_dark, n_newest, n_dark_day = con.execute(
        q, [lookback, before, before, confirmed_end.isoformat(),
            confirmed_end.isoformat()]
    ).fetchone()

    new_cut = (week_start - timedelta(days=NEW_SITE_DAYS)).isoformat()
    n_new, = con.execute(
        f"""select count(distinct cast(viewpoint_id as varchar))
            from '{config.META}'
            where viewpoint_id is not null
              and cast(earliest as varchar) >= ?
              and cast(latest as varchar) >= ?""",
        [new_cut, before],
    ).fetchone()

    out = [{
        "source": "derived-from-feed",
        "kind": "sensor",
        "tag": "SENSOR",
        "window": f"SINCE {week_start.strftime('%d %b').upper()}",
        "title": (f"{n_dark_day} of {n_prior} camera sites dark on "
                  f"{confirmed_end.strftime('%a %-d %b')}"),
        "detail": (f"{n_dark_day} sites reported in the {DARK_LOOKBACK_DAYS} days "
                   f"before the week but sent nothing on the newest confirmed day; "
                   f"{n_dark} have been silent all week. Those places are unjudged, "
                   f"not quiet."),
        "count": int(n_dark_day),
        "count_all_week": int(n_dark),
        "of": int(n_prior),
        "reporting_newest_day": int(n_newest),
    }]
    if n_new:
        out.append({
            "source": "derived-from-feed",
            "kind": "new_sites",
            "tag": "NEW SITES",
            "window": f"FIRST SEEN SINCE {new_cut}",
            "title": f"{n_new} camera site(s) have no baseline yet",
            "detail": (f"First seen within {NEW_SITE_DAYS} days of the week start, so "
                       "there is no same-weekday pool to compare against. A naive "
                       "read calls them risers out of nothing."),
            "count": int(n_new),
        })
    out.append({
        "source": "derived-from-feed",
        "kind": "coverage",
        "tag": "COVERAGE",
        "window": "ALWAYS",
        "title": f"{n_week} camera sites reporting across the whole city",
        "detail": ("Absence of an anomaly means nothing. Most of Wellington has no "
                   "sensor on it at all."),
        "count": int(n_week),
    })
    return out
