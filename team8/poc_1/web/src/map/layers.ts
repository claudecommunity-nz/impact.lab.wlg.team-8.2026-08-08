/**
 * The whole deck.gl layer stack, as a pure function of (data, hour, beat, view).
 *
 * Called ~60×/s from the rAF loop in MapCanvas. That is cheap on purpose:
 * `getElevation` and `getFillColor` only regenerate on the hour boundary, 24
 * times per playthrough; everything the beat and the camera touch — radius,
 * angle, offset, elevationScale — is a ColumnLayer uniform and costs nothing.
 *
 * WHY COLUMNS. Two 2D attempts at "expected vs actual" failed for the same
 * reason: in 2D the deficit had to ride radius or stroke width, where a 40%
 * shortfall is two pixels. And 386 countlines sit on ~53 places — median gap
 * 5 m, which is under a pixel at city zoom — so every mark stacked on two or
 * three others. Rolling up to the vendor's own `viewpoint_id` thins that to 118
 * sites but does not solve it: 96 of them still have a neighbour within 40 m.
 * Height and parallax separate what position cannot, which is the whole reason
 * this is 3D rather than merely aggregated.
 *
 * THE TWO CHANNELS, and they are deliberately orthogonal:
 *   height = VOLUME, linear, one scale citywide. The gap between the
 *     translucent case (expected) and the solid inside it (actual) is the
 *     absolute shortfall in people-or-vehicles per hour, to scale. Under sqrt
 *     that gap would lie about its own size — a −41% drop reads as a 23% gap —
 *     so `derive.amplitude`'s sqrt is deliberately NOT reused here.
 *   colour = PERCENT CHANGE, via the one ramp. Height is what we counted;
 *     colour is what we judge, and it is withheld whenever we cannot judge.
 *
 * Colour policy, non-negotiable (design system §9.3):
 *   - the percent-change ramp owns the solid's fill. Diagnosis NEVER does; it
 *     rides the cap plate at expected height and nothing else, and it is off by
 *     default. It is an inference about an expectation: it may annotate the top
 *     plane, it may not paint the tower.
 *   - a cell the feed did not deliver gets NO solid — an empty case. That is a
 *     stronger statement than a grey column: we know what should have been here
 *     and we got nothing. It is not the same thing as a reported zero
 *     (sem-zero-observed) and not the same thing as a cell we may not score
 *     (sem-unknown).
 *   - under 20 expected an hour a percentage is a rounding error, so the cell
 *     keeps its height and loses its colour (sem-neutral-zero).
 */

import { ColumnLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { rampRgba, rgba, type Rgba } from '../theme/color';
import type { Palette } from '../theme/palettes';
import {
  HOURS,
  RINGS,
  ROLES,
  ROLE_SERIES,
  type DayModel,
  type Role,
  type SiteView,
} from '../data/derive';
import {
  DiagnosisCode,
  TYPED_DIAGNOSES,
  CODE_FOR_KEY,
  type LayerId,
  type ModeFilter,
} from '../data/types';
import type { GeoJsonLike } from '../data/load';

const TYPED_CODES = new Set(TYPED_DIAGNOSES.map((k) => CODE_FOR_KEY[k]));

const DX_TOKEN: Record<number, Parameters<typeof rgba>[1]> = {
  [DiagnosisCode.EXPOSURE]: 'dx-exposure',
  [DiagnosisCode.ROAD_CLOSURE]: 'dx-road-closure',
  [DiagnosisCode.LOSS_OF_ACCESS]: 'dx-loss-of-access',
  [DiagnosisCode.PEOPLE_NOT_TRAFFIC]: 'dx-people-not-traffic',
};

export interface LayerCtx {
  model: DayModel;
  hour: number;
  /** global cardiac beat, 0–1. One city, one heart. */
  beat: number;
  /** per-ring beat, so the wave radiates out of Lambton Quay */
  ringBeats: number[];
  palette: Palette;
  ghost: boolean;
  showCoverage: boolean;
  showDiagnosis: boolean;
  refused: boolean;
  mode: ModeFilter;
  /** viewpoint_id of the selected / hovered site. */
  selectedSite: string | null;
  hoveredSite: string | null;
  /** live camera — radius, height scale, square angle and the pair axis all
   *  derive from it, and all four are uniforms, so this is free per frame. */
  zoom: number;
  bearing: number;
  latitude: number;
  gis: Partial<Record<LayerId, GeoJsonLike>>;
  layers: Record<LayerId, boolean>;
  onHover: (siteId: string | null) => void;
  onClick: (siteId: string | null) => void;
}

/* ---------------------------------------------------------------------- *
 * Geometry and scale constants. Every one of these was measured against
 * 2025-10-23; the numbers are in the column spec, the reasons are here.
 * ---------------------------------------------------------------------- */

/** Movements per hour at full column height. Clips 0.69% of expected and 0.04%
 *  of observed site-role-hours on 23 Oct — 7 sites ever touch it. 1500 clips
 *  3.1%; 4000 spends 40% of the height range on a single outlier. */
export const VFULL = 2400;

/** Full scale in GROUND pixels. Multiplied by metres-per-pixel it becomes a
 *  screen-space scale like a chart axis rather than a world height: ~149 px on
 *  screen at pitch 48 at every zoom. Without it, z15 would put the tallest
 *  column 581 px up and off the canvas. */
const HEIGHT_GROUND_PX = 200;

/** The plinth. 6.4 ground-px ≈ 4.8 px on screen — every cell the feed actually
 *  delivered gets at least this, so a reporting sensor is never invisible. An
 *  affine offset applied identically to case and solid, so it does not distort
 *  the gap. Disclosed in the legend. */
const EFLOOR = 0.032;

/** World-locked footprint, with a hand-rolled `radiusMinPixels` that
 *  ColumnLayer does not have. Radius is the dominant lever on occlusion
 *  (8 m → 4.2%, 18 m → 12.3% at bearing 90), so it stays thin: height is doing
 *  the work.
 *
 *  3.2 px min was too thin to be a column: against HEIGHT_GROUND_PX it gave a
 *  31:1 aspect ratio, which is a hair, and the pair came to ~13 px total. At
 *  5.5 the members separate and each one has a face wide enough to carry a
 *  colour at projector distance. */
const RADIUS_M = 12;
const RADIUS_MIN_PX = 5.5;

/** The pair is typed by FOOTPRINT, not by position. Both members used to be
 *  squares distinguished only by which side of the site they sat on, and at
 *  bearing 90 / pitch 48 both lean the same way, so "pedestrians left, vehicles
 *  right" was ambiguous in the one frame the whole product turns on. A square
 *  and a triangle are told apart at any rotation and at any size that renders
 *  at all — and 4 and 3 sides are the two cheapest column geometries there are.
 *
 *  At the 3–6 px these render at, a 20-gon is a grey smudge; a low-poly prism
 *  with flat shading gives distinct face luminances, which is the only 3D cue
 *  that survives at this size. */
const DISK_SIDES: Record<Role, number> = { ped: 4, veh: 3 };

/** Pair separation in radius units: 1.0 is exactly tangent. Gapped reads as two
 *  unrelated marks and tangent read as one merged mark once both members were
 *  the same shape; 1.3 leaves a hairline between two footprints that are
 *  already different shapes, which is enough to read them as a pair of two. */
const PAIR_OFFSET = 1.3;

/** Case and solid share a radius and nest by coverage — identical footprint
 *  centres, no coplanar z-fighting on the side walls, and the 20% inset reads
 *  as "inside the case". */
const GHOST_COVERAGE = 1.0;
const SOLID_COVERAGE = 0.8;

/** Hover lifts the site's whole pair out of its clump. Cheap: an attribute
 *  regeneration on hover-enter, which happens at human speed, not frame speed. */
const HOVER_RAISE = 1.18;

/** The beat rides elevation now, and it only ever SUBTRACTS: beat = 1 at
 *  systole is the true height, so the reading is the peak of every cycle and is
 *  never inflated. ±6%, because height carries a quantitative claim where the
 *  old widthScale did not — and because a site at 97% of expected would
 *  otherwise flicker across the case top and read as a riser. */
const BEAT_FLOOR = 0.94;
const BEAT_RANGE = 0.06;

/** deck.gl 9 uses the 512px-tile convention. 7.69 m/px at z12.9, lat −41.29. */
export function metresPerPixel(zoom: number, latitude: number): number {
  return (78271.517 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Street-event closures are a snapshot taken at fetch time — the file on disk is
 * all 2026-dated events. Drawn unfiltered over a 2025 replay they render as
 * warning-orange polygons on a city that has just gone red, which a viewer will
 * read as closures in force that day. They are the one dataset here that can be
 * put into false temporal register with an event, so they are filtered to the
 * selected date and usually resolve to nothing.
 */
export function closuresOnDate(fc: GeoJsonLike, date: string): GeoJsonLike {
  const start = Date.parse(`${date}T00:00:00+13:00`);
  const end = start + 24 * 3600 * 1000;
  const features = (fc.features ?? []).filter((f) => {
    const p = (f as { properties?: Record<string, unknown> }).properties ?? {};
    const s = Number(p.Start_Date);
    const e = Number(p.End_Date);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
    return s < end && e > start;
  });
  return { ...fc, features };
}

/* ---------------------------------------------------------------------- *
 * Row selection, memoised on (model, hour).
 *
 * deck.gl regenerates an attribute buffer when `data` changes identity, so
 * these arrays are built once per hour — 24 times per playthrough — and handed
 * back by reference on the other 1,416 frames.
 * ---------------------------------------------------------------------- */

interface HourRows {
  model: DayModel;
  hour: number;
  /** every site with a baseline for that role: the case, and the pick target */
  ghost: Record<Role, SiteView[]>;
  /** …that also reported this hour, bucketed by ring for the beat */
  solid: Record<Role, SiteView[][]>;
  /** no baseline in either role — a flat disc, so it is visible and pickable */
  plinth: SiteView[];
  blind: SiteView[];
  unscorable: SiteView[];
}

let rowCache: HourRows | null = null;

/** A role only gets a slot where the site has a baseline for it. 37 of 118
 *  sites are pedestrian-only and 7 vehicle-only on 23 Oct; the missing half of
 *  a pair must render as nothing at all. A zero-height column there would read
 *  as "no vehicles today", which is exactly the reported-vs-zero confusion this
 *  codebase exists to prevent. */
function hasBaseline(site: SiteView, role: Role): boolean {
  const st = site.stats[ROLE_SERIES[role]];
  return st.basis > 0 && st.exp > 0;
}

function rowsFor(model: DayModel, hour: number): HourRows {
  if (rowCache && rowCache.model === model && rowCache.hour === hour) return rowCache;
  const g = model.siteGrid;
  const ghost: Record<Role, SiteView[]> = { ped: [], veh: [] };
  const solid: Record<Role, SiteView[][]> = {
    ped: Array.from({ length: RINGS }, () => [] as SiteView[]),
    veh: Array.from({ length: RINGS }, () => [] as SiteView[]),
  };
  const plinth: SiteView[] = [];
  const blind: SiteView[] = [];
  const unscorable: SiteView[] = [];

  for (const site of model.sites) {
    const k = site.s * HOURS + hour;
    const reported = g.reported[k] === 1;
    let any = false;
    for (const role of ROLES) {
      if (!hasBaseline(site, role)) continue;
      any = true;
      ghost[role].push(site);
      if (reported) solid[role][site.ring].push(site);
    }
    if (!any) plinth.push(site);
    if (!reported) blind.push(site);
    else if (!g.scorable.total[k]) unscorable.push(site);
  }

  rowCache = { model, hour, ghost, solid, plinth, blind, unscorable };
  return rowCache;
}

/* ---------------------------------------------------------------------- *
 * The two channels
 * ---------------------------------------------------------------------- */

const cell = (site: SiteView, hour: number) => site.s * HOURS + hour;

/** Linear, shared by both roles and every site. Vehicle volumes are ~2.3×
 *  pedestrian at the median, so the vehicle column usually IS taller — that is
 *  a fact worth showing, and a per-role scale would hide it. */
function elevationOf(ctx: LayerCtx, site: SiteView, volume: number): number {
  const e = EFLOOR + (1 - EFLOOR) * Math.min(1, volume / VFULL);
  return site.siteId === ctx.hoveredSite ? e * HOVER_RAISE : e;
}

/**
 * The one place a solid's colour is decided.
 *
 * Order differs from the spec in one place, deliberately: `derive` folds the
 * 20/hr floor INTO `scorable`, so a below-floor cell is also unscorable and
 * would otherwise be painted sem-unknown. Below-floor is checked first, because
 * "we counted it, the number is too small to take a percentage of" is a
 * different statement from "we may not judge this at all".
 */
function solidColor(ctx: LayerCtx, site: SiteView, role: Role): Rgba {
  const { palette, hour, refused, model } = ctx;
  if (refused) return rgba(palette, 'sem-suppressed', 150);
  const key = ROLE_SERIES[role];
  const g = model.siteGrid;
  const k = cell(site, hour);
  if (g.actual[key][k] === 0) return rgba(palette, 'sem-zero-observed', 190);
  if (g.belowFloor[key][k]) return rgba(palette, 'sem-neutral-zero', 210);
  if (!g.scorable[key][k]) return rgba(palette, 'sem-unknown', 150);
  const d = g.delta[key][k];
  if (!Number.isFinite(d)) return rgba(palette, 'sem-unknown', 150);
  return rampRgba(palette, d);
}

/** The case is never ramped. The expectation is not data about today.
 *
 *  46/255 is 18%, which is a beautiful pane of glass on a retina laptop and is
 *  gone entirely through projector gamma — downsample the hero frame to 33% and
 *  the cases vanish, leaving coloured 1px wireframes that read as confetti. 90
 *  is 35% and survives it. The whole encoding is the gap between two tops, so
 *  the case losing its body costs more than it costs anything else on the map. */
function ghostFill(ctx: LayerCtx, site: SiteView): Rgba {
  if (ctx.refused) return rgba(ctx.palette, 'sem-suppressed', 40);
  const reported = ctx.model.siteGrid.reported[cell(site, ctx.hour)] === 1;
  return rgba(ctx.palette, 'sem-ghost', reported ? 90 : 40);
}

/**
 * The case's edge is NEVER the diagnosis.
 *
 * It was, at alpha 210 over a full-height wireframe with `diagnosis` defaulted
 * on, and that inverted the honesty hierarchy: the loudest mark on the map was
 * an inference, drawn at an expected value, over the entire silhouette. Worse,
 * the outer silhouette IS the expectation and is near-identical on 23 Oct and
 * 16 Oct — so with diagnosis on, the collapse read as a hue shift on an
 * unchanged skyline. With it off, the solids fill ~90% of the case on 16 Oct
 * and 30–40% on 23 Oct, and the collapse needs no legend at all.
 *
 * The diagnosis now annotates the cap plane only — see `capColor`.
 */
function ghostLine(ctx: LayerCtx, site: SiteView): Rgba {
  const { palette } = ctx;
  if (ctx.refused) return rgba(palette, 'sem-suppressed', 90);
  if (!ctx.model.siteGrid.reported[cell(site, ctx.hour)]) {
    return rgba(palette, 'sem-offline', 170);
  }
  return rgba(palette, 'sem-ghost-core', 150);
}

/** The cap: a filled plate at expected height, so the top plane is drawn rather
 *  than implied by four wireframe edges that a projector eats. It is also the
 *  one surface the diagnosis is allowed to colour — a horizontal plate at the
 *  expected value annotates the expectation without competing with the
 *  measurement standing inside it. */
function capColor(ctx: LayerCtx, site: SiteView): Rgba {
  const { palette } = ctx;
  if (ctx.refused) return rgba(palette, 'sem-suppressed', 70);
  if (!ctx.model.siteGrid.reported[cell(site, ctx.hour)]) {
    return rgba(palette, 'sem-offline', 120);
  }
  if (ctx.showDiagnosis && TYPED_CODES.has(site.code) && site.confidence >= 2) {
    return rgba(palette, DX_TOKEN[site.code] ?? 'dx-cannot-type', 190);
  }
  return rgba(palette, 'sem-ghost-core', 120);
}

/** Cyclists are neither arm of the pair, so the filter cannot narrow to them —
 *  the paired glyph is pedestrians against vehicles (car, bus, LGV) and nothing
 *  else. Selecting cyclist leaves both columns up rather than inventing one. */
const ROLE_FOR_MODE: Partial<Record<ModeFilter, Role>> = {
  pedestrian: 'ped',
  car: 'veh',
  bus: 'veh',
  lgv: 'veh',
};

const roleShown = (mode: ModeFilter, role: Role): boolean => {
  const only = ROLE_FOR_MODE[mode];
  return only === undefined || only === role;
};

export function buildLayers(ctx: LayerCtx): Layer[] {
  const { model, hour, palette, refused, layers, gis } = ctx;
  const out: Layer[] = [];

  /* ---------------- 1–4 reference geography, never scored --------------- */
  if (layers.tsunami && gis.tsunami) {
    out.push(
      new GeoJsonLayer({
        id: 'gis-tsunami',
        data: gis.tsunami,
        stroked: true,
        filled: true,
        getFillColor: rgba(palette, 'status-provisional', 26),
        getLineColor: rgba(palette, 'status-provisional', 90),
        lineWidthMinPixels: 1,
        pickable: false,
      }),
    );
  }
  if (layers.routes && gis.routes) {
    out.push(
      new GeoJsonLayer({
        id: 'gis-routes',
        data: gis.routes,
        stroked: true,
        filled: false,
        getLineColor: rgba(palette, 'status-info', 70),
        lineWidthMinPixels: 1,
        pickable: false,
      }),
    );
  }
  if (layers.closures && gis.closures) {
    out.push(
      new GeoJsonLayer({
        id: 'gis-closures',
        data: closuresOnDate(gis.closures, model.date),
        stroked: true,
        filled: true,
        getFillColor: rgba(palette, 'status-warn', 40),
        getLineColor: rgba(palette, 'status-warn', 120),
        lineWidthMinPixels: 1,
        pointRadiusMinPixels: 3,
        pickable: false,
      }),
    );
  }
  if (layers.hubs && gis.hubs) {
    out.push(
      new GeoJsonLayer({
        id: 'gis-hubs',
        data: gis.hubs,
        pointType: 'circle',
        getFillColor: rgba(palette, 'status-ok', 190),
        getPointRadius: 5,
        pointRadiusUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  /* ---------------- 5 the columns ---------------------------------------- */
  const rows = rowsFor(model, hour);
  const mpp = metresPerPixel(ctx.zoom, ctx.latitude);
  const radius = Math.max(RADIUS_M, RADIUS_MIN_PX * mpp);
  const elevationScale = HEIGHT_GROUND_PX * mpp;

  // Screen-right in (east, north) is (cos b, −sin b), and the pair axis MUST be
  // recomputed from the live bearing. Fixed east–west offsets would, at the
  // default bearing 90, separate the pair along the depth axis and leave the
  // two columns permanently occluding each other.
  const b = (ctx.bearing * Math.PI) / 180;
  const right: [number, number] = [Math.cos(b), -Math.sin(b)];
  const OFFSET: Record<Role, [number, number]> = {
    ped: [-PAIR_OFFSET * right[0], -PAIR_OFFSET * right[1]],
    veh: [PAIR_OFFSET * right[0], PAIR_OFFSET * right[1]],
  };
  // Keeps two faces presented at 45° to the camera under any rotation, so a
  // square always reads as a solid rather than as a flat card.
  const angle = 45 - ctx.bearing;

  // Picking lives on the case: it is present wherever there is a baseline, it
  // is the tallest shape and the largest target, and picking the solid would
  // make a −90% site (a stub) nearly unclickable. With the case switched off
  // the solids have to take over, or the map stops answering the mouse.
  const pickSolids = !ctx.ghost;

  if (rows.plinth.length) {
    out.push(
      new ColumnLayer<SiteView>({
        id: 'site-plinth',
        data: rows.plinth,
        diskResolution: DISK_SIDES.ped,
        angle,
        radius: radius * 2.2,
        radiusUnits: 'meters',
        extruded: false,
        filled: true,
        getPosition: (s) => s.mid,
        getFillColor: rgba(palette, 'sem-unknown', 40),
        pickable: true,
        onHover: (info) => ctx.onHover((info.object as SiteView | undefined)?.siteId ?? null),
        onClick: (info) => ctx.onClick((info.object as SiteView | undefined)?.siteId ?? null),
        updateTriggers: { getFillColor: palette.name },
      }),
    );
  }

  /* 5a the solids — what actually moved. All eight go down BEFORE the cases. */
  for (const role of ROLES) {
    if (!roleShown(ctx.mode, role)) continue;
    const key = ROLE_SERIES[role];
    rows.solid[role].forEach((group, ring) => {
      if (!group.length) return;
      out.push(
        new ColumnLayer<SiteView>({
          id: `site-solid-${role}-${ring}`,
          data: group,
          diskResolution: DISK_SIDES[role],
          angle,
          radius,
          radiusUnits: 'meters',
          offset: OFFSET[role],
          coverage: SOLID_COVERAGE,
          extruded: true,
          filled: true,
          flatShading: true,
          elevationScale: elevationScale * (BEAT_FLOOR + BEAT_RANGE * ctx.ringBeats[ring]),
          getPosition: (s) => s.mid,
          getElevation: (s) => elevationOf(ctx, s, model.siteGrid.actual[key][cell(s, hour)]),
          getFillColor: (s) => solidColor(ctx, s, role),
          pickable: pickSolids,
          onHover: (info) => ctx.onHover((info.object as SiteView | undefined)?.siteId ?? null),
          onClick: (info) => ctx.onClick((info.object as SiteView | undefined)?.siteId ?? null),
          updateTriggers: {
            getElevation: [hour, ctx.hoveredSite],
            getFillColor: [hour, palette.name, refused],
          },
        }),
      );
    });
  }

  /* 5b the cases — the city as it should have been.
   *
   * Draw order is the whole trick. deck.gl renders layers in array order and
   * does not sort, so the cases go LAST with depth WRITE off and depth TEST on:
   * fragments behind a solid are still rejected, the near wall blends over it,
   * and both walls double up on the silhouette, which is what makes it read as
   * glass rather than as fog. Reversed — case first, writing depth — the solid
   * nested inside it is depth-rejected and the actual column vanishes.
   *
   * Risers burst rather than clip: the two geometries are independent, so when
   * actual exceeds expected the narrower solid protrudes through the open top
   * of the case, lit and saturated on the teal arm. That protrusion IS the
   * riser glyph, on the same scale as everything else, which is why the old
   * ping-ring could be deleted rather than ported. */
  if (ctx.ghost) {
    /* 5b-i the caps. Drawn before the glass and with depth writing on, so a
     * case wall in front of a plate blends over it and the plate reads as the
     * lid of that particular box rather than as a free-floating tile. The
     * position carries the height directly — ColumnLayer's vertex shader adds
     * `instanceElevations` to `instancePositions.z`, so an unextruded column at
     * z is a plate at z, and no thirteenth layer type is needed. */
    for (const role of ROLES) {
      if (!roleShown(ctx.mode, role)) continue;
      const key = ROLE_SERIES[role];
      const data = rows.ghost[role];
      if (!data.length) continue;
      out.push(
        new ColumnLayer<SiteView>({
          id: `site-cap-${role}`,
          data,
          diskResolution: DISK_SIDES[role],
          angle,
          radius,
          radiusUnits: 'meters',
          offset: OFFSET[role],
          coverage: GHOST_COVERAGE,
          extruded: false,
          filled: true,
          getPosition: (s) => [
            s.mid[0],
            s.mid[1],
            elevationOf(ctx, s, model.siteGrid.expected[key][cell(s, hour)]) * elevationScale,
          ],
          getFillColor: (s) => capColor(ctx, s),
          pickable: false,
          updateTriggers: {
            // elevationScale only moves when the camera does, so this is a
            // pan-rate regeneration of 236 instances, not a frame-rate one.
            getPosition: [hour, elevationScale, ctx.hoveredSite],
            getFillColor: [hour, palette.name, refused, ctx.showDiagnosis],
          },
        }),
      );
    }

    for (const role of ROLES) {
      if (!roleShown(ctx.mode, role)) continue;
      const key = ROLE_SERIES[role];
      const data = rows.ghost[role];
      if (!data.length) continue;
      out.push(
        new ColumnLayer<SiteView>({
          id: `site-ghost-${role}`,
          data,
          diskResolution: DISK_SIDES[role],
          angle,
          radius,
          radiusUnits: 'meters',
          offset: OFFSET[role],
          coverage: GHOST_COVERAGE,
          extruded: true,
          filled: true,
          wireframe: true,
          // A lit case reads as a second solid. Only the contents are lit.
          material: false,
          // The case does not breathe: the baseline is a fixed 84-day median,
          // and a breathing expectation is nonsense.
          elevationScale,
          parameters: { depthWriteEnabled: false },
          getPosition: (s) => s.mid,
          getElevation: (s) => elevationOf(ctx, s, model.siteGrid.expected[key][cell(s, hour)]),
          getFillColor: (s) => ghostFill(ctx, s),
          getLineColor: (s) => ghostLine(ctx, s),
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
          lineWidthMinPixels: 1,
          pickable: true,
          // autoHighlight would light one picking index in one layer, i.e. one
          // role. Hover has to read at the site: both columns and the ring.
          autoHighlight: false,
          onHover: (info) => ctx.onHover((info.object as SiteView | undefined)?.siteId ?? null),
          onClick: (info) => ctx.onClick((info.object as SiteView | undefined)?.siteId ?? null),
          updateTriggers: {
            getElevation: [hour, ctx.hoveredSite],
            getFillColor: [hour, palette.name, refused],
            getLineColor: [hour, palette.name, refused],
          },
        }),
      );
    }
  }

  /* ---------------- 6 where we cannot see --------------------------------
   * Largely redundant now — an empty case IS the blind mark and a sem-unknown
   * fill IS the unscorable mark — but the toggle is what a coverage question
   * gets answered with, and at site scale it costs 118 flat marks, not 386. */
  if (ctx.showCoverage) {
    out.push(
      new ScatterplotLayer<SiteView>({
        id: 'coverage-blind',
        data: rows.blind,
        getPosition: (s) => s.mid,
        getLineColor: rgba(palette, 'sem-suppressed', 210),
        stroked: true,
        filled: false,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.2,
        radiusUnits: 'pixels',
        getRadius: 7,
        pickable: false,
        updateTriggers: { getLineColor: palette.name },
      }),
    );
    out.push(
      new ScatterplotLayer<SiteView>({
        id: 'coverage-unscorable',
        data: rows.unscorable,
        getPosition: (s) => s.mid,
        getFillColor: rgba(palette, 'sem-unknown', 90),
        filled: true,
        radiusUnits: 'pixels',
        getRadius: 3,
        pickable: false,
        updateTriggers: { getFillColor: palette.name },
      }),
    );
  }

  /* ---------------- 7 selection / hover marker ---------------------------
   * A ring on the ground at the site, not a highlight on one column: the
   * selection is the place, and the place is both roles. */
  const marked = [ctx.selectedSite, ctx.hoveredSite]
    .map((id) => (id == null ? null : model.bySiteId.get(id)))
    .filter((s): s is SiteView => !!s);
  if (marked.length) {
    out.push(
      new ScatterplotLayer<SiteView>({
        id: 'selection',
        data: marked,
        getPosition: (s) => s.mid,
        stroked: true,
        filled: false,
        getLineColor: rgba(palette, 'text-primary', 230),
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        radiusUnits: 'meters',
        getRadius: radius * 2.6,
        pickable: false,
        updateTriggers: {
          getPosition: marked.map((s) => s.siteId).join(','),
          getLineColor: palette.name,
        },
      }),
    );
  }

  return out;
}
