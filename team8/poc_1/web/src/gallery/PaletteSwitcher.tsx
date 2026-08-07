import { useTheme } from '../theme/ThemeProvider';
import { PALETTES, PALETTE_NAMES } from '../theme/palettes';

/** Proof the swap is one value, not a rebuild. */
export function PaletteSwitcher() {
  const { paletteName, setPalette } = useTheme();
  return (
    <div className="pp-row" role="radiogroup" aria-label="Palette">
      {PALETTE_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={name === paletteName}
          className="pp-dx"
          onClick={() => setPalette(name)}
          data-active={name === paletteName}
        >
          {PALETTES[name].label}
        </button>
      ))}
    </div>
  );
}
