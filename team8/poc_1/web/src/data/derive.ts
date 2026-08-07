/**
 * Turn the wire format into something a 60 fps render loop can read without
 * allocating. Everything is precomputed once per day, into typed arrays laid
 * out line-major (value[i*24 + hour]) exactly as the pipeline emits them.
 *
 * The three things this file exists to get right:
 *   1. `reported` is decoded and kept separate from the zero-filled counts, so
 *      "sensor offline" never renders as "no traffic".
 *   2. `scorable` gates every delta. A non-scorable cell has no delta at all —
 *      it renders as "cannot see", not as an anomaly.
 *   3. Countline segments are 0.8–27 m long. At city zoom that is a fraction of
 *      a pixel, so each segment is drawn at an exaggerated fixed length about
 *      its true midpoint, preserving position and bearing. Stated in the legend.
 */

import { decodeBitset } from './load';
import { pulse, thresholds } from '../theme/foundations';
import {
  CODE_FOR_KEY,
  DiagnosisCode as DX,
  confidenceOf,
  MODES,
  type Confidence,
  type CountlineIndex,
  type DayFile,
  type DiagnosisCode,
  type LineRecord,
  type MatrixSet,
  type Mode,
} from './types';

export const HOURS = 24;

/** Drawn length of a countline segment, metres. Bearing and midpoint are real. */
const SEGMENT_METRES = 160;

export interface LineView {
  /** row in this day's matrices */
  i: number;
  /** index into countlines.json — the only stable key across days */
  ci: number;
  id: string;
  name: string;
  /** viewpoint_id — which camera this countline hangs off. */
  siteId: string;
  source: [number, number];
  target: [number, number];
  mid: [number, number];
  record: LineRecord;
  code: DiagnosisCode;
  confidence: Confidence;
  /** distance from the CBD centroid, 0–1. Drives the propagation offset. */
  spread: number;
  /** 0 = CBD. The beat radiates outward one ring at a time. */
  ring: number;
}

/** Rings of the propagation wave. Keep the total offset under 150 ms or the
 *  "one organism" reading breaks — see design system §5.1. */
export const RINGS = 4;

export interface DayModel {
  date: string;
  file: DayFile;
  refused: boolean;
  n: number;
  lines: LineView[];
  /** n*24, zero-filled onto the full grid */
  actual: Int32Array;
  expected: Int32Array;
  /** n*24, 1 = the feed actually delivered this cell */
  reported: Uint8Array;
  /** n*24, 1 = baseline good enough to score this cell */
  scorable: Uint8Array;
  /** n*24 signed percent; NaN where not scorable. NaN is the honest value. */
  delta: Float32Array;
  /** n*24 amplitude 0–1 from observed volume */
  ampObs: Float32Array;
  /** n*24 amplitude 0–1 from expected volume */
  ampExp: Float32Array;
  /** 24 citywide totals, observed and expected */
  cityObs: Float64Array;
  cityExp: Float64Array;
  /** 24 beats per minute, from citywide load. The city speeds up at 08:00. */
  bpm: Float64Array;
  /** per-mode day totals, for the coverage panel */
  viableCount: Record<Mode, number>;
  worst: LineView[];
  risers: LineView[];
  leastAffected: LineView[];
  byCi: Map<number, LineView>;
  /** lines bucketed by distance ring, so the beat can radiate out of the CBD */
  ringGroups: LineView[][];

  /* --- the site level. Countlines above stay intact: the Streets expansion,
   *     the detail panel and countline selection all still read them. ------ */
  /** 118 on 23 Oct, against 369 countlines. */
  nSites: number;
  sites: SiteView[];
  siteGrid: SiteGrid;
  bySiteId: Map<string, SiteView>;
  /** countline index -> its site, for selecting a line and lighting its site */
  siteOfCi: Map<number, string>;
  siteRingGroups: SiteView[][];
}

const CBD: [number, number] = [174.7772, -41.2865]; // Lambton Quay, roughly

function p90(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] ?? 0;
}

function amplitude(v: number, ref: number): number {
  if (ref <= 0) return pulse.ampMin;
  const norm = Math.min(1.4, Math.max(0, v / ref));
  return pulse.ampMin + (pulse.ampMax - pulse.ampMin) * Math.sqrt(norm);
}

/** Extend a short segment about its midpoint to a legible fixed length. */
function exaggerate(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): { source: [number, number]; target: [number, number]; mid: [number, number] } {
  const midLat = (latA + latB) / 2;
  const midLon = (lonA + lonB) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  let dx = (lonB - lonA) * mPerDegLon;
  let dy = (latB - latA) * mPerDegLat;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const half = SEGMENT_METRES / 2;
  const dLon = (dx * half) / mPerDegLon;
  const dLat = (dy * half) / mPerDegLat;
  return {
    source: [midLon - dLon, midLat - dLat],
    target: [midLon + dLon, midLat + dLat],
    mid: [midLon, midLat],
  };
}

/* ==================================================================== *
 * SITES — the level above countlines.
 *
 * 386 countlines sit on ~53 places: the median gap between two of them is 5 m,
 * so every mark on the map has been stacking on two or three others. The
 * vendor's own `viewpoint_id` is the real unit — one camera, one place, a
 * median of 3 countlines for direction / lane / path-vs-road. Rolling up on it
 * gives 118 marks on 23 Oct instead of 369.
 *
 * Three rules make the rollup honest, and they are the whole point of it:
 *   1. A site's Δ is the ratio of SUMS, never the mean of its members' deltas.
 *      A mean lets a footpath counter outvote the arterial it sits beside.
 *   2. Both sides of that ratio use the same members and the same hours — the
 *      members that have a baseline for that series. A member with none
 *      contributes to neither sum and is counted in `counted` vs `members`,
 *      which is what keeps an all-new site reading `no baseline` instead of a
 *      spectacular percentage.
 *   3. A site reported an hour if ANY member did. A viewpoint is one physical
 *      camera, so its countlines go dark together and a whole-site absence is
 *      a real outage; a single member absent with siblings reporting is the
 *      feed omitting a zero, which contributed nothing to the count anyway.
 *      The residual bias — a quiet member silent at 03:00 drags the site total
 *      marginally low — is stated in the legend, not hidden.
 * ==================================================================== */

export type Role = 'ped' | 'veh';
export const ROLES = ['ped', 'veh'] as const;

/** Vehicles = car + bus + LGV. With pedestrian and cyclist that is 98.1% of
 *  `total`. It is NOT "traffic" and it is NOT total − pedestrian; label it
 *  "vehicles (car, bus, LGV)" wherever it is shown. */
const VEH_MODES: Mode[] = ['car', 'bus', 'lgv'];

export const SITE_SERIES = ['total', ...MODES, 'veh'] as const;
export type SiteSeriesKey = (typeof SITE_SERIES)[number];

/** The two columns of the paired glyph, and the series each one reads. */
export const ROLE_SERIES: Record<Role, SiteSeriesKey> = { ped: 'pedestrian', veh: 'veh' };

/** Hours the viability gate is measured over, inclusive. Mirrors the pipeline. */
const VIABLE_HOURS: [number, number] = [7, 19];

export interface SiteStat {
  /** Comparable observed: the members and hours `exp` also covers. */
  obs: number;
  /** Expected over the hours the feed DELIVERED. A gap is not a zero on the
   *  numerator, so it must not be a full hour on the denominator either. */
  exp: number;
  /** Observed over every member, including those with no baseline. This is what
   *  the sensor saw; `obs` is what we are entitled to compare. They differ only
   *  where a member was excluded from the ratio. */
  obsAll: number;
  /** Ratio of sums − 1, as a percent. null when there is no baseline or
   *  nothing scorable. NEVER 0 — a site that reported nothing is not −100%. */
  deltaPct: number | null;
  /** Members with a baseline for this series; the sums cover only these. */
  basis: number;
  /** Whole-day expected under 20/hr × 24. The number is still shown, the ramp
   *  is not. Measured unmasked: a half-reported site is not a quiet site. */
  belowFloor: boolean;
  /** Expected mean over 07:00–19:00 clears the mode viability gate. */
  viable: boolean;
  hoursScorable: number;
}

/**
 * Every array is site-major, `value[s * 24 + hour]`, exactly as the countline
 * matrices are line-major. Allocated once per day and handed to the render
 * loop by reference — nothing here is rebuilt per frame.
 */
export interface SiteGrid {
  n: number;
  /** 1 = at least one member countline delivered this cell. */
  reported: Uint8Array;
  /** Comparable observed — only the members `expected` also covers, so the two
   *  are a ratio. This is what the solid column and every percentage read. */
  actual: Record<SiteSeriesKey, Float32Array>;
  /** Observed over EVERY member, baseline or not. Rule 2 drops a member from
   *  both sums, which is right for the ratio and wrong for the trace: site 9037
   *  (Aro St) has no baseline on any member, so `actual` is flat zero at every
   *  hour while the feed delivered 8,490 movements. A tool that renders a real
   *  8,490 as a flat line on the floor is doing the thing this codebase exists
   *  to prevent, in the other direction. */
  observed: Record<SiteSeriesKey, Float32Array>;
  expected: Record<SiteSeriesKey, Float32Array>;
  /** 1 = summed expected clears the noise floor AND a member was scorable. */
  scorable: Record<SiteSeriesKey, Uint8Array>;
  /** 1 = there IS an expectation here but it is under 20/hr. Distinct from
   *  expected === 0, which means no baseline at all — render those apart. */
  belowFloor: Record<SiteSeriesKey, Uint8Array>;
  /** Signed percent; NaN wherever not scorable. NaN is the honest value. */
  delta: Record<SiteSeriesKey, Float32Array>;
}

export interface SiteView {
  /** viewpoint_id — the selection key at site scale. */
  siteId: string;
  /** row in the site matrices */
  s: number;
  /** Top one or two street names among the members, "+n" beyond. */
  name: string;
  /** [lon, lat] centroid of member midpoints — deck.gl order. */
  mid: [number, number];
  /** every countline on this camera */
  members: LineView[];
  /** members with a usable total baseline; `counted.length / members.length`
   *  is the `2/3` marker that explains why the sums exclude someone. */
  counted: LineView[];
  stats: Record<SiteSeriesKey, SiteStat>;
  hoursReported: number;
  /** Unreported runs, inclusive-exclusive, for VitalsTrace. A gap is a BREAK. */
  gaps: Array<[number, number]>;
  /** 24-long views into the day-wide buffers. Stable references — pass them
   *  straight to VitalsTrace, never `Array.from(...)` them at render time. */
  series: Record<SiteSeriesKey, { actual: Float32Array; expected: Float32Array }>;
  /** Re-typed from this site's own sums, not voted from member diagnoses. */
  code: DiagnosisCode;
  reason: string;
  confidence: Confidence;
  /** Union of member caveats, worst first. A site never reads cleaner than
   *  its dirtiest member. */
  caveats: string[];
  spread: number;
  ring: number;
}

/** Worst first. A site takes the highest-ranked caveat any member carries. */
const CAVEAT_RANK = [
  'sensor_silent_all_day',
  'new_sensor_no_baseline',
  'intermittent_sensor',
  'low_baseline_volume',
  'single_mode_only',
  'partial_hours',
];

/**
 * Strip the descriptor off a countline name to get the street.
 *
 * The obvious rule — longest common prefix — labels the Dixon St / Manners St
 * junction "Dixon St road" and a Courtenay Pl site "Taranaki St crossing".
 * A misleading street name on an emergency map is worse than a vague one, so
 * cut at the first descriptor token instead and let junctions say they are
 * junctions.
 */
const DESCRIPTOR =
  /^(road|path|crossing|cycle|kerb|rhskerb|lhskerb|sideroad|lane|left|right|upper|lower|top|bottom|north|south|east|west|nrth|sth|inbound|outbound|exit|entry|bus|turning|ramp|nzwel|s\d)/;

function streetOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    const head = words[i].toLowerCase().split('/')[0];
    if (DESCRIPTOR.test(head)) return words.slice(0, i).join(' ');
  }
  return name;
}

/** The first descriptor word of a countline name — `road`, `path`, `crossing`,
 *  `cyclelanes`. The whole word, not the token that matched: `cycle` would
 *  collapse `cyclelanes` and `cyclepath` onto each other. */
function descriptorOf(name: string): string | null {
  const words = name.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    const head = words[i].toLowerCase().split('/')[0];
    if (DESCRIPTOR.test(head)) return head;
  }
  return null;
}

/**
 * `streetOf` is right to cut at the first descriptor, and nothing downstream
 * enforced uniqueness afterwards. On 23 Oct that leaves 24 names shared across
 * 61 of 118 sites — "The Parade" seven times, "Commonwealth Walkway" three. Two
 * rows in a worst-first table reading "Commonwealth Walkway −83.1%" and
 * "−79.2%" are not two findings; they are one finding nobody can act on.
 *
 * The discriminator is drawn from data already on the site, in order of how
 * much it tells an operator: the descriptor its countlines share (road vs path
 * vs cyclelanes is a real distinction between two cameras at one junction), and
 * failing that the vendor's camera id — which is at least the key the map
 * readout and the vendor's own console agree on.
 */
function disambiguate(sites: SiteView[]): void {
  const byName = new Map<string, SiteView[]>();
  for (const site of sites) {
    const g = byName.get(site.name);
    if (g) g.push(site);
    else byName.set(site.name, [site]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const tags = group.map((site) => {
      const counts = new Map<string, number>();
      for (const m of site.members) {
        const d = descriptorOf(m.name);
        if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    });
    const usable = tags.every((t) => t !== null) && new Set(tags).size === group.length;
    group.forEach((site, i) => {
      site.name = usable ? `${site.name} · ${tags[i]}` : `${site.name} · cam ${site.siteId}`;
    });
  }
}

function siteName(members: LineView[]): string {
  const counts = new Map<string, number>();
  for (const m of members) {
    const s = streetOf(m.name);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head = ordered.slice(0, 2).map(([s]) => s).join(' / ');
  return ordered.length > 2 ? `${head} +${ordered.length - 2}` : head;
}

/** Line-major counts for one series. `veh` is the only one we have to build. */
function lineSeries(m: MatrixSet, key: SiteSeriesKey, cells: number): ArrayLike<number> {
  if (key !== 'veh') return m[key];
  const out = new Float32Array(cells);
  for (const mode of VEH_MODES) {
    const src = m[mode];
    for (let k = 0; k < cells; k++) out[k] += src[k];
  }
  return out;
}

const pct = (obs: number, exp: number): number | null =>
  exp <= 0 ? null : ((obs - exp) / exp) * 100;

/**
 * Type a site's change from the RATIO of its own per-mode sums.
 *
 * A mirror of pipeline/diagnose.py, not a second opinion: two `cannot_type`
 * members must not outvote one confident one, so the verdict is recomputed
 * rather than aggregated. The `elevated` branch is deliberately absent — it
 * needs a robust spread, and MAD does not sum across countlines.
 */
function classifySite(
  ped: number | null,
  car: number | null,
  observed: boolean,
  scorable: boolean,
): { code: DiagnosisCode; reason: string } {
  const D = thresholds.diagnosis;
  if (!observed) return { code: DX.NOT_OBSERVED, reason: 'The day was not observed well enough to score.' };
  if (!scorable)
    return {
      code: DX.NO_BASELINE,
      reason: 'No usable history for this site — too few qualifying days, too little volume, or it reports intermittently.',
    };
  if (ped === null || car === null)
    return {
      code: DX.CANNOT_TYPE,
      reason: `Only one mode carries usable volume here (no ${car === null ? 'vehicle' : 'pedestrian'} baseline), so the change cannot be typed.`,
    };

  const r = (v: number) => v.toFixed(0);
  if (Math.abs(ped) < D.deadbandPct && Math.abs(car) < D.deadbandPct)
    return { code: DX.NORMAL, reason: `Pedestrians ${r(ped)}%, vehicles ${r(car)}% — within normal spread.` };

  if (ped >= D.riserPct && car <= D.collapsePct)
    return {
      code: DX.PEOPLE_NOT_TRAFFIC,
      reason: `Pedestrians ${r(ped)}% while vehicles ${r(car)}%: consistent with a street closed to traffic but still open to people.`,
    };

  const exposure = {
    code: DX.EXPOSURE,
    reason: `Pedestrians ${r(ped)}% vs vehicles ${r(car)}%: pedestrians fell harder — consistent with people stopping walking first.`,
  };
  const closure = {
    code: DX.ROAD_CLOSURE,
    reason: `Vehicles ${r(car)}% vs pedestrians ${r(ped)}%: vehicles fell harder — consistent with a road closure, street still walkable.`,
  };
  const pedGone = ped <= D.collapsePct;
  const carGone = car <= D.collapsePct;

  if (pedGone && carGone) {
    if (ped <= D.ratio * car) return exposure;
    if (car <= D.ratio * ped) return closure;
    const both = ped <= D.absoluteCollapsePct && car <= D.absoluteCollapsePct;
    return {
      code: DX.LOSS_OF_ACCESS,
      reason: both
        ? `Pedestrians ${r(ped)}% and vehicles ${r(car)}%: movement of every kind has gone.`
        : `Pedestrians ${r(ped)}% and vehicles ${r(car)}% fell together, neither dominating — consistent with reduced access.`,
    };
  }
  if (pedGone) return exposure;
  if (carGone) return closure;
  return { code: DX.NORMAL, reason: `Pedestrians ${r(ped)}%, vehicles ${r(car)}% — no collapse in either mode.` };
}

function buildSites(
  day: DayFile,
  lines: LineView[],
  reported: Uint8Array,
  scorable: Uint8Array,
  refused: boolean,
): { sites: SiteView[]; grid: SiteGrid } {
  const cells = day.n * HOURS;

  // Sites in first-appearance order, which is countline-index order.
  const order: string[] = [];
  const groups = new Map<string, LineView[]>();
  for (const l of lines) {
    let g = groups.get(l.siteId);
    if (!g) {
      g = [];
      groups.set(l.siteId, g);
      order.push(l.siteId);
    }
    g.push(l);
  }
  const nSites = order.length;
  const sCells = nSites * HOURS;

  const blank = <T>(make: (k: SiteSeriesKey) => T) =>
    Object.fromEntries(SITE_SERIES.map((k) => [k, make(k)])) as Record<SiteSeriesKey, T>;

  const grid: SiteGrid = {
    n: nSites,
    reported: new Uint8Array(sCells),
    actual: blank(() => new Float32Array(sCells)),
    observed: blank(() => new Float32Array(sCells)),
    expected: blank(() => new Float32Array(sCells)),
    scorable: blank(() => new Uint8Array(sCells)),
    belowFloor: blank(() => new Uint8Array(sCells)),
    delta: blank(() => new Float32Array(sCells).fill(NaN)),
  };

  // A member is scorable at this cell; ORed to the site so the site is
  // scorable when the part of it we could see was.
  const anyScorable = blank(() => new Uint8Array(sCells));
  const basisCount = blank(() => new Int32Array(nSites));

  for (const key of SITE_SERIES) {
    const a = lineSeries(day.actual, key, cells);
    const e = lineSeries(day.expected, key, cells);
    const A = grid.actual[key];
    const O = grid.observed[key];
    const E = grid.expected[key];
    const S = anyScorable[key];

    order.forEach((siteId, s) => {
      for (const l of groups.get(siteId)!) {
        let dayExp = 0;
        for (let h = 0; h < HOURS; h++) dayExp += e[l.i * HOURS + h];
        // Every member is observed. Only some of them are comparable.
        for (let h = 0; h < HOURS; h++) O[s * HOURS + h] += a[l.i * HOURS + h];
        // Rule 2: no baseline for this series => contributes to NEITHER sum.
        if (dayExp <= 0) continue;
        basisCount[key][s] += 1;
        for (let h = 0; h < HOURS; h++) {
          const src = l.i * HOURS + h;
          const dst = s * HOURS + h;
          A[dst] += a[src];
          E[dst] += e[src];
          S[dst] |= scorable[src];
        }
      }
    });
  }

  // Rule 3: reported is the union over ALL members, baseline or not.
  order.forEach((siteId, s) => {
    for (const l of groups.get(siteId)!) {
      for (let h = 0; h < HOURS; h++) {
        grid.reported[s * HOURS + h] |= reported[l.i * HOURS + h];
      }
    }
  });

  const FLOOR = thresholds.minExpectedPerHour;
  for (const key of SITE_SERIES) {
    const E = grid.expected[key];
    const A = grid.actual[key];
    const sc = grid.scorable[key];
    const bf = grid.belowFloor[key];
    const dl = grid.delta[key];
    for (let k = 0; k < sCells; k++) {
      bf[k] = E[k] > 0 && E[k] < FLOOR ? 1 : 0;
      sc[k] = !refused && anyScorable[key][k] === 1 && E[k] >= FLOOR ? 1 : 0;
      if (sc[k]) dl[k] = ((A[k] - E[k]) / E[k]) * 100;
    }
  }

  const [vh0, vh1] = VIABLE_HOURS;
  const viableHours = vh1 - vh0 + 1;

  const sites: SiteView[] = order.map((siteId, s) => {
    const members = groups.get(siteId)!;
    const base = s * HOURS;

    let hoursReported = 0;
    for (let h = 0; h < HOURS; h++) hoursReported += grid.reported[base + h];

    const gaps: Array<[number, number]> = [];
    for (let h = 0; h < HOURS; h++) {
      if (grid.reported[base + h]) continue;
      const start = h;
      while (h < HOURS && !grid.reported[base + h]) h++;
      gaps.push([start, h]);
    }

    const series = {} as SiteView['series'];
    const stats = {} as Record<SiteSeriesKey, SiteStat>;
    for (const key of SITE_SERIES) {
      let obs = 0;
      let obsAll = 0;
      let exp = 0;
      let expFull = 0;
      let viableExp = 0;
      let hoursScorable = 0;
      for (let h = 0; h < HOURS; h++) {
        obs += grid.actual[key][base + h];
        obsAll += grid.observed[key][base + h];
        // Same hours on both sides. `actual` is zero-filled, so the numerator
        // is already restricted to delivered hours; leaving the denominator on
        // all 24 renders a gap as a zero in the number people read.
        if (grid.reported[base + h]) exp += grid.expected[key][base + h];
        expFull += grid.expected[key][base + h];
        hoursScorable += grid.scorable[key][base + h];
        if (h >= vh0 && h <= vh1) viableExp += grid.expected[key][base + h];
      }
      // A site with no comparable member has a flat-zero `actual`; drawing that
      // as the day would assert the feed saw nothing. Draw what it saw.
      series[key] = {
        actual: (basisCount[key][s] > 0 ? grid.actual : grid.observed)[key].subarray(
          base,
          base + HOURS,
        ),
        expected: grid.expected[key].subarray(base, base + HOURS),
      };
      stats[key] = {
        obs: Math.round(obs),
        obsAll: Math.round(obsAll),
        exp: Math.round(exp),
        deltaPct: hoursScorable > 0 ? pct(obs, exp) : null,
        basis: basisCount[key][s],
        belowFloor: expFull > 0 && expFull < thresholds.minExpectedPerDay,
        viable: viableExp / viableHours >= thresholds.modeViablePerHour,
        hoursScorable,
      };
    }

    const counted = members.filter((l) => l.record.exp > 0);
    // The aggregate is dominated by the busiest member, so its history is the
    // one that decides whether the site's expectation is worth believing.
    const dominant = counted.reduce<LineView | null>(
      (best, l) => (!best || l.record.exp > best.record.exp ? l : best),
      null,
    );

    const scorableSite = stats.total.hoursScorable > 0;
    const typed = classifySite(
      stats.pedestrian.viable ? stats.pedestrian.deltaPct : null,
      stats.veh.viable ? stats.veh.deltaPct : null,
      !refused,
      scorableSite,
    );

    const caveats = new Set<string>();
    for (const l of members) for (const c of l.record.caveats) caveats.add(c);
    // The one member-level caveat that does not survive the rollup: a dead
    // countline beside eight live ones does not make the SITE silent, and
    // saying so would be false. It still shows as partial hours.
    if (hoursReported > 0 && caveats.delete('sensor_silent_all_day')) caveats.add('partial_hours');

    const confidence: Confidence = refused || hoursReported === 0
      ? 0
      : scorableSite && hoursReported / HOURS >= 0.6 && (dominant?.record.baseline_n ?? 0) >= 5
        ? 2
        : 1;

    let lon = 0;
    let lat = 0;
    for (const l of members) {
      lon += l.mid[0];
      lat += l.mid[1];
    }

    return {
      siteId,
      s,
      name: siteName(members),
      mid: [lon / members.length, lat / members.length] as [number, number],
      members,
      counted,
      stats,
      hoursReported,
      gaps,
      series,
      code: typed.code,
      reason: typed.reason,
      confidence,
      caveats: [...caveats].sort(
        (a, b) => (CAVEAT_RANK.indexOf(a) + 1 || 99) - (CAVEAT_RANK.indexOf(b) + 1 || 99),
      ),
      spread: 0,
      ring: 0,
    };
  });

  disambiguate(sites);

  if (import.meta.env?.DEV) {
    for (const site of sites) {
      // The one bug that would discredit the whole tool: a zero-filled series
      // with no gaps renders a plausible line through hours nobody delivered.
      if (site.gaps.length === 0 && site.hoursReported < HOURS) {
        throw new Error(`site ${site.siteId}: ${site.hoursReported}/24 hours reported but no gaps`);
      }
    }
  }

  return { sites, grid };
}

export function buildDayModel(day: DayFile, index: CountlineIndex): DayModel {
  const n = day.n;
  const cells = n * HOURS;

  const actual = Int32Array.from(day.actual.total);
  const expected = Int32Array.from(day.expected.total);
  const reported = decodeBitset(day.reported, cells);
  const scorable = decodeBitset(day.scorable, cells);
  const refused = day.verdict === 'refused';

  const delta = new Float32Array(cells).fill(NaN);
  const ampObs = new Float32Array(cells);
  const ampExp = new Float32Array(cells);

  for (let i = 0; i < n; i++) {
    const base = i * HOURS;
    const row: number[] = [];
    for (let h = 0; h < HOURS; h++) row.push(expected[base + h]);
    const ref = Math.max(1, p90(row));
    for (let h = 0; h < HOURS; h++) {
      const k = base + h;
      ampObs[k] = amplitude(actual[k], ref);
      ampExp[k] = amplitude(expected[k], ref);
      if (scorable[k] && expected[k] > 0) {
        delta[k] = ((actual[k] - expected[k]) / expected[k]) * 100;
      }
    }
  }

  const cityObs = new Float64Array(HOURS);
  const cityExp = new Float64Array(HOURS);
  for (let i = 0; i < n; i++) {
    for (let h = 0; h < HOURS; h++) {
      cityObs[h] += actual[i * HOURS + h];
      cityExp[h] += expected[i * HOURS + h];
    }
  }
  const peak = Math.max(1, ...Array.from(cityExp));
  const bpm = new Float64Array(HOURS);
  for (let h = 0; h < HOURS; h++) {
    const load = Math.min(1, Math.max(0, cityObs[h] / peak));
    bpm[h] = pulse.bpmMin + (pulse.bpmMax - pulse.bpmMin) * load;
  }

  // spread: normalised distance from the CBD centroid, for the propagation wave
  const rawDist: number[] = [];
  const lines: LineView[] = day.lines.map((record) => {
    const ci = record.ci;
    const g = index.geom[ci];
    const geo = exaggerate(g[0], g[1], g[2], g[3]);
    const d = Math.hypot(geo.mid[0] - CBD[0], geo.mid[1] - CBD[1]);
    rawDist.push(d);
    return {
      i: record.i,
      ci,
      id: index.ids[ci],
      name: index.names[ci],
      siteId: index.viewpoint[ci],
      source: geo.source,
      target: geo.target,
      mid: geo.mid,
      record,
      code: CODE_FOR_KEY[record.diagnosis],
      confidence: confidenceOf(record.confidence),
      spread: 0,
      ring: 0,
    };
  });
  const maxDist = Math.max(1e-6, ...rawDist);
  const ringGroups: LineView[][] = Array.from({ length: RINGS }, () => []);
  lines.forEach((l, k) => {
    l.spread = rawDist[k] / maxDist;
    l.ring = Math.min(RINGS - 1, Math.floor(l.spread * RINGS));
    ringGroups[l.ring].push(l);
  });

  const { sites, grid: siteGrid } = buildSites(day, lines, reported, scorable, refused);
  const siteRingGroups: SiteView[][] = Array.from({ length: RINGS }, () => []);
  for (const site of sites) {
    const d = Math.hypot(site.mid[0] - CBD[0], site.mid[1] - CBD[1]);
    site.spread = Math.min(1, d / maxDist);
    site.ring = Math.min(RINGS - 1, Math.floor(site.spread * RINGS));
    siteRingGroups[site.ring].push(site);
  }

  const byCi = new Map(lines.map((l) => [l.ci, l]));
  const pick = (cis: number[]) => cis.map((ci) => byCi.get(ci)).filter((l): l is LineView => !!l);

  const viableCount = { pedestrian: 0, cyclist: 0, car: 0, bus: 0, lgv: 0 } as Record<Mode, number>;
  for (const l of lines) {
    for (const m of Object.keys(viableCount) as Mode[]) {
      if (l.record.modes[m]?.viable) viableCount[m] += 1;
    }
  }

  return {
    date: day.date,
    file: day,
    refused,
    n,
    lines,
    actual,
    expected,
    reported,
    scorable,
    delta,
    ampObs,
    ampExp,
    cityObs,
    cityExp,
    bpm,
    viableCount,
    worst: pick(day.summary.worst),
    risers: pick(day.summary.risers),
    leastAffected: pick(day.summary.least_affected ?? []),
    byCi,
    ringGroups,
    nSites: sites.length,
    sites,
    siteGrid,
    bySiteId: new Map(sites.map((s) => [s.siteId, s])),
    siteOfCi: new Map(lines.map((l) => [l.ci, l.siteId])),
    siteRingGroups,
  };
}

/** Cells the feed delivered, this hour. Used by the coverage readout. */
export function coverageAtHour(model: DayModel, hour: number): { reported: number; scorable: number } {
  let r = 0;
  let s = 0;
  for (let i = 0; i < model.n; i++) {
    const k = i * HOURS + hour;
    r += model.reported[k];
    s += model.scorable[k];
  }
  return { reported: r, scorable: s };
}
