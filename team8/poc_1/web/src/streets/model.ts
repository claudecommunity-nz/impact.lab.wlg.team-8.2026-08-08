/**
 * The row model for the Streets table, and the five honest ways to rank it.
 *
 * Everything here is pure and derived once per (day × mode). The site
 * aggregation itself — the ratio-of-sums, the counted-member rule, the OR rule
 * for a reported hour — already happened in data/derive.ts; this file only
 * decides what a row SAYS and where it sits in the order.
 *
 * The one rule that governs the whole file: a site we could not score is never
 * given a number. It leaves the ranked list entirely and says why.
 */

import { HOURS, type DayModel, type SiteSeriesKey, type SiteStat, type SiteView } from '../data/derive';
import { signedPct } from '../copy/strings';
import type { CountlineIndex, DiagnosisCode, LineRecord, Mode, ModeFilter } from '../data/types';

/** The site series the mode filter is asking about. */
export const seriesKeyFor = (mode: ModeFilter): SiteSeriesKey =>
  mode === 'all' ? 'total' : mode;

export interface StreetRow {
  site: SiteView;
  /** stats for the active series — every cell in the row reads this, not total */
  stat: SiteStat;
  /** null whenever we are not entitled to a number. NEVER 0. */
  delta: number | null;
  /** day expected under 480 (20/hr × 24): keep the number, drop the ramp */
  belowFloor: boolean;
  /** mode filter is on and this mode carries no usable volume here */
  notViable: boolean;
  /** why this row is not scored, in words. null when it is scored. */
  unscoredReason: string | null;
  /** the ci selection lands on when the site row is clicked — the busiest
   *  member, because that is the one the site's sums are dominated by */
  primaryCi: number;
  /** any member sits on the CBD cordon */
  cbd: boolean;
  /** site name + every member name, lowercased, so `aro` finds the site */
  haystack: string;
}

export function buildRows(
  model: DayModel,
  index: CountlineIndex,
  key: SiteSeriesKey,
  modeFiltered: boolean,
): StreetRow[] {
  return model.sites.map((site) => {
    const stat = site.stats[key];
    const notViable = modeFiltered && !stat.viable;
    const delta = notViable ? null : stat.deltaPct;

    const dominant = (site.counted.length ? site.counted : site.members).reduce(
      (best, l) => (l.record.exp > best.record.exp ? l : best),
      (site.counted.length ? site.counted : site.members)[0],
    );

    return {
      site,
      stat,
      delta,
      belowFloor: stat.belowFloor,
      notViable,
      unscoredReason: delta === null ? reasonFor(model, site, stat, notViable) : null,
      primaryCi: dominant.ci,
      cbd: site.members.some((l) => index.cbd[l.ci] > 0),
      haystack: `${site.name} ${site.members.map((l) => l.name).join(' ')}`.toLowerCase(),
    };
  });
}

/**
 * Four distinct ways to have no number, and they are not interchangeable:
 * a dead sensor, a new sensor, a mode that does not run here, and a site too
 * quiet for a percentage to mean anything. Collapsing them into "—" is what
 * makes a tool untrustworthy.
 */
function reasonFor(model: DayModel, site: SiteView, stat: SiteStat, notViable: boolean): string {
  if (model.refused) return 'the day itself was not observed';
  if (site.hoursReported === 0) return 'reported nothing all day';
  if (notViable) return 'this mode carries no usable volume here';
  if (stat.basis === 0) return 'no comparable history for this sensor';
  return 'no hour cleared the volume floor';
}

/**
 * The Δ cell, in words when it cannot be a number. `no baseline` is spelled
 * out because `—` is already ambiguous with "not reported", and `0%` would be
 * a claim we have not earned.
 */
export function deltaLabel(row: StreetRow, refused: boolean): string {
  if (refused) return '—';
  if (row.delta !== null) return signedPct(row.delta, 1);
  if (row.notViable) return 'not viable here';
  if (row.site.hoursReported === 0) return 'not observed';
  if (row.stat.basis === 0) return 'no baseline';
  return 'cannot say';
}

/* ------------------------------------------------------------------ sorting */

export type SortKey = 'worst' | 'riser' | 'busiest' | 'coverage' | 'name';

export const SORTS: ReadonlyArray<{ key: SortKey; label: string; note?: string }> = [
  { key: 'worst', label: 'Worst first' },
  { key: 'riser', label: 'Biggest riser', note: 'sites above the volume floor only' },
  { key: 'busiest', label: 'Busiest' },
  { key: 'coverage', label: 'Least covered', note: 'what we could not see, first' },
  { key: 'name', label: 'Name A–Z' },
];

/** ascending / descending, for aria-sort on the Δ header. */
export const SORT_DIR: Record<SortKey, 'ascending' | 'descending'> = {
  worst: 'ascending',
  riser: 'descending',
  busiest: 'descending',
  coverage: 'ascending',
  name: 'ascending',
};

/**
 * Rank the scored rows. Unscored rows never reach here — sorting a null as 0
 * and sorting it as −∞ are both lies, so they sink to their own section.
 * The riser sort additionally drops sites under the volume floor, where +15%
 * is two extra pedestrians; the control says so.
 */
export function rankRows(rows: StreetRow[], sort: SortKey): StreetRow[] {
  const out = sort === 'riser' ? rows.filter((r) => !r.belowFloor) : [...rows];
  const d = (r: StreetRow) => r.delta ?? 0;
  switch (sort) {
    case 'worst':
      return out.sort((a, b) => d(a) - d(b) || b.stat.exp - a.stat.exp);
    case 'riser':
      return out.sort((a, b) => d(b) - d(a) || b.stat.exp - a.stat.exp);
    case 'busiest':
      return out.sort((a, b) => b.stat.exp - a.stat.exp);
    case 'coverage':
      return out.sort(
        (a, b) =>
          a.site.hoursReported - b.site.hoursReported ||
          a.stat.basis / a.site.members.length - b.stat.basis / b.site.members.length,
      );
    case 'name':
      return out.sort((a, b) => a.site.name.localeCompare(b.site.name, 'en-NZ'));
  }
}

export interface Filters {
  query: string;
  codes: ReadonlySet<DiagnosisCode>;
  scored: 'all' | 'scored' | 'unscored';
  cbdOnly: boolean;
}

export function filterRows(rows: StreetRow[], f: Filters): StreetRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.haystack.includes(q)) return false;
    if (f.codes.size && !f.codes.has(r.site.code)) return false;
    if (f.scored === 'scored' && r.delta === null) return false;
    if (f.scored === 'unscored' && r.delta !== null) return false;
    if (f.cbdOnly && !r.cbd) return false;
    return true;
  });
}

/* --------------------------------------------------------------- child rows */

/**
 * The descriptor half of a countline name — the direction, lane or surface that
 * the site's sum averaged away. `Luxford St road upper` → `road upper`.
 *
 * The token list mirrors derive.ts's `DESCRIPTOR`, which owns the other half of
 * the same split and is not exported. Worth collapsing into one exported helper
 * when that file is next open.
 */
const DESCRIPTOR =
  /^(road|path|crossing|cycle|kerb|rhskerb|lhskerb|sideroad|lane|left|right|upper|lower|top|bottom|north|south|east|west|nrth|sth|inbound|outbound|exit|entry|bus|turning|ramp|nzwel|s\d)/;

export function discriminatorOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    if (DESCRIPTOR.test(words[i].toLowerCase().split('/')[0])) return words.slice(i).join(' ');
  }
  return name;
}

/** Vehicles at member scale: car + bus + LGV, the same three derive.ts sums. */
const VEH_MODES: Mode[] = ['car', 'bus', 'lgv'];

export function memberVehicle(record: LineRecord): { deltaPct: number | null; viable: boolean } {
  let obs = 0;
  let exp = 0;
  let viable = false;
  for (const m of VEH_MODES) {
    obs += record.modes[m].obs;
    exp += record.modes[m].exp;
    viable ||= record.modes[m].viable;
  }
  return { deltaPct: exp > 0 ? ((obs - exp) / exp) * 100 : null, viable };
}

/**
 * A member's own 24 hours for one series, built on demand and cached against
 * the day model. Only expanded sites pay for it (a median of 3 members), and
 * the arrays are handed back by the same reference every render so
 * VitalsTrace's useMemo survives — building them inline would recompute every
 * path on every tick.
 */
const memberCache = new WeakMap<DayModel, Map<string, { actual: Float32Array; expected: Float32Array }>>();

export function memberSeries(
  model: DayModel,
  i: number,
  key: SiteSeriesKey,
): { actual: Float32Array; expected: Float32Array } {
  let byKey = memberCache.get(model);
  if (!byKey) {
    byKey = new Map();
    memberCache.set(model, byKey);
  }
  const id = `${i}:${key}`;
  const hit = byKey.get(id);
  if (hit) return hit;

  const src = key === 'veh' ? null : key;
  const actual = new Float32Array(HOURS);
  const expected = new Float32Array(HOURS);
  for (let h = 0; h < HOURS; h++) {
    const k = i * HOURS + h;
    if (src) {
      actual[h] = model.file.actual[src][k];
      expected[h] = model.file.expected[src][k];
    } else {
      for (const m of VEH_MODES) {
        actual[h] += model.file.actual[m][k];
        expected[h] += model.file.expected[m][k];
      }
    }
  }
  const built = { actual, expected };
  byKey.set(id, built);
  return built;
}

/* ------------------------------------------------------------ accessibility */

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function gapClause(gaps: Array<[number, number]>): string {
  if (gaps.length === 0) return 'Every hour reported.';
  const parts = gaps.map(([a, b]) =>
    b - a === 1 ? `hour ${a}` : `hours ${a} to ${b - 1}`,
  );
  return `Not reported: ${parts.join(', ')}.`;
}

/**
 * The trace said out loud. Generated, never hand-written, and the word "zero"
 * is never allowed to stand in for an hour the feed did not deliver.
 */
export function traceSummary(row: StreetRow, key: SiteSeriesKey, refused: boolean): string {
  const { site, stat } = row;
  const head = `${site.name}. ${site.hoursReported} of 24 hours reported.`;
  if (refused) {
    return `${head} Trace cut — the feed stopped part-way through this day, so nothing here is scored. ${gapClause(site.gaps)}`;
  }
  if (stat.basis === 0) {
    return `${head} No expected line — this site has no comparable history. Observed volume only: ${stat.obsAll.toLocaleString('en-NZ')} movements. ${gapClause(site.gaps)}`;
  }
  const over =
    site.hoursReported < HOURS ? ` over the ${site.hoursReported} hours it reported` : '';
  const counts = `Observed ${stat.obs.toLocaleString('en-NZ')}, expected ${stat.exp.toLocaleString('en-NZ')}${over}`;
  if (row.delta === null) {
    return `${head} ${counts}, but not scored: ${row.unscoredReason}. ${gapClause(site.gaps)}`;
  }

  const { actual, expected } = site.series[key];
  let worstHour = -1;
  let worstOff = 0;
  for (let h = 0; h < HOURS; h++) {
    if (expected[h] <= 0) continue;
    const off = (actual[h] - expected[h]) / expected[h];
    if (off < worstOff) {
      worstOff = off;
      worstHour = h;
    }
  }
  const sign = row.delta < 0 ? 'down' : 'up';
  const trough =
    worstHour < 0
      ? ''
      : ` Furthest below expected at ${hh(worstHour)}, ${Math.round(-worstOff * 100)}% below.`;
  return `${head} ${counts}, ${Math.abs(row.delta).toFixed(0)}% ${sign}.${trough} ${gapClause(site.gaps)}`;
}
