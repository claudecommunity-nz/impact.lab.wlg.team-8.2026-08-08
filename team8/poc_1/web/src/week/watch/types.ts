/**
 * The feed layer's shapes. Mirrors `pipeline/feeds.py` exactly.
 *
 * Two kinds of feed and one join between them:
 *   - advisement feeds  — what will move the numbers this week
 *   - risk-area feeds   — where a rise matters more
 *   - the area-risk join — movement inside a hazard polygon vs its forecast
 *
 * `AdvisementFeed.status` and `empty_reason` are the honesty pair. "No cruise
 * berthings this week" and "we never connected the cruise schedule" are
 * completely different facts to a duty officer, and a silent empty list
 * conflates them, so a feed with no items is required to carry its reason.
 */

import type { Advisement } from '../../data/types';

export type FeedStatus = 'connected' | 'hand-entered' | 'stub';

export interface AdvisementFeed {
  id: string;
  name: string;
  status: FeedStatus;
  /** True only for a feed read off a real source file. Drives no styling on
   *  its own — `status` does — but keeps the claim in the payload. */
  real: boolean;
  publisher: string;
  provenance: string;
  kind: 'advisement';
  items: number;
  /** Non-null exactly when `items` is 0. Always rendered. */
  empty_reason: string | null;
  file: string;
}

export interface RiskLayerRef {
  id: string;
  name: string;
  publisher: string;
  licence_note: string;
  /** Present when the polygons are already shipped for the map to draw. */
  geometry_file: string | null;
}

export interface FeedIndex {
  version: number;
  built_at: string;
  week_start: string;
  week_end: string;
  advisement_feeds: AdvisementFeed[];
  advisements_note: string;
  risk_layers: RiskLayerRef[];
  area_risk_file: string;
}

export interface FeedFile {
  feed: AdvisementFeed;
  items: Advisement[];
}

/** Series carried per area. Same three as the edge artefact, deliberately: the
 *  zone card and the edge card must not be able to disagree about what
 *  "Vehicles" means. */
export type AreaSeries = 'total' | 'pedestrian' | 'veh';

export interface RiskArea {
  id: string;
  layer: string;
  layer_name: string;
  publisher: string;
  licence_note: string;
  name: string;
  class: string;
  /** 1 is nearest the water / worst. Sorts the list before deviation does. */
  class_rank: number;
  detail: string | null;
  area_km2: number;
  sites: number;
  site_ids: string[];
  /** Named streets whose geometry falls inside the polygon — the citation. */
  streets: string[];
  n_streets: number;
  judged: boolean;
  /** null when no camera sits inside the polygon at all. */
  forecast: Record<AreaSeries, number[]> | null;
  actual: Record<AreaSeries, Array<number | null>> | null;
  dev: Record<AreaSeries, Array<number | null>> | null;
}

export interface AreaRiskFile {
  version: number;
  week_start: string;
  hours: number;
  confirmed_hours: number;
  series: AreaSeries[];
  min_sites: number;
  min_forecast_flow: number;
  n_areas: number;
  n_areas_judged: number;
  method: Record<string, string>;
  areas: RiskArea[];
}

export interface FeedBundle {
  index: FeedIndex;
  /** One entry per feed, in registry order, including the empty ones. */
  feeds: FeedFile[];
  areaRisk: AreaRiskFile;
}
