/**
 * The week view's pure functions. No React, no fetching, no colour.
 *
 * Its whole job is the two mode mappings. The app's mode filter is a five-value
 * union built for the per-countline map; the week artefact and the edge
 * artefact each publish a DIFFERENT, smaller set of series, and picking the
 * wrong member is how "Vehicles" silently becomes "cars only" in one card and
 * "cars + buses + LGVs" in the next.
 */

import { EDGE_JUDGED_MIN_SENSORS, type Edge, type EdgeSeries, type ModeFilter, type WeekSeries } from '../data/types';

/**
 * The Vehicles pill dispatches mode 'car' — it predates the edge artefact. On
 * the week it means `veh` (car + bus + LGV), which is what the pill's LABEL
 * has always said and what the edge artefact publishes.
 */
export function weekSeriesFor(mode: ModeFilter): WeekSeries {
  if (mode === 'all') return 'total';
  if (mode === 'car') return 'veh';
  return mode;
}

/** Edges are hourly for three series only; anything else falls back to total. */
export function edgeSeriesFor(mode: ModeFilter): EdgeSeries {
  if (mode === 'pedestrian') return 'pedestrian';
  if (mode === 'car') return 'veh';
  return 'total';
}

export const isJudged = (e: Edge): boolean => e.sensors >= EDGE_JUDGED_MIN_SENSORS;

export interface RankedEdge {
  edge: Edge;
  /** Signed deviation at the cursor hour, or null where we declined to judge. */
  dev: number | null;
  flow: number | null;
  /** What the hour was expected to carry — the percentage's denominator. */
  forecast: number;
  judged: boolean;
}

/**
 * How many movements an hour must be FORECAST before a percentage on it is
 * shown as a finding.
 *
 * The pipeline already nulls `dev` under 5/hr. That is the right floor for the
 * artefact and the wrong one for a ranked list: at 5 expected pedestrians, one
 * missing person is −20% and an empty hour is −100%, so the top six came out as
 * six different back streets all reading exactly −100% at 0/hr and the actual
 * event was nowhere on the list. Ties at the extreme are what a ratio does to a
 * small denominator, not what a city does.
 */
export const MIN_FORECAST_FLOW = 20;

/**
 * Edges off forecast at one hour, biggest absolute miss first.
 *
 * Unjudged edges (one camera speaking for a whole street) are ranked with
 * everything else and greyed by the caller, never dropped: hiding them would
 * make the list look like complete coverage of a city with 123 sensors on it.
 */
export function edgesByDeviation(
  edges: Edge[],
  series: EdgeSeries,
  weekHour: number,
  limit?: number,
  minForecastFlow = MIN_FORECAST_FLOW,
): RankedEdge[] {
  const ranked = edges
    .map((edge) => ({
      edge,
      dev: edge.dev[series]?.[weekHour] ?? null,
      flow: edge.flow[weekHour] ?? null,
      forecast: edge.forecast_flow[weekHour] ?? 0,
      judged: isJudged(edge),
    }))
    .filter((r) => r.dev !== null && r.forecast >= minForecastFlow)
    // Judged first, THEN by size of miss. Sorting on |dev| alone filled every
    // slot with single-sensor edges reading exactly −100% at 0/hr: one camera
    // that stopped reporting outranks a real citywide event, and the card whose
    // job is "where should I look" then points at five sensor faults. The
    // unjudged still appear, greyed, once the judged run out — which is the
    // honest ordering, not a filter.
    .sort(
      (a, b) =>
        Number(b.judged) - Number(a.judged) ||
        Math.abs(b.dev as number) - Math.abs(a.dev as number),
    );
  return limit == null ? ranked : ranked.slice(0, limit);
}
