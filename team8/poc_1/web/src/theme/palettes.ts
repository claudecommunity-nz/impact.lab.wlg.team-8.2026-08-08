/**
 * THE ONLY FILE IN THIS CODEBASE THAT MAY CONTAIN A COLOUR LITERAL.
 *
 * Every colour is authored once, as an RGB tuple. Two derived consumers, both
 * generated, never hand-maintained:
 *   1. CSS custom properties  — emitted onto :root by ThemeProvider as
 *      `--pp-color-<token>: r g b;` so CSS can do `rgb(var(--pp-color-x) / 0.4)`.
 *   2. deck.gl accessors      — `rgba(palette, token, alpha)` -> [r,g,b,a].
 *
 * Swapping palette = changing ONE exported constant. See web/README.md.
 */

export type Rgb = readonly [number, number, number];

export const COLOR_TOKENS = [
  // structure
  'bg-void',
  'bg-base',
  'surface-1',
  'surface-2',
  'surface-3',
  'surface-scrim',
  'border-subtle',
  'border-strong',
  // The opaque identity bar. Its own token because no existing one is dark on
  // all three palettes: sem-pulse-healthy is pale mint on Nightwatch, so
  // filling the bar with the accent would invert the dark-chrome reading.
  'chrome-bar',
  'chrome-bar-ink',
  // text
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-inverse',
  // semantic — the load-bearing set
  'sem-pulse-healthy',
  'sem-pulse-healthy-core',
  'sem-deficit',
  'sem-deficit-hot',
  'sem-surplus',
  'sem-surplus-hot',
  'sem-ghost',
  'sem-ghost-core',
  'sem-unknown',
  'sem-offline',
  'sem-zero-observed',
  'sem-suppressed',
  'sem-neutral-zero',
  // feedback / status
  'status-ok',
  'status-warn',
  'status-alert',
  'status-info',
  'status-provisional',
  // transport modes (charts and legends only — NEVER the map line fill)
  'mode-pedestrian',
  'mode-car',
  'mode-cyclist',
  'mode-bus',
  'mode-lgv',
  'mode-other',
  // diagnosis categories (chips, glyphs and a 1px casing — never the line fill)
  'dx-exposure',
  'dx-road-closure',
  'dx-loss-of-access',
  'dx-people-not-traffic',
  'dx-cannot-type',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** A stop on the diverging percent-change ramp. `at` is a signed percent. */
export interface RampStop {
  readonly at: number;
  readonly rgb: Rgb;
  /** deck.gl alpha, 0–255. Severity rides alpha as well as lightness. */
  readonly alpha: number;
}

export interface Palette {
  readonly name: PaletteName;
  readonly label: string;
  readonly scheme: 'dark' | 'light';
  readonly color: Readonly<Record<ColorToken, Rgb>>;
  /** Alpha companions for the three tokens that are inherently translucent. */
  readonly alpha: {
    readonly scrim: number;
    readonly borderSubtle: number;
    readonly borderStrong: number;
  };
  readonly ramp: { readonly deficit: readonly RampStop[]; readonly surplus: readonly RampStop[] };
  /** Basemap treatment. The network must always be the brightest thing on screen. */
  readonly basemap: {
    readonly tiles: string;
    readonly attribution: string;
    readonly opacity: number;
    readonly filter: string;
    /** Multiply tint drawn over the whole viewport as a SolidPolygonLayer. */
    readonly tint: readonly [number, number, number, number];
  };
  /** Additive glow only works on a near-black field; light palettes drop it. */
  readonly glow: boolean;
}

/* ------------------------------------------------------------------ *
 * Palette A — NIGHTWATCH (default, dark)
 * ------------------------------------------------------------------ */

const NIGHTWATCH: Palette = {
  name: 'nightwatch',
  label: 'Nightwatch',
  scheme: 'dark',
  glow: true,
  alpha: { scrim: 0.72, borderSubtle: 0.1, borderStrong: 0.22 },
  color: {
    'bg-void': [6, 9, 12],
    'bg-base': [10, 14, 19],
    'surface-1': [16, 23, 32],
    'surface-2': [23, 32, 43],
    'surface-3': [31, 42, 56],
    'surface-scrim': [6, 9, 12],
    'border-subtle': [150, 178, 200],
    'border-strong': [150, 178, 200],
    'chrome-bar': [15, 20, 26],
    'chrome-bar-ink': [226, 232, 240],

    'text-primary': [232, 238, 242],
    'text-secondary': [159, 176, 190],
    'text-muted': [122, 138, 153],
    'text-inverse': [10, 14, 19],

    'sem-pulse-healthy': [168, 216, 206],
    'sem-pulse-healthy-core': [217, 242, 234],
    'sem-deficit': [255, 61, 113],
    'sem-deficit-hot': [255, 168, 190],
    'sem-surplus': [255, 194, 77],
    'sem-surplus-hot': [255, 235, 168],
    'sem-ghost': [110, 132, 148],
    'sem-ghost-core': [147, 170, 187],
    'sem-unknown': [70, 80, 92],
    'sem-offline': [43, 51, 61],
    // Moved off olive: it used to sit on top of the old surplus ramp's +15%
    // stop, so a genuine riser and a reported zero rendered as the same colour.
    'sem-zero-observed': [126, 116, 148],
    'sem-suppressed': [86, 98, 116],
    'sem-neutral-zero': [44, 56, 68],

    'status-ok': [79, 224, 168],
    'status-warn': [255, 160, 51],
    'status-alert': [255, 61, 113],
    'status-info': [111, 180, 255],
    'status-provisional': [185, 140, 255],

    'mode-pedestrian': [79, 224, 168],
    'mode-car': [111, 180, 255],
    'mode-cyclist': [185, 140, 255],
    'mode-bus': [224, 192, 136],
    'mode-lgv': [143, 163, 184],
    'mode-other': [94, 107, 120],

    'dx-exposure': [255, 92, 122],
    'dx-road-closure': [255, 160, 51],
    'dx-loss-of-access': [162, 107, 255],
    'dx-people-not-traffic': [63, 214, 192],
    'dx-cannot-type': [107, 119, 135],
  },
  ramp: {
    deficit: [
      { at: 0, rgb: [44, 56, 68], alpha: 200 },
      { at: -10, rgb: [74, 58, 76], alpha: 208 },
      { at: -25, rgb: [122, 49, 85], alpha: 216 },
      { at: -40, rgb: [168, 42, 92], alpha: 224 },
      { at: -55, rgb: [212, 37, 99], alpha: 232 },
      { at: -70, rgb: [246, 49, 110], alpha: 240 },
      { at: -85, rgb: [255, 92, 134], alpha: 248 },
      { at: -100, rgb: [255, 168, 190], alpha: 255 },
    ],
    // Risers must be as LOUD as deficits of equal magnitude, not dimmer.
    // The old arm ran dark olive -> bronze while the deficit arm reached vivid
    // crimson, so on 23 Oct the four risers — the Aro Valley story, the detail
    // that gets remembered — were the least visible marks on the map. Cyan at
    // matched luminance reads as a different KIND of thing, not less of the
    // same axis, and it clears the sem-zero-observed olive it used to collide
    // with at +15%.
    surplus: [
      { at: 0, rgb: [44, 56, 68], alpha: 200 },
      { at: 5, rgb: [46, 96, 104], alpha: 210 },
      { at: 15, rgb: [46, 150, 163], alpha: 224 },
      { at: 30, rgb: [46, 199, 214], alpha: 236 },
      { at: 50, rgb: [92, 224, 235], alpha: 244 },
      { at: 75, rgb: [148, 240, 246], alpha: 250 },
      { at: 100, rgb: [206, 250, 252], alpha: 255 },
    ],
  },
  basemap: {
    tiles: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap, © CARTO',
    // Spec said 0.55 / brightness(0.78). Measured against the real CARTO dark
    // tiles at Wellington's zoom that renders as pure black, and a chart with no
    // coastline is not a chart. Lifted just enough to read the harbour; the
    // network is still comfortably the brightest thing on screen.
    opacity: 0.72,
    filter: 'saturate(0.35) brightness(1.05) contrast(1.05)',
    tint: [11, 16, 23, 76],
  },
};

/* ------------------------------------------------------------------ *
 * Palette B — DAYBREAK (high-contrast light)
 * Same token names, inverted luminance logic: on light, severity gets
 * DARKER and more saturated. That is why the two cannot share one ramp.
 * ------------------------------------------------------------------ */

const DAYBREAK: Palette = {
  name: 'daybreak',
  label: 'Daybreak',
  scheme: 'light',
  glow: false,
  alpha: { scrim: 0.86, borderSubtle: 0.14, borderStrong: 0.3 },
  color: {
    'bg-void': [235, 231, 221],
    'bg-base': [244, 241, 234],
    'surface-1': [251, 250, 246],
    'surface-2': [232, 228, 218],
    'surface-3': [220, 215, 202],
    'surface-scrim': [244, 241, 234],
    'border-subtle': [30, 40, 50],
    'border-strong': [30, 40, 50],
    'chrome-bar': [18, 23, 28],
    'chrome-bar-ink': [251, 250, 246],

    'text-primary': [18, 23, 28],
    'text-secondary': [62, 74, 85],
    'text-muted': [102, 117, 127],
    'text-inverse': [251, 250, 246],

    'sem-pulse-healthy': [0, 96, 90],
    'sem-pulse-healthy-core': [0, 66, 62],
    'sem-deficit': [196, 0, 74],
    'sem-deficit-hot': [110, 0, 38],
    'sem-surplus': [122, 78, 0],
    'sem-surplus-hot': [63, 40, 0],
    'sem-ghost': [147, 162, 172],
    // not specified in the design system; darkened from sem-ghost so the
    // ghost's systolic peak still reads on paper.
    'sem-ghost-core': [110, 126, 138],
    'sem-unknown': [168, 176, 183],
    'sem-offline': [195, 199, 201],
    'sem-zero-observed': [124, 112, 150],
    'sem-suppressed': [154, 163, 174],
    'sem-neutral-zero': [198, 201, 194],

    'status-ok': [0, 95, 69],
    'status-warn': [138, 90, 0],
    'status-alert': [179, 0, 60],
    'status-info': [11, 79, 168],
    'status-provisional': [91, 43, 184],

    'mode-pedestrian': [0, 95, 69],
    'mode-car': [11, 79, 168],
    'mode-cyclist': [91, 43, 184],
    'mode-bus': [138, 90, 0],
    'mode-lgv': [90, 102, 114],
    'mode-other': [138, 146, 154],

    'dx-exposure': [179, 0, 60],
    'dx-road-closure': [138, 90, 0],
    'dx-loss-of-access': [91, 43, 184],
    'dx-people-not-traffic': [0, 96, 90],
    'dx-cannot-type': [90, 102, 114],
  },
  ramp: {
    deficit: [
      { at: 0, rgb: [198, 201, 194], alpha: 200 },
      { at: -10, rgb: [199, 169, 176], alpha: 208 },
      { at: -25, rgb: [192, 121, 142], alpha: 216 },
      { at: -40, rgb: [190, 74, 110], alpha: 224 },
      { at: -55, rgb: [179, 32, 79], alpha: 232 },
      { at: -70, rgb: [153, 0, 63], alpha: 240 },
      { at: -85, rgb: [122, 0, 49], alpha: 248 },
      { at: -100, rgb: [86, 0, 34], alpha: 255 },
    ],
    // Light palette inverts luminance: severity gets darker. Teal, so a riser is
    // a different kind of mark from a deficit — but the arm stops descending at
    // +30 and spends the rest on chroma, for the reason spelled out on Sequoia:
    // matched all the way down, the two extremes met at 1.09:1 and the deepest
    // riser was indistinguishable from the deepest deficit. It measures 3.55:1
    // now, and only the surplus arm had to give ground because the deficit arm
    // is the one carrying the emergency.
    surplus: [
      { at: 0, rgb: [198, 201, 194], alpha: 200 },
      { at: 5, rgb: [150, 186, 186], alpha: 210 },
      { at: 15, rgb: [90, 160, 164], alpha: 224 },
      { at: 30, rgb: [30, 128, 136], alpha: 236 },
      { at: 50, rgb: [16, 131, 138], alpha: 244 },
      { at: 75, rgb: [4, 134, 140], alpha: 250 },
      { at: 100, rgb: [0, 138, 144], alpha: 255 },
    ],
  },
  basemap: {
    tiles: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap, © CARTO',
    opacity: 0.6,
    filter: 'saturate(0.30) contrast(1.06)',
    tint: [244, 241, 234, 40],
  },
};

/* ------------------------------------------------------------------ *
 * Palette C — SEQUOIA (default, light)
 *
 * The register of a well-made instrument or an institutional report:
 * warm paper, warm ink, one restrained accent. Confident and quiet.
 *
 * Three decisions worth recording:
 *
 * 1. Deep forest is the INSTITUTIONAL ACCENT — chrome, focus rings, healthy
 *    pulse — and is deliberately NOT a data colour on the diverging axis.
 * 2. The surplus arm is TEAL, not green. Oxblood against forest green is the
 *    worst possible pair for red-green colour blindness (~1 in 12 men), and
 *    the risers are the detail that gets remembered. Teal keeps the family
 *    and survives deuteranopia.
 * 3. Severity gets DARKER and more saturated, never brighter — the inverse of
 *    a dark palette. This is why the ramps cannot be shared.
 * ------------------------------------------------------------------ */

const SEQUOIA: Palette = {
  name: 'sequoia',
  label: 'Sequoia',
  scheme: 'light',
  glow: false,
  alpha: { scrim: 0.82, borderSubtle: 0.12, borderStrong: 0.26 },
  color: {
    'bg-void': [239, 235, 227],
    'bg-base': [250, 248, 244],
    'surface-1': [255, 255, 255],
    'surface-2': [244, 241, 234],
    'surface-3': [233, 228, 217],
    'surface-scrim': [250, 248, 244],
    // Borders are warm ink at low alpha, never a grey — a neutral hairline on
    // warm paper reads blue and cheapens the whole surface.
    'border-subtle': [26, 24, 21],
    'border-strong': [26, 24, 21],
    // Deep forest: the one place the institutional accent carries weight.
    'chrome-bar': [31, 61, 47],
    'chrome-bar-ink': [250, 248, 244],

    'text-primary': [26, 24, 21],
    'text-secondary': [74, 69, 61],
    'text-muted': [107, 101, 92],
    'text-inverse': [250, 248, 244],

    'sem-pulse-healthy': [31, 61, 47],
    'sem-pulse-healthy-core': [18, 40, 30],
    'sem-deficit': [139, 38, 53],
    'sem-deficit-hot': [92, 20, 32],
    'sem-surplus': [31, 110, 106],
    'sem-surplus-hot': [12, 60, 59],
    'sem-ghost': [184, 176, 164],
    'sem-ghost-core': [150, 141, 128],
    'sem-unknown': [176, 169, 158],
    'sem-offline': [214, 208, 197],
    // Plum: off both arms of the ramp, so a reported zero can never be mistaken
    // for a deficit or a riser.
    'sem-zero-observed': [122, 96, 112],
    'sem-suppressed': [166, 159, 148],
    'sem-neutral-zero': [206, 200, 189],

    'status-ok': [46, 107, 79],
    'status-warn': [166, 124, 26],
    'status-alert': [139, 38, 53],
    'status-info': [43, 74, 110],
    'status-provisional': [104, 74, 138],

    'mode-pedestrian': [31, 61, 47],
    'mode-car': [43, 74, 110],
    'mode-cyclist': [104, 74, 138],
    'mode-bus': [166, 124, 26],
    'mode-lgv': [96, 104, 112],
    'mode-other': [140, 134, 124],

    'dx-exposure': [139, 38, 53],
    'dx-road-closure': [166, 124, 26],
    'dx-loss-of-access': [104, 74, 138],
    'dx-people-not-traffic': [31, 95, 90],
    'dx-cannot-type': [140, 134, 124],
  },
  ramp: {
    // Paper-neutral -> oxblood -> near-black claret.
    deficit: [
      { at: 0, rgb: [206, 200, 189], alpha: 200 },
      { at: -10, rgb: [205, 178, 174], alpha: 208 },
      { at: -25, rgb: [196, 142, 138], alpha: 216 },
      { at: -40, rgb: [180, 102, 101], alpha: 224 },
      { at: -55, rgb: [160, 68, 73], alpha: 232 },
      { at: -70, rgb: [139, 38, 53], alpha: 240 },
      { at: -85, rgb: [110, 26, 40], alpha: 248 },
      { at: -100, rgb: [78, 16, 28], alpha: 255 },
    ],
    // Paper-neutral -> teal, and it stops there.
    //
    // The arms used to be luminance-matched all the way down, which meant they
    // MET: -100% was [78,16,28] at luminance 0.021 and +100% was [12,60,59] at
    // 0.036, a contrast ratio of 1.22:1 between the two extremes where WCAG
    // wants 3:1 for a non-text graphic. The only thing separating the strongest
    // riser from the strongest deficit was dark-red against dark-green, which is
    // exactly the axis teal was chosen to avoid. So the surplus arm stops
    // descending at +30 and spends the rest of its range on chroma: +100 now
    // measures 3.45:1 against the deficit end and a riser reads as a different
    // KIND of mark, not as "also dark".
    surplus: [
      { at: 0, rgb: [206, 200, 189], alpha: 200 },
      { at: 5, rgb: [160, 190, 188], alpha: 210 },
      { at: 15, rgb: [110, 165, 163], alpha: 224 },
      { at: 30, rgb: [78, 150, 148], alpha: 236 },
      { at: 50, rgb: [52, 146, 144], alpha: 244 },
      { at: 75, rgb: [26, 142, 140], alpha: 250 },
      { at: 100, rgb: [0, 138, 136], alpha: 255 },
    ],
  },
  basemap: {
    tiles: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap, © CARTO',
    // Pushed further down than Daybreak: on paper the network is thin dark ink,
    // so the basemap has to recede much harder than it does on black or the
    // roads compete with the countlines.
    opacity: 0.48,
    filter: 'saturate(0.12) sepia(0.14) brightness(1.04) contrast(0.96)',
    tint: [250, 248, 244, 54],
  },
};

export const PALETTES = {
  sequoia: SEQUOIA,
  nightwatch: NIGHTWATCH,
  daybreak: DAYBREAK,
} as const;

export type PaletteName = 'sequoia' | 'nightwatch' | 'daybreak';

export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];
export const DEFAULT_PALETTE: PaletteName = 'sequoia';
