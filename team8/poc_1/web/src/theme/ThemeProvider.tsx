import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { PALETTES, DEFAULT_PALETTE, type Palette, type PaletteName } from './palettes';
import { cssVarsForPalette } from './color';
import { tokens, elevationDark, elevationLight, type Tokens } from './foundations';

export interface ThemeValue {
  paletteName: PaletteName;
  palette: Palette;
  tokens: Tokens;
  setPalette: (p: PaletteName) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/** Palette-invariant vars. Computed once; identical for every palette. */
const INVARIANT_VARS: Record<string, string> = (() => {
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(tokens.space)) v[`--pp-space-${k}`] = val;
  for (const [k, val] of Object.entries(tokens.radius)) v[`--pp-radius-${k}`] = val;
  for (const [k, val] of Object.entries(tokens.font)) v[`--pp-font-${k}`] = val;
  for (const [k, val] of Object.entries(tokens.motion)) v[`--pp-motion-${k}`] = `${val}ms`;
  for (const [k, val] of Object.entries(tokens.easing)) v[`--pp-ease-${k}`] = val;
  // NB elevation is deliberately NOT here — it is per-scheme, see schemeVars().
  for (const [k, t] of Object.entries(tokens.type)) {
    v[`--pp-type-${k}-size`] = t.size;
    v[`--pp-type-${k}-lh`] = String(t.lineHeight);
    v[`--pp-type-${k}-weight`] = String(t.weight);
    v[`--pp-type-${k}-tracking`] = t.tracking;
  }
  return v;
})();

/** Shadow weights depend on the scheme, not on the individual palette. */
function schemeVars(palette: Palette): Record<string, string> {
  const set = palette.scheme === 'light' ? elevationLight : elevationDark;
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(set)) v[`--pp-elev-${k}`] = val;
  return v;
}

const STORAGE_KEY = 'pp:palette';

function readStoredPalette(): PaletteName {
  if (typeof localStorage === 'undefined') return DEFAULT_PALETTE;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && stored in PALETTES ? (stored as PaletteName) : DEFAULT_PALETTE;
}

export function ThemeProvider({
  children,
  palette: controlled,
}: {
  children: ReactNode;
  /** Force a palette (the gallery renders both side by side). */
  palette?: PaletteName;
}) {
  const [uncontrolled, setUncontrolled] = useState<PaletteName>(readStoredPalette);
  const paletteName = controlled ?? uncontrolled;
  const palette = PALETTES[paletteName];

  const setPalette = useCallback((p: PaletteName) => {
    setUncontrolled(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* private browsing; the palette just does not persist */
    }
  }, []);

  // The generation step. This is the only place custom properties are written.
  useLayoutEffect(() => {
    if (controlled) return; // scoped providers paint their own subtree, see ThemeScope
    const root = document.documentElement;
    const vars = { ...INVARIANT_VARS, ...schemeVars(palette), ...cssVarsForPalette(palette) };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.ppScheme = palette.scheme;
    root.dataset.ppPalette = palette.name;
  }, [palette, controlled]);

  const value = useMemo<ThemeValue>(
    () => ({ paletteName, palette, tokens, setPalette }),
    [paletteName, palette, setPalette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Paints a palette onto a subtree instead of :root. The gallery uses this to
 * show both palettes at once, which is also the proof that nothing in the
 * component set reaches past a custom property for a colour.
 */
export function ThemeScope({
  palette: name,
  children,
  className,
}: {
  palette: PaletteName;
  children: ReactNode;
  className?: string;
}) {
  const palette = PALETTES[name];
  const style = useMemo(
    () => ({ ...INVARIANT_VARS, ...schemeVars(palette), ...cssVarsForPalette(palette) }) as CSSProperties,
    [palette],
  );
  const value = useMemo<ThemeValue>(
    () => ({ paletteName: name, palette, tokens, setPalette: () => {} }),
    [name, palette],
  );
  return (
    <ThemeContext.Provider value={value}>
      <div className={className} style={style} data-pp-scheme={palette.scheme} data-pp-palette={name}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
