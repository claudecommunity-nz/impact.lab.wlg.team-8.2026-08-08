"""Team 8 — data exploration notebook.

Run:  marimo edit notebooks/explore.py
View: marimo run  notebooks/explore.py
"""

import marimo

__generated_with = "0.23.16"
app = marimo.App(width="full", app_title="Team 8 — Wellington movement data")


@app.cell(hide_code=True)
def _():
    import json
    from pathlib import Path

    import altair as alt
    import duckdb
    import marimo as mo
    import pandas as pd

    # Resolve relative to the notebook, not the cwd — `marimo edit notebooks/explore.py`
    # runs from the repo root, so cwd-relative paths would be wrong.
    try:
        _here = Path(__file__).resolve().parent
    except NameError:  # WASM/Pyodide has no __file__
        _here = Path.cwd()
    ROOT = _here.parent if _here.name == "notebooks" else _here
    DATA = ROOT / "data"

    con = duckdb.connect()
    _ = alt.data_transformers.enable("default", max_rows=200_000)
    return DATA, ROOT, alt, con, json, mo, pd


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        """
        # Wellington movement data — what we have

        Impact Lab, problem 05. This notebook is for **looking at the data**, not for
        arguing a conclusion. Everything is read from the cached copies in `data/raw/`,
        so it works offline.

        /// attention | These are hazard-planning and after-action layers.
        The movement feed is **T+1** — the newest data available is always yesterday.
        Nothing here is a live emergency source. In an emergency, call 111.
        ///
        """
    )
    return


@app.cell(hide_code=True)
def _(DATA, json):
    SOURCES = json.loads((DATA / "catalogue" / "sources.json").read_text())
    BY_ID = {s["source_id"]: s for s in SOURCES}
    return BY_ID, SOURCES


@app.cell(hide_code=True)
def _(SOURCES, mo, pd):
    _counts = pd.DataFrame(SOURCES).groupby("group").size()
    mo.md(
        f"""
        ## 1 · Every source we have

        **{len(SOURCES)} sources** —
        {int(_counts.get("gis", 0))} GIS layers,
        {int(_counts.get("movement", 0))} movement tables,
        {int(_counts.get("context", 0))} context files.
        Pick one to see its schema.
        """
    )
    return


@app.cell(hide_code=True)
def _(SOURCES, mo):
    group_filter = mo.ui.dropdown(
        options=["all", "gis", "movement", "context"],
        value="all",
        label="group",
    )
    only_downloaded = mo.ui.checkbox(label="only sources we have data for")
    search = mo.ui.text(label="search", placeholder="tsunami, road, rainfall…")
    mo.hstack([group_filter, only_downloaded, search], justify="start", gap=2)
    return group_filter, only_downloaded, search


@app.cell(hide_code=True)
def _(SOURCES, group_filter, only_downloaded, pd, search):
    def _match(s):
        if group_filter.value != "all" and s["group"] != group_filter.value:
            return False
        if only_downloaded.value and not s.get("downloaded"):
            return False
        if search.value:
            hay = " ".join(
                str(s.get(k) or "") for k in ("source_id", "title", "publisher", "theme")
            ).lower()
            if search.value.lower() not in hay:
                return False
        return True

    filtered = [s for s in SOURCES if _match(s)]
    overview = pd.DataFrame(
        [
            {
                "source": s["source_id"],
                "group": s["group"],
                "title": (s.get("title") or "")[:60],
                "publisher": (s.get("publisher") or "")[:28],
                "geometry": s.get("geometry") or ("table" if s["group"] != "gis" else ""),
                "rows/features": s.get("rows") or s.get("feature_count") or "",
                "fields": s.get("field_count") or 0,
                "have data": "yes" if s.get("downloaded") else "",
                "raster": "yes" if s.get("raster") else "",
                "needs layer=": "yes" if s.get("needs_layer") else "",
            }
            for s in filtered
        ]
    )
    return filtered, overview


@app.cell(hide_code=True)
def _(mo, overview):
    table = mo.ui.table(overview, selection="single", page_size=12, label="")
    table
    return (table,)


@app.cell(hide_code=True)
def _(BY_ID, filtered, mo, table):
    _sel = table.value
    if _sel is not None and len(_sel):
        _sid = _sel.iloc[0]["source"]
    elif filtered:
        _sid = filtered[0]["source_id"]
    else:
        _sid = None
    picked = BY_ID.get(_sid) if _sid else None
    mo.md(f"### {picked['source_id']}" if picked else "*no source selected*")
    return (picked,)


@app.cell(hide_code=True)
def _(mo, pd, picked):
    if picked is None:
        _out = mo.md("")
    else:
        _meta = {
            "title": picked.get("title"),
            "publisher": picked.get("publisher"),
            "scope": picked.get("scope"),
            "geometry": picked.get("geometry"),
            "rows / features": picked.get("rows") or picked.get("feature_count"),
            "native SRS": picked.get("native_wkid"),
            "max records/query": picked.get("max_record_count"),
            "date range": " → ".join(picked["date_range"]) if picked.get("date_range") else None,
            "local copy": picked.get("path") or (
                f"data/raw/gis/{picked['source_id']}.geojson"
                if picked.get("downloaded") else "not downloaded"
            ),
            "url": picked.get("url"),
        }
        _meta = {k: v for k, v in _meta.items() if v not in (None, "")}
        _notes = picked.get("notes") or []
        _fields = pd.DataFrame(picked["fields"]) if picked["fields"] else pd.DataFrame()

        _bits = [
            mo.ui.table(
                pd.DataFrame({"": list(_meta), "value": [str(v) for v in _meta.values()]}),
                selection=None, show_column_summaries=False, page_size=15, label="",
            )
        ]
        if _notes:
            _bits.append(mo.callout(mo.md("\n".join(f"- {n}" for n in _notes)), kind="warn"))
        if picked.get("sublayers"):
            _bits.append(mo.md("**Sub-layers** (pass one as `layer=`)"))
            _bits.append(mo.ui.table(pd.DataFrame(picked["sublayers"]), selection=None,
                                     page_size=10, label=""))
        if len(_fields):
            _bits.append(mo.md(f"**Schema — {len(_fields)} fields**"))
            _bits.append(mo.ui.table(_fields, selection=None, page_size=25, label=""))
        else:
            _bits.append(mo.md("*No field list — see the notes above.*"))
        if picked.get("profile"):
            _bits.append(mo.md(f"[Full profile report →]({picked['profile']})"))
        _out = mo.vstack(_bits)
    _out
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        """
        ---
        ## 2 · The movement feed, countline by countline

        410 countlines, 386 still reporting. Each is a line across a street or path; the
        sensor counts things crossing it, per hour, per direction, per mode.
        """
    )
    return


@app.cell(hide_code=True)
def _(DATA, con):
    HOURLY = f"read_parquet('{DATA}/raw/movement/hourly_*.parquet')"
    META = f"read_parquet('{DATA}/raw/movement/meta.parquet')"
    MODES = ["pedestrian", "cyclist", "car", "bus", "lgv", "motorbike", "e_scooter",
             "ogv1", "ogv2"]

    lines = con.execute(f"""
        select countline_id, name, latest,
               latitude_start_line::double as lat,
               longitude_start_line::double as lng
        from {META}
        where name is not null
        order by name
    """).df()
    line_labels = {
        f"{nm}  ({cid})": cid
        for cid, nm in zip(lines.countline_id, lines.name)
    }
    return HOURLY, META, MODES, line_labels, lines


@app.cell(hide_code=True)
def _(line_labels, mo):
    countline = mo.ui.dropdown(
        options=line_labels,
        value=next(iter(line_labels)),
        label="countline",
        searchable=True,
    )
    countline
    return (countline,)


@app.cell(hide_code=True)
def _(HOURLY, MODES, alt, con, countline, mo):
    if countline.value is None:
        _chart = mo.md("*pick a countline*")
    else:
        _sel = ", ".join(f"sum({m}) as {m}" for m in MODES)
        _df = con.execute(f"""
            select countline_date, {_sel}
            from {HOURLY} where countline_id = '{countline.value}'
            group by 1 order by 1
        """).df()
        _long = _df.melt("countline_date", var_name="mode", value_name="count")
        _long = _long[_long["count"] > 0]
        _chart = mo.ui.altair_chart(
            alt.Chart(_long)
            .mark_line(strokeWidth=1.2)
            .encode(
                x=alt.X("countline_date:T", title=None),
                y=alt.Y("count:Q", title="trips per day"),
                color=alt.Color("mode:N", scale=alt.Scale(scheme="tableau10")),
                tooltip=["countline_date:T", "mode:N", "count:Q"],
            )
            .properties(height=280, width=980, title=f"Daily counts — {countline.value}")
        )
    _chart
    return


@app.cell(hide_code=True)
def _(HOURLY, MODES, alt, con, countline, mo):
    if countline.value is None:
        _h = mo.md("")
    else:
        _sel = ", ".join(f"sum({m}) as {m}" for m in MODES)
        _hd = con.execute(f"""
            select countline_hour::int as hour, direction, {_sel}
            from {HOURLY} where countline_id = '{countline.value}'
            group by 1, 2 order by 1
        """).df()
        _hl = _hd.melt(["hour", "direction"], var_name="mode", value_name="count")
        _hl = _hl[_hl["count"] > 0]
        _h = mo.ui.altair_chart(
            alt.Chart(_hl)
            .mark_bar()
            .encode(
                x=alt.X("hour:O", title="hour of day"),
                y=alt.Y("sum(count):Q", title="total trips"),
                color=alt.Color("mode:N", scale=alt.Scale(scheme="tableau10")),
                column=alt.Column("direction:N", title=None),
                tooltip=["hour:O", "mode:N", "sum(count):Q"],
            )
            .properties(height=200, width=340)
        )
    _h
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        """
        ---
        ## 3 · Coverage — when the feed delivered, and when it didn't

        A day where the feed only ingested part of the day looks exactly like a citywide
        catastrophe. Every healthy day reports 24 distinct hours.
        """
    )
    return


@app.cell(hide_code=True)
def _(DATA, HOURLY, alt, con, json, mo):
    _hol = {h["date"] for h in
            json.loads((DATA / "raw" / "context" / "nz_holidays.json").read_text())}
    cov = con.execute(f"""
        select countline_date,
               count(*) as rows_present,
               count(distinct countline_id || direction) as line_dirs,
               count(distinct countline_hour) as hours_seen
        from {HOURLY} group by 1 order by 1
    """).df()
    cov["completeness"] = cov.rows_present / (cov.line_dirs * 24)
    cov["date"] = cov.countline_date.astype(str)
    cov["kind"] = [
        "partial ingest" if h < 22 else ("holiday" if d in _hol else "normal")
        for h, d in zip(cov.hours_seen, cov.date)
    ]
    cov_chart = mo.ui.altair_chart(
        alt.Chart(cov)
        .mark_bar()
        .encode(
            x=alt.X("countline_date:T", title=None),
            y=alt.Y("hours_seen:Q", title="hours reported"),
            color=alt.Color(
                "kind:N",
                scale=alt.Scale(
                    domain=["normal", "holiday", "partial ingest"],
                    range=["#4a90d9", "#9b59b6", "#e8a33d"],
                ),
            ),
            tooltip=["date:N", "hours_seen:Q", "rows_present:Q", "kind:N"],
        )
        .properties(height=200, width=980, title="Hours the feed delivered, per day")
    )
    cov_chart
    return (cov,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        """
        ---
        ## 4 · Compare any two dates

        Pick a date to look at and one or more dates to compare it against. Nothing is
        pre-selected as "the event" — find your own.
        """
    )
    return


@app.cell(hide_code=True)
def _(cov, mo):
    _dates = sorted(cov.date.tolist())
    event_date = mo.ui.dropdown(options=_dates, value="2025-10-23", label="look at")
    base_dates = mo.ui.multiselect(
        options=_dates,
        value=["2025-10-16", "2025-10-30"],
        label="compare against",
    )
    mo.hstack([event_date, base_dates], justify="start", gap=2)
    return base_dates, event_date


@app.cell(hide_code=True)
def _(HOURLY, MODES, alt, base_dates, con, event_date, mo, pd):
    if not base_dates.value:
        _cmp = mo.md("*pick at least one comparison date*")
    else:
        _b = ", ".join(f"date '{d}'" for d in base_dates.value)
        _n = len(base_dates.value)
        _sel = ", ".join(f"sum({m}) as {m}" for m in MODES)
        _ev = con.execute(f"""
            select countline_hour::int as hour, {_sel} from {HOURLY}
            where countline_date = date '{event_date.value}' group by 1
        """).df().melt("hour", var_name="mode", value_name="event")
        _bl = con.execute(f"""
            select countline_hour::int as hour,
                   {', '.join(f'sum({m})/{_n}.0 as {m}' for m in MODES)}
            from {HOURLY} where countline_date in ({_b}) group by 1
        """).df().melt("hour", var_name="mode", value_name="baseline")
        _m = _ev.merge(_bl, on=["hour", "mode"])
        _m = _m[_m.baseline >= 50]
        _m["pct"] = (_m.event - _m.baseline) / _m.baseline * 100
        _cmp = mo.ui.altair_chart(
            alt.Chart(_m)
            .mark_line(point=True, strokeWidth=1.8)
            .encode(
                x=alt.X("hour:Q", title="hour", scale=alt.Scale(domain=[0, 23])),
                y=alt.Y("pct:Q", title="% vs comparison days"),
                color=alt.Color("mode:N", scale=alt.Scale(scheme="tableau10")),
                tooltip=["hour:Q", "mode:N", "event:Q", "baseline:Q", "pct:Q"],
            )
            .properties(
                height=340, width=900,
                title=f"{event_date.value} vs {', '.join(base_dates.value)}",
            )
        )
    _cmp
    return


@app.cell(hide_code=True)
def _(HOURLY, alt, base_dates, con, event_date, lines, mo, pd):
    if not base_dates.value:
        _map = mo.md("")
    else:
        _b = ", ".join(f"date '{d}'" for d in base_dates.value)
        _n = len(base_dates.value)
        _d = con.execute(f"""
            with ev as (
              select countline_id, sum(pedestrian+car+cyclist+bus+lgv) o
              from {HOURLY} where countline_date = date '{event_date.value}' group by 1
            ), bl as (
              select countline_id, sum(pedestrian+car+cyclist+bus+lgv)/{_n}.0 e
              from {HOURLY} where countline_date in ({_b}) group by 1
            )
            select countline_id, o, e from ev join bl using (countline_id) where e >= 200
        """).df()
        _d = _d.merge(lines, on="countline_id")
        _d["pct"] = (_d.o - _d.e) / _d.e * 100
        # NB: plain altair, not mo.ui.altair_chart — the selection layer marimo adds
        # for interactivity breaks vega-lite's geographic projection.
        _map = (
            alt.Chart(_d)
            .mark_circle()
            .encode(
                longitude="lng:Q",
                latitude="lat:Q",
                size=alt.Size("e:Q", title="normal volume",
                              scale=alt.Scale(range=[20, 400])),
                color=alt.Color("pct:Q", title="% change",
                                scale=alt.Scale(scheme="redblue", domain=[-100, 100])),
                tooltip=["name:N", "pct:Q", "o:Q", "e:Q"],
            )
            .project(type="mercator")
            .properties(height=520, width=760,
                        title=f"Per-countline change, {event_date.value}")
        )
    _map
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        """
        ---
        ## 5 · GIS layers

        The hazard, corroboration and context layers. Attribute tables and geometry as
        pulled — all reprojected to EPSG:4326.
        """
    )
    return


@app.cell(hide_code=True)
def _(DATA, mo):
    _files = sorted(p.stem for p in (DATA / "raw" / "gis").glob("*.geojson"))
    gis_pick = mo.ui.dropdown(options=_files, value=_files[0] if _files else None,
                              label="layer", searchable=True)
    gis_pick
    return (gis_pick,)


@app.cell(hide_code=True)
def _(DATA, gis_pick, json, mo, pd):
    if gis_pick.value is None:
        _g = mo.md("*no layers*")
    else:
        _fc = json.loads((DATA / "raw" / "gis" / f"{gis_pick.value}.geojson").read_text())
        _feats = _fc.get("features", [])
        _attrs = pd.DataFrame([f.get("properties", {}) for f in _feats])
        _geom = {f.get("geometry", {}).get("type") for f in _feats if f.get("geometry")}
        _g = mo.vstack([
            mo.md(f"**{len(_feats):,} features** · geometry: "
                  f"{', '.join(sorted(t for t in _geom if t)) or 'none'} · "
                  f"{_attrs.shape[1]} attributes"),
            mo.ui.table(_attrs, selection=None, page_size=12, label=""),
        ])
    _g
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        """
        ---
        ### Attribution

        Movement data: Wellington City Council / VivaCity countline sensors, via Pōneke
        Travel Insights. GIS layers belong to their publishers — WCC, Greater Wellington,
        GNS Science, NIWA, Wellington Water, MBIE, NZTA, MetService — and licences vary
        per dataset; check before publishing anything derived. Weather-warning context is
        hand-entered from public reporting, not an automated feed.
        """
    )
    return


if __name__ == "__main__":
    app.run()
