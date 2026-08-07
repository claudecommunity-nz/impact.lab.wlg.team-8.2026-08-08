# Pōneke Pulse — web

Vite + React + TypeScript. deck.gl and MapLibre are installed but not yet wired;
the map and the chart composites are other agents' work. This package is the
foundation they stand on: the theme, the eight primitives, and the layout seams.

```sh
npm install
npm run dev        # http://localhost:5173      — the app shell
npm run build      # tsc -b && vite build       — must exit clean
npm run lint       # includes the no-hex-literals rule (see below)
```

Two routes, hash-based (one screen does not justify a router):

| Route | What |
|---|---|
| `#/` | `Shell` — the grid layout with every composite slot marked as a seam |
| `#/gallery` | every primitive, rendered in **both palettes at once**, no data required |

## Changing the palette

Every colour in the product is authored **once, as an RGB tuple**, in
`src/theme/palettes.ts`. That file is the only place in the codebase permitted
to contain a colour literal.

Two consumers derive from it, both generated, neither hand-maintained:

1. **CSS custom properties** — `ThemeProvider` writes `--pp-color-<token>: r g b`
   onto `:root` in a `useLayoutEffect`. Channels are space-separated so CSS can
   do `rgb(var(--pp-color-sem-deficit) / 0.4)` without a second alpha token.
2. **deck.gl accessors** — `rgba(palette, token, alpha)` returns `[r,g,b,a]`
   with alpha 0–255, read straight from the tuple. No string parsing in a hot
   accessor.

So:

- **Swap the active palette at runtime** — `useTheme().setPalette('daybreak')`,
  or the `PaletteSwitcher` in the right rail. It persists to `localStorage`.
- **Retune a palette** — edit the tuple in `palettes.ts`. Nothing else.
- **Add a palette** — copy the `NIGHTWATCH` object, change the values, add it to
  `PALETTES`. `TypeScript` will tell you if you miss a token, and the gallery
  picks it up with no further edits.

`ThemeScope` paints a palette onto a subtree instead of `:root`. The gallery
uses it to show both palettes simultaneously, which is also the proof that no
component reaches past a custom property for a colour.

Palette-invariant tokens (space, radius, type scale, motion, easing, elevation,
pulse constants, thresholds) live in `src/theme/tokens.ts` and are emitted the
same way as `--pp-space-4`, `--pp-type-h2-size`, `--pp-ease-scrub` and so on.

### The rule that makes swappability true rather than aspirational

`eslint.config.js` forbids any hex colour literal outside `src/theme/`:

```
no-restricted-syntax: Literal[value=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\b/]
```

If you find yourself wanting a hex, you want a token. Add it to `ColorToken`,
give it a value in **both** palettes, and read it back with `cssColor()` in CSS
or `rgba()` in deck.gl.

## Adding a component

Two tiers, and nothing else:

- **`src/ui/` — primitives.** Dumb. No app knowledge, no data imports, no
  fetches, no context beyond `useTheme`. Props in, DOM out. There are eight:
  `Panel`, `StatTile`, `Legend`, `Scrubber`, `Toggle`, `Callout`,
  `DiagnosisChip`, `VitalsTrace` (plus `TwinDotGlyph`, which `DiagnosisChip`
  composes).
- **`src/panels/` — composites.** Know the domain, read context, adapt payloads
  to primitive props. `SituationPanel`, `DiagnosisPanel`, `CoveragePanel` and
  friends belong here.

To add a primitive:

1. `src/ui/Thing.tsx` — export the component and its `ThingProps` interface.
2. Style it in `src/ui/ui.css` with a `.pp-thing` class. Colours are
   `rgb(var(--pp-color-*))`, spacing is `var(--pp-space-N)`, radii are
   `var(--pp-radius-*)`. Never an off-scale value.
3. Re-export it from `src/ui/index.ts`.
4. **Add it to `src/gallery/Gallery.tsx`.** A primitive that is not in the
   gallery is not reviewable, and reviewability is the point of the page.

User-facing strings — especially the honesty statements — live in
`src/copy/strings.ts`, not inline. They are load-bearing for the judging rubric
and must not drift between panels.

## Where the data comes from

The pipeline writes static artefacts to `web/public/data/` (owned by the
pipeline agent — do not write there from here). Vite serves `public/` at the
site root in dev and copies it byte-for-byte into `dist/` on build, so one path
serves both. Resolve every data URL through `dataUrl()` in `src/data/dataUrl.ts`
— `base: './'` means a bare `/data/...` breaks under a subpath deploy.

`src/data/types.ts` mirrors `pipeline/emit.py`. If the contract moves, both move.

## Seams left for later agents

`src/Shell.tsx` is the layout and nothing else. Each dashed slot names the
composite that replaces it and who owns it:

| Slot | Replaces with | Notes |
|---|---|---|
| `VitalsStrip` | the ECG, full-bleed, 112px | consumes `VitalsTrace` |
| `MapCanvas` | MapLibre basemap + one `<DeckGL>` | owns the rAF clock and the pulse uniform; the only file that imports deck.gl layers |
| `LeftRail` | `ReplayPicker` · `SituationPanel` · `DiagnosisPanel` · `RiserPanel` | |
| `RightRail` | `LayerPanel` · `CoveragePanel` · `DetailDrawer` | `PaletteSwitcher` already sits here |
| `TimeBar` | `Scrubber` + transport controls | `Scrubber` already supports the hatched unavailable spans |

State management is deliberately plain React: one reducer plus a hover ref, split
across three contexts by update frequency (theme ~never, app state ~24×/loop,
selection every mouse move). No redux/zustand/jotai. `ThemeContext` exists;
`AppStateContext` and `SelectionContext` are the next agent's to add.

## Dependency decisions

Runtime: `react`, `react-dom`, `@deck.gl/core`, `@deck.gl/layers`,
`@deck.gl/react`, `maplibre-gl`, `react-map-gl`, and three `@fontsource`
packages (self-hosted fonts, no CDN, no key). Granular `@deck.gl/*` rather than
the `deck.gl` umbrella, which drags in aggregation-layers, geo-layers,
mesh-layers and loaders.gl parsers we never touch.

Explicitly rejected: any component library (there are eight primitives), `d3-*`
(three linear scales, hand-written), a charting library (`VitalsTrace` needs gap
semantics no chart library gives), a router, a state library, `turf` (all
geometry work happens in Python).
