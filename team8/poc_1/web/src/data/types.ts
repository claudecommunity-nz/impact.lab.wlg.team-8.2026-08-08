/**
 * The Python↔browser data contract. Mirrors what pipeline/emit.py actually
 * writes into web/public/data/ — verified against the artefacts on disk, not
 * against the architecture sketch.
 *
 * Nothing here fetches. See load.ts.
 */

export type IsoDate = string; // 'YYYY-MM-DD'

export const MODES = ['pedestrian', 'cyclist', 'car', 'bus', 'lgv'] as const;
export type Mode = (typeof MODES)[number];
export type ModeFilter = 'all' | Mode;

/* ------------------------------------------------------------------ *
 * Diagnosis — typed by the RATIO of per-mode change, never by magnitude.
 * The pipeline emits strings; the UI carries a numeric code because the
 * chip/glyph tables are indexed by it. `cannot_type` is the majority and
 * is a first-class value, never a silent fallback.
 * ------------------------------------------------------------------ */

export const DIAGNOSIS_KEYS = [
  'exposure_hazard',
  'road_closure',
  'loss_of_access',
  'closed_to_traffic_open_to_people',
  'elevated',
  'normal',
  'cannot_type',
  'no_baseline',
  'not_observed',
] as const;
export type DiagnosisKey = (typeof DIAGNOSIS_KEYS)[number];

export const DiagnosisCode = {
  CANNOT_TYPE: 0,
  EXPOSURE: 1,
  ROAD_CLOSURE: 2,
  LOSS_OF_ACCESS: 3,
  PEOPLE_NOT_TRAFFIC: 4,
  ELEVATED: 5,
  NORMAL: 6,
  NO_BASELINE: 7,
  NOT_OBSERVED: 8,
} as const;
export type DiagnosisCode = (typeof DiagnosisCode)[keyof typeof DiagnosisCode];

export const CODE_FOR_KEY: Record<DiagnosisKey, DiagnosisCode> = {
  exposure_hazard: DiagnosisCode.EXPOSURE,
  road_closure: DiagnosisCode.ROAD_CLOSURE,
  loss_of_access: DiagnosisCode.LOSS_OF_ACCESS,
  closed_to_traffic_open_to_people: DiagnosisCode.PEOPLE_NOT_TRAFFIC,
  elevated: DiagnosisCode.ELEVATED,
  normal: DiagnosisCode.NORMAL,
  cannot_type: DiagnosisCode.CANNOT_TYPE,
  no_baseline: DiagnosisCode.NO_BASELINE,
  not_observed: DiagnosisCode.NOT_OBSERVED,
};

/** The four diagnoses that name a cause. Everything else is an admission. */
export const TYPED_DIAGNOSES: DiagnosisKey[] = [
  'exposure_hazard',
  'road_closure',
  'loss_of_access',
  'closed_to_traffic_open_to_people',
];

/** 0 none / 1 low / 2 ok. Drives the "cannot type" majority. */
export type Confidence = 0 | 1 | 2;

export const confidenceOf = (c: 'high' | 'low'): Confidence => (c === 'high' ? 2 : 1);

/* ------------------------------------------------------------------ manifest */

export interface ManifestDay {
  date: IsoDate;
  weekday: string;
  role: 'event' | 'healthy' | 'refusal' | 'latest';
  label: string;
  verdict: 'assessed' | 'refused';
  file: string;
  context_file: string;
  n: number;
  citywide_delta_pct: number | null;
}

export interface GisLayerMeta {
  id: string;
  file: string;
  publisher: string;
  licence_note: string;
  features: number;
  transform: string;
}

export interface Manifest {
  version: number;
  built_at: string;
  data_vintage: { movement_latest_date: IsoDate; feed_lag: string };
  /** The whole network, counted by the pipeline. A day covers fewer sites than
   *  this, and the difference is the ten-odd cameras that delivered nothing —
   *  which is the point, so both numbers are shown together, never apart. */
  network: { camera_sites: number; countlines: number; note: string };
  baseline_params: Record<string, string | number | boolean>;
  diagnoses: DiagnosisKey[];
  days: ManifestDay[];
  vitals: Array<{ file: string; start: IsoDate; end: IsoDate; hours: number }>;
  countlines_file: string;
  gis_layers: GisLayerMeta[];
  gis_layers_omitted: Array<{ id: string; reason: string }>;
  disclaimers: {
    not_live: string;
    hazard_planning_only: string;
    emergency: string;
    sparse_coverage: string;
    warning_provenance: string;
  };
  attribution: { movement: string; gis: string; basemap: string };
}

/* --------------------------------------------------------------- countlines */

export interface CountlineIndex {
  version: number;
  n: number;
  ids: string[];
  names: string[];
  /**
   * The vendor's camera (`viewpoint_id`), added in version 2. One viewpoint
   * carries a median of 3 countlines — one per direction, per lane, per
   * path-vs-road — so this is the grouping the map rolls up on. Never null:
   * a countline the vendor left unassigned gets `cl:<countline_id>`.
   */
  viewpoint: string[];
  /** [lat_start, lon_start, lat_end, lon_end] */
  geom: Array<[number, number, number, number]>;
  /** [lat, lon] */
  mid: Array<[number, number]>;
  cbd: number[];
  group: Array<string | null>;
  first_seen: IsoDate[];
  last_seen: IsoDate[];
  active: number[];
  note: string;
}

/* --------------------------------------------------------------- day file */

export interface ModeStat {
  obs: number;
  exp: number;
  delta_pct: number | null;
  viable: boolean;
}

export interface LineRecord {
  i: number;
  ci: number;
  obs: number;
  exp: number;
  /** null on lines with no baseline at all — never coerce it to 0. */
  delta_pct: number | null;
  z: number;
  baseline_n: number;
  hours_reported: number;
  reporting_rate: number;
  diagnosis: DiagnosisKey;
  diagnosis_reason: string;
  confidence: 'high' | 'low';
  modes: Record<Mode, ModeStat>;
  caveats: string[];
}

export interface Refusal {
  reason: string;
  hours_reported: number;
  hours_present: number[];
  hours_missing: number[];
  threshold: number;
  naive_delta_pct: number;
  message: string;
  seam: { note: string; partner_date: IsoDate };
}

export interface DaySummary {
  citywide_obs: number;
  citywide_exp: number;
  citywide_delta_pct: number | null;
  /** Lines the citywide ratio is computed over — both sides use this set. */
  citywide_basis_lines: number;
  lines_assessed: number;
  lines_unscorable: number;
  diagnosis_counts: Record<DiagnosisKey, number>;
  headline: string;
  worst: number[];
  /** Only lines that actually rose. Often short, sometimes empty. */
  risers: number[];
  least_affected: number[];
  lines_ranked: number;
  note: string;
  neighbour_check: {
    peers: IsoDate[];
    peer_totals: number[];
    peer_deltas_pct: number[];
    raw_obs: number;
    delta_pct: number;
    note: string;
  };
}

export type MatrixSet = Record<'total' | Mode, number[]>;

export interface DayFile {
  version: number;
  date: IsoDate;
  weekday: string;
  verdict: 'assessed' | 'refused';
  refusal: Refusal | null;
  n: number;
  line_index: number[];
  layout: { order: string; stride: number; length: number; cell: string };
  coverage: {
    hours_reported: number;
    hours_missing: number[];
    lines_reporting: number;
    lines_in_index: number;
    cells_present: number;
    cells_expected: number;
    cell_presence_pct: number;
    note: string;
  };
  actual: MatrixSet;
  expected: MatrixSet;
  expected_mad: Record<'total' | 'pedestrian' | 'car', number[]>;
  /** base64 packed bitset, LSB-first, n*24. 1 = the feed delivered that cell. */
  reported: string;
  /** base64 packed bitset, n*24. 1 = we are entitled to score that cell. */
  scorable: string;
  baseline: { dates: IsoDate[]; n_days: number; weekday: string };
  lines: LineRecord[];
  summary: DaySummary;
  freshness?: { feed_lag_days: number; as_of: IsoDate; note: string };
}

/* --------------------------------------------------------------- vitals */

export interface VitalsFile {
  version: number;
  start: IsoDate;
  end: IsoDate;
  tz: string;
  hours: number;
  t0: string;
  actual: { total: number[]; pedestrian: number[]; car: number[] };
  expected: { total: number[]; pedestrian: number[]; car: number[] };
  band_lo: { total: number[]; pedestrian: number[]; car: number[] };
  band_hi: { total: number[]; pedestrian: number[]; car: number[] };
  /** 0 scorable · 1 partial ingest (render as a GAP) · 2 holiday · 3 thin baseline */
  flags: number[];
  flag_legend: Record<string, string>;
  day_index: Array<{
    date: IsoDate;
    offset: number;
    weekday: string;
    verdict: string;
    total: number;
    delta_pct: number | null;
    marker: null | { kind: string; label: string };
  }>;
}

/* --------------------------------------------------------------- context */

export interface ProvenancedItem {
  provenance?: string;
  caveat?: string;
  source_note?: string;
  [k: string]: unknown;
}

export interface ContextFile {
  date: IsoDate;
  weekday: string;
  warnings: Array<
    ProvenancedItem & {
      type: string;
      level: string;
      region: string;
      valid_from: string;
      valid_until: string;
      headline: string;
    }
  >;
  warnings_note: string | null;
  transport: Array<ProvenancedItem & { kind: string; status: string; window: string[]; detail: string }>;
  council: Array<ProvenancedItem & { kind: string; detail: string }>;
  quakes: Array<{ time: string; mag: number; depth_km: number; lat: number; lon: number; felt: boolean }>;
  quakes_verdict: string;
  quakes_note: string;
  road_closures: unknown | null;
  road_closures_note: string;
  holiday: null | { name: string };
}

/* --------------------------------------------------------------- render mode */

export type RenderMode = 'pulse' | 'blind';

export type LayerId = 'ghost' | 'diagnosis' | 'coverage' | 'hubs' | 'tsunami' | 'routes' | 'closures';

/* ------------------------------------------------------------------ week *
 * data/week.json — the 168-hour Monday-anchored week. The reframe: a duty
 * officer's brief is the week ahead, not yesterday's incident.
 *
 * `veh` = car + bus + lgv. It adds up exactly in `actual` and does NOT in
 * baseline/forecast/band, because medians do not add. Read one series; never
 * sum series.
 */

export const WEEK_SERIES = ['total', 'pedestrian', 'cyclist', 'car', 'bus', 'lgv', 'veh'] as const;
export type WeekSeries = (typeof WEEK_SERIES)[number];

/** One number per series. */
export type SeriesTotals = Record<WeekSeries, number>;
/** 168 values per series. `actual` is null from `confirmed_hours` onward. */
export type SeriesHours = Record<WeekSeries, number[]>;
export type SeriesHoursNullable = Record<WeekSeries, Array<number | null>>;

/**
 * confirmed = every hour in, partial = today so far, forecast = has not
 * happened. The distinction is load-bearing: a forecast day must never be
 * rendered the way a measured day is.
 */
export type WeekDayState = 'confirmed' | 'partial' | 'forecast';

export interface WeekDay {
  date: IsoDate;
  weekday: string;
  short: string; // "MON 3"
  dow: number; // 0 = Monday
  offset: number; // hour-of-week of this day's midnight
  state: WeekDayState;
  confirmed_hours: number;
  baseline_n: number;
  forecast: SeriesTotals;
  /** Forecast for the hours that have happened — the honest denominator for a
   *  part-day. Comparing a part-day against a whole-day forecast reads −66%. */
  forecast_to_date: SeriesTotals | null;
  actual: SeriesTotals | null;
  deviation_pct: SeriesTotals | null;
  band_lo: SeriesTotals;
  band_hi: SeriesTotals;
}

/**
 * "What to watch this week" — what a duty officer should EXPECT to move the
 * numbers. Deliberately a FEED, not a hardcoded list: a stadium calendar, a
 * MetService warning or a cruise-berth schedule all land in this shape.
 *
 * `applied` is the honesty flag. Nothing invented may move a published number,
 * so an item only reads `applied: true` when a real record with a measured
 * effect size drove the forecast.
 */
export interface Advisement {
  id?: string;
  /** Human window, e.g. "WED 17–22". Pre-formatted by the feed. */
  when: string;
  title: string;
  detail?: string | null;
  /** Signed percent the feed expects this to move movement. null = unquantified. */
  expected_delta_pct?: number | null;
  source: string;
  hand_entered?: boolean;
  applied: boolean;
  starts?: string | null;
  ends?: string | null;
}

/** The persistent caveats — roadworks, dark sensors, sites with no baseline. */
export interface StandingCondition {
  source: string;
  kind: string;
  tag: string; // ROADWORKS | SENSOR | NEW SITES | COVERAGE
  window: string;
  title: string;
  detail?: string | null;
  count?: number;
  count_all_week?: number;
  of?: number;
  reporting_newest_day?: number;
  effect?: string | null;
  provenance?: string;
  starts?: string | null;
  ends?: string | null;
}

export interface WeekFile {
  version: number;
  week_start: IsoDate;
  week_end: IsoDate;
  iso_week: number;
  label: string; // "WEEK 32 · 3–9 AUG"
  tz: string;
  t0: string;
  hours: number; // 168
  confirmed_hours: number;
  horizon: {
    cursor_index: number;
    last_confirmed_hour: string;
    newest_data_date: IsoDate;
    feed_lag: string;
    note: string;
  };
  series: WeekSeries[];
  series_note: string;
  baseline: SeriesHours;
  forecast: SeriesHours;
  band_lo: SeriesHours;
  band_hi: SeriesHours;
  actual: SeriesHoursNullable;
  days: WeekDay[];
  week: {
    forecast: SeriesTotals;
    forecast_to_date: SeriesTotals;
    actual_to_date: SeriesTotals;
    deviation_pct: SeriesTotals;
  };
  day_factors: {
    reference_day_total: number;
    factor: Record<string, number>;
    n_days: Record<string, number>;
    applied_to_forecast: boolean;
    note: string;
  };
  model: {
    formula: string;
    baseline: string;
    trend_factor: number;
    trend_rule: string;
    band: string;
    out_of_sample: string;
    events_applied: number;
  };
  advisements: Advisement[];
  advisements_note: string;
  standing_conditions: StandingCondition[];
}

/* ----------------------------------------------------------------- edges *
 * data/edges.json — camera sites projected onto WCC road centrelines. An
 * edge's numbers are INFERRED from up to four sensors; they are not a
 * measurement of the whole stretch of street.
 */

export const EDGE_SERIES = ['total', 'pedestrian', 'veh'] as const;
export type EdgeSeries = (typeof EDGE_SERIES)[number];

export interface Edge {
  id: string;
  name: string;
  suburb: string | null;
  road_category: string | null;
  onrc: string | null;
  /** What the SENSORS on this edge count, not what the line is drawn as. */
  type: 'road' | 'footpath' | 'cycleway';
  length_m: number;
  /** Array of polylines, [lon,lat] at 5dp — straight into a deck.gl PathLayer. */
  path: number[][][];
  sensors: number;
  sensors_direct: number;
  /** viewpoint_id, as published: STRINGS. They are the same keys `bySiteId` is
   *  built on, and typing them as numbers made every site lookup silently miss. */
  sensor_sites: string[];
  weights: Record<string, number>;
  /** Mean over confirmed hours. Use for line WEIGHT. */
  flow_per_hour: number | null;
  forecast_flow: number[];
  flow: Array<number | null>;
  /** Signed %, clamped ±200, null where the forecast is under 5/hr. COLOUR. */
  dev: Record<EdgeSeries, Array<number | null>>;
  day: Array<{
    confirmed_hours: number;
    forecast: Record<EdgeSeries, number>;
    actual: Record<EdgeSeries, number> | null;
    dev_pct: Record<EdgeSeries, number> | null;
  }>;
}

export interface EdgesFile {
  version: number;
  week_start: IsoDate;
  hours: number;
  confirmed_hours: number;
  series: EdgeSeries[];
  n_edges: number;
  n_sites: number;
  dev_clamp_pct: number;
  method: Record<string, string | number>;
  measured: Record<string, number>;
  edges: Edge[];
}

/** Fewer than two contributing sensors = one camera speaking for a whole
 *  street. Rank it, grey it, never call an anomaly on it. */
export const EDGE_JUDGED_MIN_SENSORS = 2;
