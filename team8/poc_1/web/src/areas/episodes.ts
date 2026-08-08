/**
 * Episodes — the difference between "what is the deviation this hour" and
 * "what has been flagged, for how long, and is it still going".
 *
 * The week card answers the first question, which is the question an hourly
 * cursor can answer. A duty officer asks the second one. An episode is a run of
 * consecutive hours where the deviation inside one hazard footprint stays past
 * the threshold in the same direction — so it survives the cursor moving, and
 * it can be read as an incident rather than a reading.
 *
 * Derived entirely client-side from `dev` in area-risk.json. Nothing here
 * infers a cause: the run is measured, and the cause is only ever whatever a
 * connected feed already says covers those hours.
 */

import type { Advisement } from '../data/types';
import type { AreaSeries, RiskArea } from '../week/watch/types';

/**
 * Past this, in signed percent, an hour is flagged.
 *
 * The citywide dead zone is ±8% and a zone sums 5–35 cameras, so 8% is the
 * ordinary breathing of a weekday. 12% is the first band where a run of hours
 * is worth a duty officer's attention; anything lower flags every zone in the
 * city every morning, which is the same as flagging none.
 */
export const EPISODE_THRESHOLD_PCT = 12;

/** An episode has to last. One hour past the threshold is an hour, not an event. */
export const EPISODE_MIN_HOURS = 2;

/**
 * One hour under the threshold does not end a run.
 *
 * A drop that dips back inside the band for a single hour and out again is one
 * episode, not two — splitting it would report the same incident twice and
 * halve both durations.
 */
const GAP_TOLERANCE = 1;

export interface Episode {
  area: RiskArea;
  series: AreaSeries;
  /** Week-hour indices, inclusive. Hour 0 is 00:00 on the week's Monday. */
  start: number;
  end: number;
  hours: number;
  /** Signed. The extreme value in the run's direction. */
  peak: number;
  peakHour: number;
  min: number;
  max: number;
  /** max − min, in percentage points. How much it moved while flagged. */
  spread: number;
  mean: number;
  /** −1 people left, +1 people gathered. */
  sign: -1 | 1;
  /** The run reaches the cursor: it has not ended. */
  ongoing: boolean;
  /** Summed over the flagged hours, so the counts match the claim. */
  actual: number;
  forecast: number;
  /** A connected or hand-entered feed covering these hours, or null. NEVER guessed. */
  cause: Advisement | null;
  /** Other hazard footprints holding the same cameras. Zones nest. */
  overlaps: string[];
}

const dedupe = (xs: string[]): string[] => Array.from(new Set(xs));

/**
 * Which other footprints share a camera with this one.
 *
 * Not a caveat — a finding. The same movement sits inside three polygons at
 * once, so one drop legitimately raises three alerts, and a reader who is not
 * told that will read three independent confirmations into one measurement.
 */
function overlapsOf(area: RiskArea, areas: RiskArea[]): string[] {
  const mine = new Set(area.site_ids);
  return dedupe(
    areas
      .filter((o) => o.id !== area.id && o.site_ids.some((s) => mine.has(s)))
      .map((o) => o.class),
  );
}

/**
 * The advisement covering these hours, if one exists.
 *
 * Overlap in absolute time, nothing cleverer. No geography test and no
 * keyword match: a feed item either covers the window or it does not, and
 * "close enough" is how a tool starts inventing causes.
 */
function causeFor(
  items: Advisement[],
  weekStart: string,
  start: number,
  end: number,
): Advisement | null {
  const t0 = new Date(`${weekStart}T00:00`).getTime() + start * 3_600_000;
  const t1 = new Date(`${weekStart}T00:00`).getTime() + (end + 1) * 3_600_000;
  return (
    items.find((a) => {
      if (!a.starts) return false;
      const s = new Date(a.starts).getTime();
      const e = a.ends ? new Date(a.ends).getTime() : s + 3_600_000;
      return s < t1 && e > t0;
    }) ?? null
  );
}

export interface EpisodeOptions {
  areas: RiskArea[];
  series: AreaSeries;
  /** Week-hour the cursor sits on. Nothing after it has happened yet, to the reader. */
  cursorHour: number;
  /** Hours at and after this index have no actual and never will until T+1 catches up. */
  confirmedHours: number;
  weekStart: string;
  advisements: Advisement[];
}

/**
 * Every episode in the week up to the cursor, newest first.
 *
 * Hard-stopped at `confirmed_hours`: past the T+1 horizon there is no actual,
 * so there is no deviation, so there is nothing to flag. A tool that ran its
 * detector over nulls would report the future as calm.
 */
export function findEpisodes({
  areas,
  series,
  cursorHour,
  confirmedHours,
  weekStart,
  advisements,
}: EpisodeOptions): Episode[] {
  const last = Math.min(cursorHour, confirmedHours - 1);
  const out: Episode[] = [];

  for (const area of areas) {
    const dev = area.dev?.[series];
    if (!dev || !area.judged) continue;
    const overlaps = overlapsOf(area, areas);

    let i = 0;
    while (i <= last) {
      const v = dev[i];
      if (v == null || Math.abs(v) < EPISODE_THRESHOLD_PCT) {
        i++;
        continue;
      }
      const sign: -1 | 1 = v < 0 ? -1 : 1;

      // Walk forward while the deviation keeps its direction and magnitude,
      // forgiving a single hour back inside the band.
      let end = i;
      let j = i;
      while (j <= last && j - end <= GAP_TOLERANCE) {
        const w = dev[j];
        if (w != null && Math.abs(w) >= EPISODE_THRESHOLD_PCT && Math.sign(w) === sign) end = j;
        j++;
      }

      const hours = end - i + 1;
      if (hours >= EPISODE_MIN_HOURS) {
        const idx = Array.from({ length: hours }, (_, k) => i + k);
        const vals = idx.map((k) => dev[k]).filter((x): x is number => x != null);
        const peak = sign < 0 ? Math.min(...vals) : Math.max(...vals);
        const sum = (pick: (k: number) => number | null | undefined) =>
          idx.reduce((acc, k) => acc + (pick(k) ?? 0), 0);

        out.push({
          area,
          series,
          start: i,
          end,
          hours,
          peak,
          peakHour: idx.find((k) => dev[k] === peak) ?? i,
          min: Math.min(...vals),
          max: Math.max(...vals),
          spread: Math.max(...vals) - Math.min(...vals),
          mean: vals.reduce((a, b) => a + b, 0) / vals.length,
          sign,
          // "Still flagged" means the run reaches the cursor. The gap tolerance
          // applies here too, or an episode that dipped on the cursor hour
          // would be reported as over when it is not.
          ongoing: end >= last - GAP_TOLERANCE,
          actual: sum((k) => area.actual?.[series][k]),
          forecast: sum((k) => area.forecast?.[series][k]),
          cause: causeFor(advisements, weekStart, i, end),
          overlaps,
        });
      }
      i = end + 1;
    }
  }

  // Newest first: what is still happening is what a duty officer opens this for.
  return out.sort((a, b) => b.end - a.end || b.start - a.start);
}

export type EpisodeFilter = 'all' | 'down' | 'up' | 'unexplained';

export const FILTERS: ReadonlyArray<{ key: EpisodeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'down', label: 'People left' },
  { key: 'up', label: 'People gathered' },
  { key: 'unexplained', label: 'No stated cause' },
];

export const applyFilter = (eps: Episode[], f: EpisodeFilter): Episode[] =>
  f === 'all'
    ? eps
    : eps.filter((e) =>
        f === 'down' ? e.sign < 0 : f === 'up' ? e.sign > 0 : e.cause == null,
      );
