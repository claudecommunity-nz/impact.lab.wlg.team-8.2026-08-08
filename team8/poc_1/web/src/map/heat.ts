/**
 * The cold base and the heat on top of it.
 *
 * WHY THIS SHAPE. Every previous version of this map drew only what we can see —
 * 147 edges out of a 937 km network — so a sparse instrument looked like a
 * complete one, and "nothing happening here" was indistinguishable from
 * "nothing watching here". Now the whole city is drawn cold and traffic is heat
 * laid on top of it. The unlit majority IS the coverage statement; it does the
 * work a disclaimer was failing to do.
 *
 * Three strata, bottom to top:
 *   1. `road-base`    every street in Wellington, one flat cold colour, no data
 *   2. `edge-flow`    the edges a sensor reaches, coloured by deviation
 *   3. `traffic-heat` a kernel-density surface sampled along those edges
 *
 * NB this file has been deleted once by an automated dead-code pass. It is
 * imported by layers.ts and is not dead. If the map goes flat and grey, check
 * that this file still exists before debugging anything else.
 */

import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { rgba } from '../theme/color';
import type { Palette } from '../theme/palettes';

/** Geometry-only road network emitted by pipeline/roadbase.py. */
export interface RoadBase {
  version: number;
  n_paths: number;
  paths: [number, number][][];
}

/** One sampled point of flow, for the density surface. */
export interface HeatPoint {
  position: [number, number];
  weight: number;
}

/**
 * Sample points along a lit edge so the density kernel follows the street rather
 * than blooming a circle through the buildings either side of it.
 *
 * `stepM` is deliberately coarse. A finer step does not buy resolution — the
 * kernel radius dominates — it just multiplies the point count and the upload.
 */
export function sampleAlongPath(
  path: [number, number][],
  weight: number,
  stepM = 25,
): HeatPoint[] {
  if (path.length < 2 || weight <= 0) return [];
  const out: HeatPoint[] = [];
  // Local metric scale about Wellington. Good to well under a metre citywide.
  const LAT0 = -41.29;
  const mPerLon = 111320 * Math.cos((LAT0 * Math.PI) / 180);
  const mPerLat = 110574;

  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = path[i];
    const [x2, y2] = path[i + 1];
    const dx = (x2 - x1) * mPerLon;
    const dy = (y2 - y1) * mPerLat;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / stepM));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ position: [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t], weight });
    }
  }
  // Always include the final vertex, or long edges lose their end.
  out.push({ position: path[path.length - 1], weight });
  return out;
}

/**
 * Stratum 1. Every street, flat and cold, no data attached.
 *
 * Drawn at a hairline width that does NOT scale much with zoom: this is a
 * reference grid, not a subject, and a thick cold network competes with the
 * heat it exists to contextualise.
 */
export function roadBaseLayer(base: RoadBase | null, palette: Palette): Layer[] {
  if (!base?.paths?.length) return [];
  return [
    new PathLayer<[number, number][]>({
      id: 'road-base',
      data: base.paths,
      getPath: (d) => d,
      // sem-offline is the token for "we have no reading here", which is exactly
      // what an unlit street is. Low alpha so it reads as ground, not figure.
      getColor: rgba(palette, 'sem-offline', 150),
      getWidth: 1,
      widthUnits: 'pixels',
      widthMinPixels: 0.75,
      widthMaxPixels: 2,
      capRounded: true,
      jointRounded: true,
      pickable: false,
    }),
  ];
}

/**
 * Stratum 3. The heat.
 *
 * NOT a HeatmapLayer. deck.gl 9.3.7's GPU aggregation fails to bind its weights
 * texture against luma.gl 9.3.6 — `Binding weightsTexture not set: Not found in
 * shader layout` — with no duplicate packages and on a real Metal GPU with float
 * textures available. Rather than chase a shader on build day, the density is
 * approximated by additively blending soft discs at the points sampled along
 * each street.
 *
 * That is not a downgrade. A kernel over scattered points blooms circles through
 * the buildings either side of a road; these samples sit ON the centreline every
 * 25 m, so overlapping discs accumulate ALONG the street and the glow takes the
 * shape of the network. Two passes — a wide dim halo and a tighter brighter
 * core — give the falloff a single radius cannot.
 *
 * Radius is the honest knob. Too wide and the inference smears across suburbs we
 * never measured, which is the failure mode this layer was nearly rejected for.
 */
export function trafficHeatLayer(
  points: HeatPoint[],
  palette: Palette,
  opts: { haloPx?: number; corePx?: number } = {},
): Layer[] {
  if (!points.length) return [];
  // Small, and low-alpha. There are ~3,400 samples at 25 m spacing, so ADJACENT
  // discs already overlap heavily before any two streets meet; the first pass at
  // 26/11 px saturated to a solid blob that hid the network it sits on. The
  // accumulation has to come from many faint discs, not few strong ones.
  const { haloPx = 9, corePx = 3.5 } = opts;

  // Normalise against the busiest sample this hour so the ramp uses its whole
  // range whatever the time of day. p98 rather than max: one arterial at peak
  // should not flatten the entire rest of the city into the cold end.
  const sorted = points.map((p) => p.weight).sort((a, b) => a - b);
  const peak = Math.max(1, sorted[Math.floor(sorted.length * 0.98)]);
  const norm = (w: number) => Math.min(1, w / peak);

  // Additive blending: overlapping discs SUM toward the hot end, which is what
  // makes a busy corridor read hotter than an isolated sensor.
  const additive = {
    blend: true,
    blendColorSrcFactor: 'src-alpha' as const,
    blendColorDstFactor: 'one' as const,
    blendAlphaSrcFactor: 'one' as const,
    blendAlphaDstFactor: 'one' as const,
    depthTest: false,
  };

  const disc = (id: string, radius: number, alphaAt: (t: number) => number) =>
    new ScatterplotLayer<HeatPoint>({
      id,
      data: points,
      getPosition: (d) => d.position,
      radiusUnits: 'pixels',
      getRadius: radius,
      stroked: false,
      filled: true,
      // Warm through to hot. The cold end stays near-transparent so a quiet
      // street shows the bare cold network underneath rather than a tinted wash
      // that would read as a measured zero.
      getFillColor: (d) => {
        const t = norm(d.weight);
        const token = t > 0.66 ? 'sem-deficit-hot' : t > 0.33 ? 'sem-deficit' : 'status-warn';
        return rgba(palette, token, alphaAt(t));
      },
      pickable: false,
      parameters: additive,
      updateTriggers: { getFillColor: [palette.name, peak] },
    });

  return [
    disc('traffic-heat-halo', haloPx, (t) => 3 + 9 * t),
    disc('traffic-heat-core', corePx, (t) => 6 + 18 * t),
  ];
}
