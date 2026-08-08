/**
 * The whole deck.gl layer stack, as a pure function of (edges, weekHour, view).
 *
 * WHY PATHS, AND WHY THE COLUMNS ARE GONE. The 3D column stack answered a
 * question this map no longer asks. Columns encoded per-SITE volume against
 * per-site expectation, and they needed height because 386 countlines pile onto
 * ~123 points with a median gap under a pixel — position alone could not
 * separate them. The edge artefact does that separation in the pipeline: every
 * sensor is projected onto the road centreline it sits on and rolled up to one
 * edge per RAMM road id. Once a reading has a LINE to live on, the two channels
 * fit in 2D with no parallax, no lighting model and no mental rotation:
 *
 *   line WEIGHT  = flow volume, movements per hour. sqrt, so a 4× busier street
 *     is 2× fatter — width is a 1D channel read as area, and linear width made
 *     Hutt Rd a slab and every suburban street a hairline.
 *   line COLOUR  = deviation from THIS WEEK'S forecast for THIS hour, on the one
 *     diverging ramp the whole app uses.
 *
 * Colour policy, unchanged from the column era and non-negotiable:
 *   - fewer than two contributing sensors and the edge gets NO ramp colour. One
 *     camera speaking for a whole street is ranked, drawn and greyed — it is not
 *     a finding. (`EDGE_JUDGED_MIN_SENSORS`, and the artefact's own rule.)
 *   - an hour the feed has not confirmed yet (index ≥ confirmed_hours) draws at
 *     FORECAST width in ghost grey. A forecast is not a measurement and must
 *     never take the ramp.
 *   - the pipeline nulls `dev` under 5/hr forecast. A null draws ghost, never
 *     zero: "too small to take a percentage of" is not "on forecast".
 *   - a refused day emits no edge colour at all.
 */

import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { rampRgba, rgba, type Rgba } from '../theme/color';
import type { Palette } from '../theme/palettes';
import { HOURS, type DayModel, type SiteView } from '../data/derive';
import { EDGE_JUDGED_MIN_SENSORS, type Edge, type EdgeSeries, type LayerId } from '../data/types';
import type { GeoJsonLike } from '../data/load';
import {
  roadBaseLayer,
  trafficHeatLayer,
  type HeatPoint,
  type RoadBase,
} from './heat';

/**
 * One drawable polyline. An edge is a whole RAMM road id and the artefact gives
 * it as an ARRAY of polylines (a road id is not always one unbroken run), so the
 * rows are flattened once and the edge is carried on each piece — deck.gl wants
 * one datum per path and picking has to resolve back to the edge, not the piece.
 */
export interface EdgeRow {
  edge: Edge;
  /** deck.gl's PathGeometry wants fixed-length positions; the artefact publishes
   *  `number[][]` because JSON has no tuples. Narrowed once, here, rather than
   *  casting at each of the two accessors. */
  path: [number, number][];
}

/**
 * Flatten and order for DRAW ORDER, which is the only ordering decision on this
 * map: quiet streets first so a busy street is never buried under a hairline it
 * dwarfs. deck.gl draws in array order within a layer and does no depth sorting
 * for 2D paths.
 */
export function edgeRows(edges: Edge[]): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const edge of edges) {
    for (const path of edge.path) rows.push({ edge, path: path as [number, number][] });
  }
  return rows.sort((a, b) => (a.edge.flow_per_hour ?? 0) - (b.edge.flow_per_hour ?? 0));
}

export interface LayerCtx {
  /** Flattened once by the caller and handed back by reference every frame. */
  rows: EdgeRow[];
  /** 0..167. The one cursor. */
  weekHour: number;
  /** Index at and beyond which `flow`/`dev` are null — the T+1 horizon. */
  confirmedHours: number;
  /** Which of the three hourly edge series the mode pills asked for. */
  series: EdgeSeries;
  palette: Palette;
  /** The day artefact for the selected date, for coverage + the refusal. */
  model: DayModel | null;
  hour: number;
  refused: boolean;
  showCoverage: boolean;
  /** edge id, not site id — the pick target is the street now. */
  hoveredEdge: string | null;
  selectedEdge: string | null;
  /** Camera sites contributing to the picked edge, ringed on the ground. */
  markedSites: SiteView[];
  gis: Partial<Record<LayerId, GeoJsonLike>>;
  layers: Record<LayerId, boolean>;
  /** Every street in the city, drawn cold beneath everything. See heat.ts. */
  roadBase: RoadBase | null;
  /** Flow sampled along the lit edges, for the density surface. */
  heatPoints: HeatPoint[];
  showHeat: boolean;
  onHover: (edge: Edge | null) => void;
  onClick: (edge: Edge | null) => void;
}

/* ---------------------------------------------------------------------- *
 * The weight channel. Measured against week 32: hourly edge flow runs
 * 0 – 2,302/hr, median 663, p90 1,267.
 * ---------------------------------------------------------------------- */

/** Movements/hr at full line weight. p90 is ~1,270, so the top decile shares
 *  the fat end rather than one arterial owning the whole scale. */
const FLOW_FULL = 1500;

/** Pixels, not metres. Metres would make the weight channel a function of zoom —
 *  the same street would report a different flow at z12 and z16, which is a
 *  scale that lies. MIN is not zero: an edge that reported 3 movements is still
 *  an edge we watched, and a zero-width line is indistinguishable from a street
 *  we have no sensor on, which is the one confusion this app exists to prevent. */
const WIDTH_MIN_PX = 1.6;
const WIDTH_MAX_PX = 7;

/** The casing, in pixels ADDED to the coloured line. Two jobs.
 *
 *  It is the HALO first: the dead zone renders at `sem-neutral-zero`, which on
 *  the warm-paper palette is within a few percent of the CARTO basemap's own
 *  road grey — so the ~70 edges that are correctly reading "on forecast"
 *  disappeared into the basemap entirely and the map looked like it was only
 *  watching a dozen streets. A soft ink halo puts every watched edge back on the
 *  page without giving a flat edge a colour it has not earned. (It was first
 *  drawn in `bg-void` as a knockout, which is invisible on paper.)
 *
 *  It is the pick target second: a 2 px line is not clickable with a mouse, and
 *  picking is what drives the readout that carries the inference caveat. */
const CASING_PAD_PX = 2;

/** Ink at 1/4 strength in light, paper at 1/4 strength in dark — `text-primary`
 *  inverts with the palette, so the halo separates from the basemap either way
 *  without ever competing with the ramp it surrounds. */
const CASING_ALPHA = 34;

/** Hover has to be legible at projector distance without changing the reading,
 *  so it fattens the casing and lifts the stroke's alpha — it never touches the
 *  width of the coloured line, which is carrying a number. */
const HOVER_CASING_PAD_PX = 12;

function widthOf(ctx: LayerCtx, edge: Edge): number {
  const { weekHour, confirmedHours } = ctx;
  const flow =
    weekHour < confirmedHours ? (edge.flow[weekHour] ?? 0) : (edge.forecast_flow[weekHour] ?? 0);
  return WIDTH_MIN_PX + (WIDTH_MAX_PX - WIDTH_MIN_PX) * Math.sqrt(Math.min(1, flow / FLOW_FULL));
}

export const isJudgedEdge = (e: Edge): boolean => e.sensors >= EDGE_JUDGED_MIN_SENSORS;

/**
 * The one place an edge's colour is decided. Order matters and is the honesty
 * hierarchy, strongest refusal first.
 */
export function edgeColor(ctx: LayerCtx, edge: Edge): Rgba {
  const { palette, refused, weekHour, confirmedHours, series } = ctx;
  if (refused) return rgba(palette, 'sem-suppressed', 140);
  // Beyond the horizon there is no actual, so there is no deviation to draw.
  // The line is still here at forecast weight: this is a street we expect to
  // carry traffic, not a street we have judged.
  if (weekHour >= confirmedHours) return rgba(palette, 'sem-ghost', 120);
  if (!isJudgedEdge(edge)) return rgba(palette, 'sem-unknown', 170);
  const d = edge.dev[series]?.[weekHour];
  if (d == null || !Number.isFinite(d)) return rgba(palette, 'sem-ghost', 120);
  return rampRgba(palette, d);
}

/**
 * Street-event closures are a snapshot taken at fetch time — the file on disk is
 * all 2026-dated events. Drawn unfiltered over a replay of another date they
 * render as warning-orange polygons on a city that has just gone red, which a
 * viewer will read as closures in force that day. They are the one dataset here
 * that can be put into false temporal register with an event, so they are
 * filtered to the selected date and usually resolve to nothing.
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
 * Coverage rows, memoised on (model, hour).
 *
 * deck.gl regenerates an attribute buffer when `data` changes identity, so this
 * runs once per hour rather than on each of the frames in between.
 * ---------------------------------------------------------------------- */

interface CoverageRows {
  model: DayModel;
  hour: number;
  /** cameras that delivered no row at all this hour */
  blind: SiteView[];
  /** cameras that reported but whose baseline is too thin to score */
  unscorable: SiteView[];
}

let coverageCache: CoverageRows | null = null;

function coverageFor(model: DayModel, hour: number): CoverageRows {
  if (coverageCache && coverageCache.model === model && coverageCache.hour === hour) {
    return coverageCache;
  }
  const g = model.siteGrid;
  const blind: SiteView[] = [];
  const unscorable: SiteView[] = [];
  for (const site of model.sites) {
    const k = site.s * HOURS + hour;
    if (g.reported[k] !== 1) blind.push(site);
    else if (!g.scorable.total[k]) unscorable.push(site);
  }
  coverageCache = { model, hour, blind, unscorable };
  return coverageCache;
}

export function buildLayers(ctx: LayerCtx): Layer[] {
  const { palette, layers, gis, model, refused, weekHour, series } = ctx;
  const out: Layer[] = [];

  /* ---------------- 0 the cold base ---------------------------------------
   * Every street in Wellington, flat and cold, carrying no measurement. It goes
   * first so everything else sits on top of it.
   *
   * This is the coverage statement made visual. We reach 147 edges of a 937 km
   * network; drawing only those made a sparse instrument look complete, and left
   * "nothing happening here" indistinguishable from "nothing watching here".
   * The unlit majority is now the honest part of the picture. */
  out.push(...roadBaseLayer(ctx.roadBase, palette));

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
  if (layers.closures && gis.closures && model) {
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

  /* ---------------- 5 the edges ------------------------------------------
   * Two passes over the same rows. Splitting them is what makes the network
   * read as streets rather than as one felt-tip scribble: the casing is drawn
   * in the map's own background, so every crossing gets a break and the eye
   * follows a single line through a junction.
   */
  const picked = ctx.hoveredEdge ?? ctx.selectedEdge;
  const widthTriggers = [weekHour, ctx.confirmedHours];

  if (ctx.rows.length) {
    out.push(
      new PathLayer<EdgeRow>({
        id: 'edge-casing',
        data: ctx.rows,
        getPath: (r) => r.path,
        widthUnits: 'pixels',
        getWidth: (r) =>
          widthOf(ctx, r.edge) +
          (r.edge.id === picked ? HOVER_CASING_PAD_PX : CASING_PAD_PX),
        widthMinPixels: 4,
        /* SQUARE caps and joints, on both passes.
         *
         * The median edge is ~18px long at z13 and a busy one was a 7px stroke
         * inside an 11px round-capped halo — a capsule 61% as wide as it is
         * long, which the eye reads as a dot. Multiply by the 3–4 short
         * parallel fragments each road id carries and the CBD rendered as a mat
         * of smears with a blob at every segment end: line weight stopped
         * meaning volume and started meaning blob size. Butt caps make the same
         * geometry read as street segments. */
        capRounded: false,
        jointRounded: false,
        getColor: (r) =>
          rgba(palette, 'text-primary', r.edge.id === picked ? 210 : CASING_ALPHA),
        // Picking lives HERE, on the fat invisible-ish shape, not on the 2 px
        // coloured stroke above it. Hovering a suburban street with a mouse is
        // otherwise a game of pixel-hunting, and the readout is the only place
        // the inference caveat is stated.
        pickable: true,
        onHover: (info) => ctx.onHover((info.object as EdgeRow | undefined)?.edge ?? null),
        onClick: (info) => ctx.onClick((info.object as EdgeRow | undefined)?.edge ?? null),
        updateTriggers: {
          getWidth: [...widthTriggers, picked],
          getColor: [palette.name, picked],
        },
      }),
    );

    out.push(
      new PathLayer<EdgeRow>({
        id: 'edge-flow',
        data: ctx.rows,
        getPath: (r) => r.path,
        widthUnits: 'pixels',
        getWidth: (r) => widthOf(ctx, r.edge),
        widthMinPixels: 1.2,
        capRounded: false,
        jointRounded: false,
        getColor: (r) => edgeColor(ctx, r.edge),
        pickable: false,
        updateTriggers: {
          getWidth: widthTriggers,
          getColor: [weekHour, series, palette.name, refused, ctx.confirmedHours],
        },
      }),
    );
  }

  /* ---------------- 5b the heat ------------------------------------------
   * Density over points sampled every 25 m ALONG the lit edges, not over the
   * sensor sites. Sampling the sites blooms circles through the buildings on
   * either side of a street; sampling the line keeps the kernel on the road,
   * which is the whole return on the snap-and-propagate work upstream.
   *
   * Sits above the coloured edges so a hot patch reads against the network it
   * is on, and is suppressed entirely on a refused day — a density surface has
   * no per-object accessor to grey out. */
  if (ctx.showHeat && !refused) {
    out.push(...trafficHeatLayer(ctx.heatPoints, palette));
  }

  /* ---------------- 6 where we cannot see --------------------------------
   * The edge layer cannot state this: an edge with a dark sensor still draws,
   * greyed, and 'grey' is a weaker claim than 'this camera delivered nothing'.
   * The toggle is what a coverage question gets answered with.
   */
  if (ctx.showCoverage && model) {
    const cov = coverageFor(model, ctx.hour);
    out.push(
      new ScatterplotLayer<SiteView>({
        id: 'coverage-blind',
        data: cov.blind,
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
        data: cov.unscorable,
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

  /* ---------------- 7 which cameras are actually speaking -----------------
   * An edge's numbers are INFERRED: one to four sensors spread along a street,
   * decaying to zero at 300 m. Picking an edge rings the cameras that fed it,
   * so the distance between the ring and the end of the line is visible rather
   * than asserted in a caption.
   */
  if (ctx.markedSites.length) {
    out.push(
      new ScatterplotLayer<SiteView>({
        id: 'selection',
        data: ctx.markedSites,
        getPosition: (s) => s.mid,
        stroked: true,
        filled: false,
        getLineColor: rgba(palette, 'text-primary', 230),
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        radiusUnits: 'pixels',
        getRadius: 9,
        pickable: false,
        updateTriggers: {
          getPosition: ctx.markedSites.map((s) => s.siteId).join(','),
          getLineColor: palette.name,
        },
      }),
    );
  }

  return out;
}
