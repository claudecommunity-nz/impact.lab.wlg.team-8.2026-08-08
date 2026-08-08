/**
 * Streets — the map's table half. One row per camera site, worst first: 118
 * of them on 23 Oct, against 369 countlines.
 *
 * The map answers "where"; this answers "which, and by how much, and how sure".
 * It is a real <table> because the values are compared down a column, and the
 * numeric columns carry everything the trace says — the trace is the fast read,
 * the columns are the record.
 *
 * Three things earn their place here and nowhere else:
 *   · one hour ruler and one warning band, drawn once in the sticky header
 *     rather than once per row, so every deficit area lines up with
 *     the 08:00–18:00 window without the tool ever asserting a cause;
 *   · one playback cursor over the whole column, so an hour tick touches one
 *     element instead of one per row and the table stays inert as the day runs;
 *   · a Not-scored section that sites fall into rather than being ranked with a
 *     fabricated zero.
 */

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Callout, TwinDotGlyph } from '../ui';
import { useData } from '../data/DataProvider';
import type { DayModel, SiteSeriesKey } from '../data/derive';
import { useAppState, useSelection } from '../state/app';
import { cssColor } from '../theme/color';
import { thresholds } from '../theme/foundations';
import { DIAGNOSIS, honesty, signedPct } from '../copy/strings';
import {
  CODE_FOR_KEY,
  DIAGNOSIS_KEYS,
  type CountlineIndex,
  type DiagnosisCode,
} from '../data/types';
import { AroValleyNote } from '../panels/StreetsAnnex';
import { SiteRow } from './SiteRow';
import {
  SORTS,
  SORT_DIR,
  buildRows,
  dayHorizon,
  filterRows,
  rankRows,
  seriesKeyFor,
  type SortKey,
  type StreetRow,
} from './model';
import './streets.css';

/** Fraction of the trace column where hour `i` sits. Mirrors VitalsTrace's
 *  8/1000 padding exactly, or the ruler would lie about where noon is. */
const fracOf = (i: number) => (8 + (984 * i) / 23) / 1000;
const pctOf = (i: number) => `${(fracOf(i) * 100).toFixed(3)}%`;

/** "Thu 6 Aug 2026". en-NZ puts a comma after the weekday; strip it. */
const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`)
    .toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .replace(',', '');

export function StreetsView() {
  const { model, index, context, manifest } = useData();
  const { mode } = useAppState();
  const { selected, setSelected, setHovered } = useSelection();

  const [query, setQuery] = useState('');
  const [codes, setCodes] = useState<ReadonlySet<DiagnosisCode>>(() => new Set());
  const [scoredFilter, setScoredFilter] = useState<'all' | 'scored' | 'unscored'>('all');
  const [cbdOnly, setCbdOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('worst');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [showUnscored, setShowUnscored] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // React's own debounce. A 120 ms timer would do the same job with a timer to
  // clean up and a stale-closure hazard attached.
  const q = useDeferredValue(query);

  const seriesKey = seriesKeyFor(mode);
  const refused = model?.refused ?? false;

  const rows = useMemo(
    () => (model && index ? buildRows(model, index, seriesKey, mode !== 'all') : []),
    [model, index, seriesKey, mode],
  );

  /** One edge for the whole table — a property of the feed, not of a row. */
  const horizon = useMemo(() => (model ? dayHorizon(model) : undefined), [model]);

  const filtered = useMemo(
    () => filterRows(rows, { query: q, codes, scored: scoredFilter, cbdOnly }),
    [rows, q, codes, scoredFilter, cbdOnly],
  );

  const { ranked, unscored, floorHidden } = useMemo(() => {
    // A refused day still renders every row — the cut trace repeated down the
    // table is the most persuasive object here. It just carries no numbers.
    if (refused) {
      return {
        ranked: [...filtered].sort((a, b) => a.site.name.localeCompare(b.site.name, 'en-NZ')),
        unscored: [] as StreetRow[],
        floorHidden: 0,
      };
    }
    const scored = filtered.filter((r) => r.delta !== null);
    const list = rankRows(scored, sort);
    return {
      ranked: list,
      unscored: filtered.filter((r) => r.delta === null),
      floorHidden: scored.length - list.length,
    };
  }, [filtered, sort, refused]);

  /** Verdict counts over the whole day, so the chip row is a census as well as
   *  a filter. Ordered by the canonical diagnosis order, not by count. */
  const present = useMemo(() => {
    const n = new Map<DiagnosisCode, number>();
    for (const r of rows) n.set(r.site.code, (n.get(r.site.code) ?? 0) + 1);
    return DIAGNOSIS_KEYS.map((k) => CODE_FOR_KEY[k])
      .filter((c) => n.has(c))
      .map((c) => [c, n.get(c) ?? 0] as const);
  }, [rows]);

  const currentSiteId = selected == null ? null : (model?.siteOfCi.get(selected) ?? null);

  const onSelect = useCallback((ci: number) => setSelected(ci), [setSelected]);
  const onHover = useCallback((ci: number | null) => setHovered(ci), [setHovered]);
  const onToggle = useCallback((siteId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(siteId)) next.add(siteId);
      return next;
    });
  }, []);

  /** `/` is the fastest control in a four-minute demo. useDemoKeys already
   *  refuses to steal keys from an input, so this cannot fight it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Arriving with a live selection: open that site and put it on screen, so
   *  the two tabs read as one instrument rather than two screens. The arrival
   *  state is all that counts — a later click must not yank the list out from
   *  under the hand that made it. */
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !model) return;
    synced.current = true;
    const id = selected == null ? null : model.siteOfCi.get(selected);
    if (!id || !scroller.current) return;
    setExpanded((prev) => new Set(prev).add(id));
    scroller.current
      .querySelector(`[data-site="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [model, selected]);

  if (!model || !index) {
    return (
      <div className="pp-streets">
        <p className="pp-t-caption pp-c-secondary pp-streets__empty">Loading the day…</p>
      </div>
    );
  }

  const warning = warningBand(context?.warnings);
  const total = rows.length;
  const network = manifest?.network.camera_sites;
  const aroPinned = /aro/i.test(q);

  return (
    <div className="pp-streets" data-refused={refused}>
      {refused && model.file.refusal && (
        <Callout intent="refusal" title={honesty.refusalTitle}>
          <p>{model.file.refusal.message}</p>
          <p className="pp-t-caption">
            A detector without the coverage guard would have called this day{' '}
            <strong className="pp-t-mono-sm">
              {signedPct(model.file.refusal.naive_delta_pct, 1)}
            </strong>{' '}
            citywide. Every trace below is still drawn, and the break in it is the reason we are not.
          </p>
        </Callout>
      )}

      <div className="pp-streets__controls">
        <label className="pp-streets__search">
          <span className="pp-sr-only">Search sites and countlines</span>
          <input
            ref={search}
            type="search"
            className="pp-streets__input pp-t-body"
            placeholder="Search a street  ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {/* Only the causes this day actually produced. A chip for a verdict no
            site holds is a filter that can only ever empty the table. */}
        {/* Counts are camera sites, the same unit the map panel now counts. */}
        <div className="pp-streets__chips" role="group" aria-label="Filter by inferred cause, counted in camera sites">
          {present.map(([code, n]) => {
            const meta = DIAGNOSIS[code];
            const on = codes.has(code);
            return (
              <button
                key={code}
                type="button"
                className="pp-dx pp-streets__chip pp-t-caption"
                aria-pressed={on}
                data-on={on}
                title={meta.label}
                style={{ borderColor: cssColor(meta.token, on ? 0.9 : 0.35) }}
                onClick={() =>
                  setCodes((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(code)) next.add(code);
                    return next;
                  })
                }
              >
                <TwinDotGlyph
                  pedestrian={meta.glyph.pedestrian}
                  vehicle={meta.glyph.vehicle}
                  title={meta.label}
                />
                <span>{meta.short}</span>
                <span className="pp-dx__conf">{n}</span>
              </button>
            );
          })}
        </div>

        <div className="pp-streets__seg" role="group" aria-label="Scored">
          {(['all', 'scored', 'unscored'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="pp-btn pp-btn--chip"
              data-active={scoredFilter === v}
              aria-pressed={scoredFilter === v}
              onClick={() => setScoredFilter(v)}
            >
              {v === 'all' ? 'All' : v === 'scored' ? 'Scored' : 'Not scored'}
            </button>
          ))}
        </div>

        <label className="pp-streets__cbd pp-t-caption">
          <input type="checkbox" checked={cbdOnly} onChange={(e) => setCbdOnly(e.target.checked)} />
          CBD cordon only
        </label>

        {/* Five sorts, only three of which map to a column, so the control is
            one segmented group rather than four header buttons that would
            leave "busiest" and the riser note with nowhere to live. */}
        <div className="pp-streets__seg pp-streets__seg--sort" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className="pp-btn pp-btn--chip"
              data-active={sort === s.key}
              aria-pressed={sort === s.key}
              title={s.note}
              onClick={() => setSort(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Every count on this row carries its unit, and the network figure is in
          the same sentence as the day figure. Two numbers for one noun on two
          tabs is the cheapest possible way to lose the room. */}
      {/* The table is ALWAYS the newest confirmed day artefact — it does not
          follow the calendar cursor, and nothing on this screen used to say so.
          Selecting SAT 8 left the chrome asserting Saturday over a Thursday
          table complete with a 24/24 sparkline for a day that has not happened.
          The date goes FIRST, before the counts, because the misreading this
          prevents is a screenshot taken with no other context. */}
      <p className="pp-t-caption pp-c-secondary pp-streets__status" role="status" aria-live="polite">
        <strong className="pp-streets__asof">{longDate(model.file.date)}</strong> — the newest
        confirmed day. This table is a settled day, not the calendar cursor.{' '}
        {ranked.length} of {total} camera sites that reported
        {network ? ` (of ${network} city-wide)` : ''}, sorted{' '}
        {SORTS.find((s) => s.key === sort)?.label.toLowerCase()}.
        {unscored.length > 0 && ` ${unscored.length} not scored.`}
        {floorHidden > 0 &&
          ` ${floorHidden} under the volume floor hidden from this sort.`}
      </p>

      <div className="pp-streets__scroll" ref={scroller}>
        {/* Searching "aro" is how anyone follows the link from the map rail, so
            the correction goes above the rows it is correcting when they do.
            Otherwise it sits under the table, which is the only place in a
            fixed-height layout a 900px note can live without evicting the
            instrument. It was written, correct, and imported by nothing. */}
        {aroPinned && <AroValleyNote />}
        <div className="pp-streets__inner">
          <table className="pp-st" role="table">
            <caption className="pp-sr-only">
              Sites ranked by change against a same-weekday baseline. The numeric columns carry
              everything the trace shows; the trace is the fast visual read, not the only channel.
            </caption>
            <thead role="rowgroup">
              <tr className="pp-st__row pp-st__head" role="row">
                <th role="columnheader" className="pp-st__c-disclose" scope="col">
                  <span className="pp-sr-only">Expand</span>
                </th>
                <th role="columnheader" className="pp-st__c-rank pp-t-label" scope="col">
                  <span className="pp-sr-only">Rank</span>#
                </th>
                <th
                  role="columnheader"
                  className="pp-st__c-name pp-t-label"
                  scope="col"
                  aria-sort={sort === 'name' ? SORT_DIR.name : 'none'}
                >
                  Site
                </th>
                <th role="columnheader" className="pp-st__c-trace" scope="col">
                  <span className="pp-sr-only">The day, midnight to midnight</span>
                  <div className="pp-st__ruler" aria-hidden="true">
                    {warning && (
                      <span
                        className="pp-st__warn"
                        style={{ left: pctOf(warning.from), right: `${100 - fracOf(warning.to) * 100}%` }}
                      >
                        <span className="pp-st__warn-label pp-t-caption">
                          {warning.label} · hand-entered
                        </span>
                      </span>
                    )}
                    {[0, 6, 12, 18, 23].map((h) => (
                      <span key={h} className="pp-st__tick pp-t-mono-sm" style={{ left: pctOf(h) }}>
                        {String(h).padStart(2, '0')}
                      </span>
                    ))}
                  </div>
                </th>
                <th
                  role="columnheader"
                  className="pp-st__c-delta pp-t-label"
                  scope="col"
                  aria-sort={sort === 'worst' || sort === 'riser' ? SORT_DIR[sort] : 'none'}
                >
                  {refused ? 'not scored' : 'Change'}
                </th>
                <th role="columnheader" className="pp-st__c-dx pp-t-label" scope="col">
                  Inferred
                </th>
                <th role="columnheader" className="pp-st__c-lines pp-t-label" scope="col">
                  Lines
                </th>
                <th
                  role="columnheader"
                  className="pp-st__c-cov pp-t-label"
                  scope="col"
                  aria-sort={sort === 'coverage' ? SORT_DIR.coverage : 'none'}
                >
                  Hours
                </th>
              </tr>
            </thead>

            <TableBody
              rows={ranked}
              empty={unscored.length === 0}
              seriesKey={seriesKey}
              model={model}
              index={index}
              refused={refused}
              horizon={horizon}
              expanded={expanded}
              currentSiteId={currentSiteId}
              selectedCi={selected}
              onToggle={onToggle}
              onSelect={onSelect}
              onHover={onHover}
            />

            {unscored.length > 0 && (
              <tbody role="rowgroup">
                <tr className="pp-st__row pp-st__section" role="row">
                  <td role="cell" className="pp-st__section-cell">
                    <button
                      type="button"
                      className="pp-btn pp-btn--ghost pp-t-label"
                      aria-expanded={showUnscored}
                      onClick={() => setShowUnscored((v) => !v)}
                    >
                      {showUnscored ? '▾' : '▸'} Not scored — {unscored.length} sites
                    </button>
                    <span className="pp-t-caption pp-c-secondary">{reasonBreakdown(unscored)}</span>
                  </td>
                </tr>
                {showUnscored &&
                  unscored.map((r) => (
                    <SiteRow
                      key={r.site.siteId}
                      row={r}
                      rank={null}
                      seriesKey={seriesKey}
                      model={model}
                      index={index}
                      refused={refused}
                      horizon={horizon}
                      expanded={expanded.has(r.site.siteId)}
                      current={currentSiteId === r.site.siteId}
                      selectedCi={selected}
                      onToggle={onToggle}
                      onSelect={onSelect}
                      onHover={onHover}
                    />
                  ))}
              </tbody>
            )}
          </table>

          {/* One cursor and one band for the whole column, aligned to the trace
              geometry by the same 8/1000 padding VitalsTrace uses. */}
          <PlaybackCursor warning={warning} />
        </div>
        {!aroPinned && <AroValleyNote />}
      </div>

      <Legend floor={thresholds.minExpectedPerHour} floorDay={thresholds.minExpectedPerDay} />
    </div>
  );
}

/* ------------------------------------------------------------------- body */

interface BodyProps {
  rows: StreetRow[];
  /** Show the nothing-matched message. False when the Not-scored section below
   *  still has rows — "no sites" beside 17 sites is a lie about the filter. */
  empty: boolean;
  seriesKey: SiteSeriesKey;
  model: DayModel;
  index: CountlineIndex;
  refused: boolean;
  horizon: number | undefined;
  expanded: ReadonlySet<string>;
  currentSiteId: string | null;
  selectedCi: number | null;
  onToggle: (siteId: string) => void;
  onSelect: (ci: number) => void;
  onHover: (ci: number | null) => void;
}

/** Memoised so the hour tick — which re-renders this view through the shared
 *  app context — never reaches the 123 rows underneath it. */
const TableBody = memo(function TableBody(p: BodyProps) {
  if (p.rows.length === 0) {
    if (!p.empty) return null;
    return (
      <tbody role="rowgroup">
        <tr className="pp-st__row pp-st__section" role="row">
          <td role="cell" className="pp-st__section-cell pp-t-caption pp-c-secondary">
            No site matches these filters. That is a statement about the filters, not about the city.
          </td>
        </tr>
      </tbody>
    );
  }
  return (
    <tbody role="rowgroup">
      {p.rows.map((r, i) => (
        <SiteRow
          key={r.site.siteId}
          row={r}
          rank={i + 1}
          seriesKey={p.seriesKey}
          model={p.model}
          index={p.index}
          refused={p.refused}
          horizon={p.horizon}
          expanded={p.expanded.has(r.site.siteId)}
          current={p.currentSiteId === r.site.siteId}
          selectedCi={p.selectedCi}
          onToggle={p.onToggle}
          onSelect={p.onSelect}
          onHover={p.onHover}
        />
      ))}
    </tbody>
  );
});

/* ----------------------------------------------------------------- overlay */

function PlaybackCursor({ warning }: { warning: WarningBand | null }) {
  const { hour } = useAppState();
  return (
    <div className="pp-st__overlay" aria-hidden="true">
      {warning && (
        <span
          className="pp-st__overlay-band"
          style={{ '--pp-st-f': fracOf(warning.from), '--pp-st-w': fracOf(warning.to) - fracOf(warning.from) } as CSSProperties}
        />
      )}
      <span
        className="pp-st__overlay-cursor"
        style={{ '--pp-st-f': fracOf(hour) } as CSSProperties}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

interface WarningBand {
  from: number;
  to: number;
  label: string;
}

/** Hours come off the ISO string, which already carries the +13:00 offset, so
 *  the band lands on local time without a Date round-trip. */
function warningBand(warnings: Array<{ valid_from: string; valid_until: string; type: string; level: string }> | undefined): WarningBand | null {
  const w = warnings?.[0];
  if (!w) return null;
  const from = Number(/T(\d{2}):/.exec(w.valid_from)?.[1]);
  const to = Number(/T(\d{2}):/.exec(w.valid_until)?.[1]);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) return null;
  return { from, to, label: `${w.level.toUpperCase()} ${w.type} warning` };
}

function reasonBreakdown(rows: StreetRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = r.unscoredReason ?? 'not scored';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(' · ');
}

function Legend({ floor, floorDay }: { floor: number; floorDay: number }) {
  return (
    <details className="pp-streets__legend">
      <summary className="pp-t-label pp-c-secondary">How to read this table</summary>
      <div className="pp-t-caption pp-c-secondary pp-streets__legend-body">
        <p>
          A gap in a trace is an hour the feed never delivered. It is drawn as a break, never as a
          zero — about a tenth of site-hours are missing on an ordinary day.
        </p>
        <p>
          A site counts an hour as reported when <em>any</em> of its countlines reported it. A
          viewpoint is one physical camera, so its countlines go dark together and a whole-site
          absence is a real outage. The residual bias: a quiet countline silent at 03:00 while a
          sibling reports drags that site's total marginally low.
        </p>
        <p>
          At 02:00 most sites see single digits, so +15% is two extra pedestrians. Cells under ~
          {floor} movements an hour keep their height and lose the colour ramp, and a site whose
          whole day expects under {floorDay} is shown without the ramp and dropped from the riser
          sort.
        </p>
        <p>
          Change is a ratio of sums — observed over expected — across the countlines at a site that
          have a baseline, over the same hours on both sides. The <code>Lines</code> column says how
          many of the site's countlines that was. {honesty.inference}
        </p>
        <p>{honesty.coverage}</p>
        <p>{honesty.manualWarning}</p>
        <p>{honesty.attribution}</p>
      </div>
    </details>
  );
}
