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
