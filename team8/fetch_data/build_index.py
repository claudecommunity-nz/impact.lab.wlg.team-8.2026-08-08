"""Landing page for docs/ — an index over the inventory and the profile reports.

Deliberately small. The interactive exploration lives in the marimo notebook; this is
just a directory so the static profile reports are findable.

Run: `just index`
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
CAT = ROOT / "data" / "catalogue" / "sources.json"


def main() -> None:
    sources = json.loads(CAT.read_text())
    groups: dict[str, list[dict]] = {}
    for s in sources:
        groups.setdefault(s["group"], []).append(s)

    rows = []
    for g in ("movement", "context", "gis"):
        for s in sorted(groups.get(g, []), key=lambda x: x["source_id"]):
            prof = s.get("profile")
            name = (f'<a href="{prof}">{s["source_id"]}</a>' if prof
                    else s["source_id"])
            n = s.get("rows") or s.get("feature_count") or ""
            flag = ("raster" if s.get("raster") else
                    "needs layer=" if s.get("needs_layer") else
                    "local copy" if s.get("downloaded") else "")
            rows.append(
                f"<tr><td>{g}</td><td>{name}</td>"
                f"<td>{(s.get('title') or '')[:64]}</td>"
                f"<td>{(s.get('publisher') or '')[:26]}</td>"
                f"<td class=n>{n or ''}</td><td class=n>{s.get('field_count') or 0}</td>"
                f"<td>{flag}</td></tr>"
            )

    n_prof = sum(1 for s in sources if s.get("profile"))
    n_dl = sum(1 for s in sources if s.get("downloaded"))

    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "index.html").write_text(PAGE.format(
        n=len(sources), n_prof=n_prof, n_dl=n_dl,
        n_gis=len(groups.get("gis", [])), rows="\n".join(rows),
    ))
    print(f"  → docs/index.html  ({len(sources)} sources, {n_prof} linked profiles)")


PAGE = """<!doctype html>
<html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Team 8 — data sources</title><style>
:root{{--ink:#16202c;--muted:#6b7a8c;--line:#e4e9ef}}
body{{margin:0;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
color:var(--ink);background:#fbfcfd}}
.w{{max-width:1080px;margin:0 auto;padding:32px 24px 72px}}
h1{{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}}
p.sub{{color:var(--muted);margin:0 0 22px}}
table{{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);
border-radius:6px;overflow:hidden;font-size:13px}}
th,td{{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line)}}
th{{background:#f4f7fa;font-size:11px;text-transform:uppercase;letter-spacing:.04em;
color:var(--muted);position:sticky;top:0}}
tr:last-child td{{border-bottom:none}}
td.n{{text-align:right;font-variant-numeric:tabular-nums}}
a{{color:#2f6fb5}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;
margin:0 0 22px}}
.c{{background:#fff;border:1px solid var(--line);border-radius:6px;padding:11px 13px}}
.c b{{font-size:21px;font-weight:650;display:block;letter-spacing:-.02em}}
.c span{{color:var(--muted);font-size:12px}}
.note{{border-left:3px solid #e8a33d;background:#fffaf2;padding:10px 14px;margin:0 0 22px;
border-radius:0 5px 5px 0}}
code{{background:#eef2f6;padding:1px 5px;border-radius:3px}}
</style></head><body><div class=w>
<h1>Wellington movement &amp; hazard data — source index</h1>
<p class=sub>Impact Lab, Team 8, problem 05. Every source we can reach, with its schema.</p>

<div class=note><b>These are hazard-planning and after-action layers, not live emergency
information.</b> The movement feed is T+1 — the newest data is always yesterday.
In an emergency, call 111.</div>

<div class=cards>
<div class=c><b>{n}</b><span>sources catalogued</span></div>
<div class=c><b>{n_gis}</b><span>GIS datasets</span></div>
<div class=c><b>{n_dl}</b><span>with a local copy</span></div>
<div class=c><b>{n_prof}</b><span>profile reports</span></div>
</div>

<p><b>To explore interactively:</b> <code>just explore</code> — opens the marimo
notebook against the full local data. This page is the static index; source names below
link to their profile report where one exists.</p>

<table><thead><tr><th>group</th><th>source</th><th>title</th><th>publisher</th>
<th class=n>rows</th><th class=n>fields</th><th>note</th></tr></thead>
<tbody>
{rows}
</tbody></table>

<p class=sub style="margin-top:24px">Data belongs to its publishers — WCC, Greater
Wellington, GNS Science, NIWA, Wellington Water, MBIE, NZTA, MetService — and licences
vary per dataset. Check before publishing anything derived.</p>
</div></body></html>
"""

if __name__ == "__main__":
    main()
