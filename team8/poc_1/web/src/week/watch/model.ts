/**
 * The compounding read, as pure functions. No React, no fetching, no colour.
 *
 * The product argument this file encodes: a deviation is worth more when you
 * know WHERE it is. More people than forecast inside a tsunami evacuation zone
 * is a materially worse fact than the same rise on safe ground, and fewer
 * people than forecast inside one — under an issued warning — is evidence the
 * message landed. Same number, two readings, and only the join tells them apart.
 */

import type { Advisement } from '../../data/types';
import type { AreaSeries, FeedBundle, RiskArea } from './types';

/**
 * Below this, an area is "on forecast" and gets no verb.
 *
 * Matches the citywide dead zone in copy/strings. A zone sums 20–35 cameras, so
 * ±5% is the ordinary breathing of a weekday and calling it a finding would
 * flag a hazard zone every hour of the week — which is the same as never
 * flagging one.
 */
export const AREA_DEADBAND_PCT = 8;

export interface RankedArea {
  area: RiskArea;
  /** Signed deviation at the cursor hour, null where we declined to judge. */
  dev: number | null;
  actual: number | null;
  forecast: number | null;
  /** Enough cameras inside the polygon to say anything at all. */
  judged: boolean;
  /** Past the dead zone, so it carries a verb rather than "on forecast". */
  material: boolean;
}

export function rankAreas(
  areas: RiskArea[],
  series: AreaSeries,
  weekHour: number,
): RankedArea[] {
  return areas
    .map((area) => {
      const dev = area.dev?.[series][weekHour] ?? null;
      return {
        area,
        dev,
        actual: area.actual?.[series][weekHour] ?? null,
        forecast: area.forecast?.[series][weekHour] ?? null,
        judged: area.judged && dev !== null,
        material: dev !== null && Math.abs(dev) >= AREA_DEADBAND_PCT,
      };
    })
    // Judged first, then by size of miss. An unwatched zone is never ranked
    // above a measured one — but it is not dropped either, because "no camera
    // is inside this zone" is the finding a duty officer most needs and the one
    // a filtered list would silently delete.
    .sort(
      (a, b) =>
        Number(b.judged) - Number(a.judged) ||
        Math.abs(b.dev ?? 0) - Math.abs(a.dev ?? 0),
    );
}

/** Zones nest — a shore-exclusion zone sits inside a CDEM zone sits inside a
 *  self-evacuation zone — so one camera is legitimately inside three of them.
 *  Only the tightest ring gets the lead statement; the rest are context. */
export const leadArea = (rows: RankedArea[]): RankedArea | null =>
  rows.find((r) => r.judged && r.material) ?? rows.find((r) => r.judged) ?? null;

const NOUN: Record<AreaSeries, string> = {
  total: 'movements',
  pedestrian: 'pedestrian movements',
  veh: 'vehicle movements',
};

export interface AreaStatement {
  /** The figure, alone, so it can be read at a glance. */
  claim: string;
  /** Which hazard area the figure belongs to. Sits beside the claim. */
  zone: string;
  /** What that means for a duty officer. Never a cause. */
  reading: string;
  /** The arithmetic and the citation, so the claim can be checked not believed. */
  evidence: string;
}

/**
 * Which advisement sources count as a WARNING for the compliance read.
 *
 * "Fewer people than expected, which is what compliance looks like" is a claim
 * about a message being heeded, and it is nonsense with no message. It first
 * shipped ungated and rendered under a −67% on a Tuesday with nothing issued —
 * a causal story invented out of a quiet hour, which is precisely what this
 * project argues against. A road closure is not a warning to the public, so
 * only the weather feed qualifies.
 */
const WARNING_SOURCES = ['metservice-warnings'];

/**
 * The warning covering this hour, if any. `weekStart` is the week's Monday;
 * hour 0 is 00:00 that day.
 */
export function warningAt(
  items: Advisement[],
  weekStart: string,
  weekHour: number,
): Advisement | null {
  const t = new Date(`${weekStart}T00:00`).getTime() + weekHour * 3_600_000;
  return (
    items.find((a) => {
      if (!WARNING_SOURCES.includes(a.source) || !a.starts) return false;
      const s = new Date(a.starts).getTime();
      const e = a.ends ? new Date(a.ends).getTime() : s + 3_600_000;
      return t >= s && t <= e;
    }) ?? null
  );
}

/**
 * The statement, built from the numbers rather than written.
 *
 * Split into three short blocks rather than one sentence because the sentence
 * ran to five lines in a 330px column and pushed the edge list off the screen —
 * a claim nobody scrolls to is worse than a shorter claim.
 *
 * Both directions are findings and both are in the thesis: a rise inside a
 * hazard area is where additional risk concentrates; a fall inside one, under a
 * warning, is the only evidence anyone has that the warning was heeded. Neither
 * is stated as a cause.
 */
export function statementFor(
  r: RankedArea,
  series: AreaSeries,
  warning: Advisement | null = null,
): AreaStatement {
  const { area, dev, actual, forecast } = r;
  const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-NZ'));
  // One street name, not four. The list is a citation, not an inventory: it
  // exists so "inside the zone" can be checked, and the full count beside it
  // says how much was left out. Every extra name cost a line in a 330px column.
  const streets = area.streets.slice(0, 1).join(', ');
  const evidence =
    `${n(actual)} ${NOUN[series]} vs ${n(forecast)} forecast · ` +
    `${area.sites} cameras on ${area.n_streets} street` +
    `${area.n_streets === 1 ? '' : 's'}${streets ? `, incl. ${streets}` : ''}`;

  if (!r.material || dev == null) {
    return {
      claim: 'on forecast',
      zone: area.class,
      reading: `${area.name} — no more movement inside this hazard area than an ordinary week puts there.`,
      evidence,
    };
  }
  return {
    claim: `${dev > 0 ? '+' : '−'}${Math.abs(dev)}%`,
    zone: area.class,
    reading:
      `${area.name} — ` +
      (dev > 0
        ? 'more people than expected in an area with a known hazard.'
        : warning
          ? `fewer people than expected under the ${warning.title.toLowerCase()}, which is evidence the message landed.`
          : 'fewer people than expected inside a known hazard area. No warning is in force, so this is a drop with no stated reason.'),
    evidence,
  };
}

/** "6 of 9 hazard areas have no camera inside them." The absence statement is
 *  a required output, not a caveat: a zone we cannot see is not a quiet zone. */
export function coverageNote(areas: RiskArea[], minSites: number): string {
  const unwatched = areas.filter((a) => a.sites === 0).length;
  const thin = areas.filter((a) => a.sites > 0 && !a.judged).length;
  const under = thin ? `, ${thin} under the ${minSites}-camera floor` : '';
  return `${unwatched} of ${areas.length} hazard areas have no camera inside them${under} — unwatched, not quiet.`;
}

/** Every advisement the feed layer found, in registry order. WeekView merges
 *  these with the ones the week artefact derived from the closure layer, and
 *  that merge is the only place in the app that knows where a feed comes from. */
export const advisementsFrom = (bundle: FeedBundle | null): Advisement[] =>
  bundle?.feeds.flatMap((f) => f.items) ?? [];
