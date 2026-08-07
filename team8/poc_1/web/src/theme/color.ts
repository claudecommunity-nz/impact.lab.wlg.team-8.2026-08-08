/**
 * Colour derivation. No literals live here — everything resolves through a
 * Palette. Two consumers: CSS (strings) and deck.gl (RGBA number arrays).
 */

import type { ColorToken, Palette, Rgb, RampStop } from './palettes';
import { COLOR_TOKENS } from './palettes';
import { thresholds } from './foundations';

export type Rgba = [number, number, number, number];

/** deck.gl accessor form. `alpha` is 0–255. */
export function rgba(palette: Palette, token: ColorToken, alpha = 255): Rgba {
  const [r, g, b] = palette.color[token];
  return [r, g, b, alpha];
}

/**
 * CSS form. Reads the custom property rather than inlining channels, so a
 * palette swap repaints without re-rendering React.
 * `alpha` is 0–1.
 */
export function cssColor(token: ColorToken, alpha = 1): string {
  return alpha === 1 ? `rgb(var(--pp-color-${token}))` : `rgb(var(--pp-color-${token}) / ${alpha})`;
}

/** The CSS custom-property names ThemeProvider writes onto :root. */
export function cssVarsForPalette(palette: Palette): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const token of COLOR_TOKENS) {
    const [r, g, b] = palette.color[token];
    vars[`--pp-color-${token}`] = `${r} ${g} ${b}`;
  }
  vars['--pp-alpha-scrim'] = String(palette.alpha.scrim);
  vars['--pp-alpha-border-subtle'] = String(palette.alpha.borderSubtle);
  vars['--pp-alpha-border-strong'] = String(palette.alpha.borderStrong);
  vars['--pp-basemap-opacity'] = String(palette.basemap.opacity);
  vars['--pp-basemap-filter'] = palette.basemap.filter;
  vars['--pp-scheme'] = palette.scheme;
  return vars;
}

/* -------------------------------------------------------------------- *
 * Oklab interpolation. sRGB lerp muddies the magenta arm of the ramp —
 * a −40% line comes out grey-brown instead of crimson. ~40 lines to fix.
 * -------------------------------------------------------------------- */

type Oklab = [number, number, number];

const srgbToLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const linearToSrgb = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

function rgbToOklab([r, g, b]: Rgb): Oklab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Perceptually-even mix of two sRGB colours. `t` is 0–1. */
export function mixOklab(a: Rgb, b: Rgb, t: number): Rgb {
  const A = rgbToOklab(a);
  const B = rgbToOklab(b);
  return oklabToRgb([
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t,
  ]);
}

function interpolateStops(stops: readonly RampStop[], magnitude: number): { rgb: Rgb; alpha: number } {
  // stops are ordered by |at| ascending in both arms.
  const abs = stops.map((s) => Math.abs(s.at));
  if (magnitude <= abs[0]) return { rgb: stops[0].rgb, alpha: stops[0].alpha };
  for (let i = 1; i < stops.length; i++) {
    if (magnitude <= abs[i]) {
      const t = (magnitude - abs[i - 1]) / (abs[i] - abs[i - 1]);
      return {
        rgb: mixOklab(stops[i - 1].rgb, stops[i].rgb, t),
        alpha: Math.round(stops[i - 1].alpha + (stops[i].alpha - stops[i - 1].alpha) * t),
      };
    }
  }
  const last = stops[stops.length - 1];
  return { rgb: last.rgb, alpha: last.alpha };
}

export interface RampResult {
  rgb: Rgb;
  alpha: number;
  /** True when the value exceeded the display clamp — chip gets a ▲ marker. */
  clamped: boolean;
  /** True when |Δ| fell inside the dead zone and rendered flat. */
  deadZone: boolean;
}

/**
 * Map a signed percent change to a ramp colour.
 * - |Δ| < 8% renders flat at sem-neutral-zero. Noise must not look like signal.
 * - display domain clamps to [-100, +50]; beyond that, `clamped` is set so the
 *   caller can draw the ▲ rather than let an outlier hijack the scale.
 */
export function rampColor(palette: Palette, deltaPct: number): RampResult {
  if (!Number.isFinite(deltaPct) || Math.abs(deltaPct) < thresholds.deadZonePct) {
    return { rgb: palette.color['sem-neutral-zero'], alpha: 200, clamped: false, deadZone: true };
  }
  const { min, max } = thresholds.rampClamp;
  const clamped = deltaPct > max || deltaPct < min;
  const v = Math.max(min, Math.min(max, deltaPct));
  const arm = v < 0 ? palette.ramp.deficit : palette.ramp.surplus;
  const { rgb, alpha } = interpolateStops(arm, Math.abs(v));
  return { rgb, alpha, clamped, deadZone: false };
}

/** deck.gl form of the above. */
export function rampRgba(palette: Palette, deltaPct: number): Rgba {
  const { rgb, alpha } = rampColor(palette, deltaPct);
  return [rgb[0], rgb[1], rgb[2], alpha];
}

export const cssRgb = ([r, g, b]: Rgb): string => `rgb(${r} ${g} ${b})`;
