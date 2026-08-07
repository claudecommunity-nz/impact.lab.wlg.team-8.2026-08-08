/**
 * Palette-invariant design tokens: space, radius, type, motion, elevation.
 * Only `color` and `ramp` vary per palette (see palettes.ts).
 *
 * Emitted to CSS as `--pp-<group>-<token>` by ThemeProvider, and consumed
 * directly in TS by anything that needs a number (deck.gl widths, easing).
 */

/* --- spacing: 4px base ------------------------------------------------ */
export const space = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '24px',
  6: '32px',
  7: '48px',
  8: '64px',
  9: '96px',
} as const;

/* --- radii: near-square. Clinical means machined, not rounded. -------- */
export const radius = {
  0: '0px',
  sm: '2px',
  md: '3px',
  lg: '5px',
  panel: '6px',
  pill: '999px',
} as const;

/* --- type: 1.25 major third, projector-biased. Floor is 14px. --------
 *
 * The floor was 13px, and measured in the live DOM 71 of 162 text leaf nodes
 * sat under 14px with only two above 20px. That is a design tuned at 100% on a
 * retina laptop; at 6 m from a projector the whole interface is caption-sized.
 * `caption` and `mono-sm` — the two steps that carry almost every figure and
 * every note in the rails — moved 13 → 14px. They did not go to 15: the rails
 * are on a 480px height budget and 15px overflows two of them, and a legible
 * panel that fits beats a larger one that scrolls the honesty statements out of
 * frame.
 *
 * Newsreader for display — editorial, warm, and it holds up at 4rem where a
 * grotesque would just look big. Public Sans for the interface: it is the US
 * government design system's face, drawn for public-sector tools, which is
 * exactly the register this needs. IBM Plex Mono for every figure.
 */
export const font = {
  sans: '"Public Sans Variable", "Public Sans", "Helvetica Neue", Arial, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  serif: '"Newsreader Variable", Newsreader, Georgia, "Times New Roman", serif',
} as const;

export interface TypeStyle {
  readonly size: string;
  readonly lineHeight: number;
  readonly weight: number;
  readonly tracking: string;
  readonly family: 'sans' | 'mono' | 'serif';
  readonly transform?: 'uppercase';
}

export const type = {
  // Newsreader is a lighter colour on the page than Instrument Serif at the
  // same size, so display and h1 carry more optical weight and slightly
  // looser leading to stop the ascenders crowding.
  display: { size: '4.25rem', lineHeight: 1.04, weight: 300, tracking: '-0.022em', family: 'serif' },
  h1: { size: '2.75rem', lineHeight: 1.1, weight: 300, tracking: '-0.016em', family: 'serif' },
  h2: { size: '1.875rem', lineHeight: 1.16, weight: 400, tracking: '-0.01em', family: 'serif' },
  h3: { size: '1.25rem', lineHeight: 1.24, weight: 600, tracking: '-0.006em', family: 'sans' },
  'body-lg': { size: '1.125rem', lineHeight: 1.45, weight: 400, tracking: '0', family: 'sans' },
  body: { size: '1rem', lineHeight: 1.5, weight: 400, tracking: '0', family: 'sans' },
  label: {
    size: '0.875rem',
    lineHeight: 1.3,
    weight: 550,
    tracking: '0.06em',
    family: 'sans',
    transform: 'uppercase',
  },
  caption: { size: '0.875rem', lineHeight: 1.4, weight: 400, tracking: '0.01em', family: 'sans' },
  'metric-xl': { size: '3.5rem', lineHeight: 1.0, weight: 500, tracking: '-0.02em', family: 'mono' },
  metric: { size: '1.5rem', lineHeight: 1.1, weight: 500, tracking: '-0.01em', family: 'mono' },
  'mono-sm': { size: '0.875rem', lineHeight: 1.35, weight: 450, tracking: '0', family: 'mono' },
} as const satisfies Record<string, TypeStyle>;

export type TypeToken = keyof typeof type;

/* --- motion ----------------------------------------------------------- */
export const motion = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 500,
  scrub: 600,
} as const;

export const easing = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  enter: 'cubic-bezier(0.0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  scrub: 'cubic-bezier(0.33, 0, 0.15, 1)',
} as const;

/* --- elevation --------------------------------------------------------
 *
 * Per-scheme, not palette-invariant. Dark UIs elevate with heavy black; on
 * warm paper the same values read as soot and make every floating panel look
 * like a dropped sticker. Light gets a softer, warmer, shorter shadow plus a
 * hairline, which is how paper actually stacks.
 */
export type ElevationSet = Readonly<Record<0 | 1 | 2 | 3, string>>;

export const elevationDark: ElevationSet = {
  0: 'none',
  1: '0 1px 2px rgba(0,0,0,0.55)',
  2: '0 4px 16px rgba(0,0,0,0.60), 0 1px 2px rgba(0,0,0,0.45)',
  3: '0 16px 48px rgba(0,0,0,0.70), 0 2px 6px rgba(0,0,0,0.50)',
};

export const elevationLight: ElevationSet = {
  0: 'none',
  1: '0 1px 1px rgba(46,38,26,0.06), 0 0 0 1px rgba(46,38,26,0.05)',
  2: '0 2px 8px rgba(46,38,26,0.08), 0 0 0 1px rgba(46,38,26,0.06)',
  3: '0 12px 32px rgba(46,38,26,0.12), 0 1px 3px rgba(46,38,26,0.08), 0 0 0 1px rgba(46,38,26,0.06)',
};

/** Kept for back-compat with anything reading tokens.elevation directly. */
export const elevation = elevationDark;

/* --- the pulse: §5 of the design system, numbers only ----------------- */
export const pulse = {
  bpmMin: 46,
  bpmMax: 98,
  ampMin: 0.18,
  ampMax: 1.0,
  /** Propagation offset, ms, CBD leads the suburbs. Keep under 150. */
  propagationMs: 140,
  widthBase: 1.6,
  widthRange: 5.4,
  glowAlphaBase: 0.12,
  glowAlphaRange: 0.6,
  glowWidthFactor: 3.2,
  ghostDashScrollPxPerSec: -18,
} as const;

/* --- thresholds that the UI must agree with the pipeline about -------- */
export const thresholds = {
  /** |Δ| below this renders flat at sem-neutral-zero. "Noise is not signal." */
  deadZonePct: 8,
  /** Display clamp on the ramp; above this renders at +50 with a ▲ marker. */
  rampClamp: { min: -100, max: 50 },
  /** Below this many reported hours, the day is unobservable — refuse to panic. */
  minHoursObserved: 22,
  /**
   * Expected movements per hour below which a percentage is a rounding error.
   * At 02:00 most sites see single digits, so +15% is two extra pedestrians:
   * on 23 Oct, 52% of pedestrian and 44% of vehicle site-hours sit under this
   * (94% of pedestrian cells at 03:00), and 79% of the cells that qualify as
   * "risers" are below it. A cell under the floor keeps its height and loses
   * its colour. Correctness, not styling.
   */
  minExpectedPerHour: 20,
  /** The same floor at day scale, for ranking a site rather than a cell. */
  minExpectedPerDay: 480,
  /**
   * A mode carries a site only if its expected mean over 07:00–19:00 clears
   * this — the same gate pipeline/config.py applies per countline, re-applied
   * to the site sum. Aggregation is what lets a site clear it when no single
   * member could.
   */
  modeViablePerHour: 5,
  /**
   * Ratio rules for typing a change, mirrored from pipeline/diagnose.py so the
   * site rollup can be re-typed from its own sums instead of voting on its
   * members' verdicts. If those constants move, move these.
   */
  diagnosis: {
    deadbandPct: 20,
    collapsePct: -30,
    absoluteCollapsePct: -80,
    ratio: 1.6,
    riserPct: 15,
  },
} as const;

export const tokens = {
  space,
  radius,
  font,
  type,
  motion,
  easing,
  elevation,
  pulse,
  thresholds,
} as const;

export type Tokens = typeof tokens;
