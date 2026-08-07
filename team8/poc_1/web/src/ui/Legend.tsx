import { useTheme } from '../theme/ThemeProvider';
import type { ColorToken } from '../theme/palettes';
import { cssColor, cssRgb, rampColor } from '../theme/color';
import { signedPct } from '../copy/strings';

export type LegendScale =
  /** Discrete swatches drawn straight from colour tokens. */
  | { kind: 'ramp'; stops: Array<{ label: string; token: ColorToken }> }
  /** The percent-change ramp, sampled from the live palette. */
  | { kind: 'gradient'; from: number; to: number; steps?: number }
  | {
      kind: 'categorical';
      items: Array<{ label: string; token: ColorToken; note?: string; pattern?: 'hatch' }>;
    };

export interface LegendProps {
  title: string;
  scale: LegendScale;
  note?: string;
}

/** Drives itself from tokens. No hand-written swatch colours anywhere. */
export function Legend({ title, scale, note }: LegendProps) {
  const { palette } = useTheme();

  return (
    <div className="pp-legend">
      <span className="pp-t-label pp-legend__title">{title}</span>

      {scale.kind === 'ramp' && (
        <>
          <div className="pp-legend__ramp">
            {scale.stops.map((s) => (
              <span
                key={s.token}
                className="pp-legend__ramp-cell"
                style={{ background: cssColor(s.token) }}
              />
            ))}
          </div>
          <div className="pp-legend__ramp-labels pp-t-mono-sm">
            {scale.stops.map((s) => (
              <span key={s.token}>{s.label}</span>
            ))}
          </div>
        </>
      )}

      {scale.kind === 'gradient' && (
        <>
          <div className="pp-legend__ramp">
            {sample(scale.from, scale.to, scale.steps ?? 30).map((v) => (
              <span
                key={v}
                className="pp-legend__ramp-cell"
                style={{ background: cssRgb(rampColor(palette, v).rgb) }}
                title={signedPct(v)}
              />
            ))}
          </div>
          <div className="pp-legend__ramp-labels pp-t-mono-sm">
            <span>{signedPct(scale.from)}</span>
            <span>0</span>
            <span>{signedPct(scale.to)}</span>
          </div>
        </>
      )}

      {scale.kind === 'categorical' && (
        <ul className="pp-legend__items">
          {scale.items.map((item) => (
            <li className="pp-legend__item" key={item.label}>
              <span
                className="pp-legend__swatch"
                data-hatched={item.pattern === 'hatch'}
                style={{ backgroundColor: cssColor(item.token) }}
              />
              <span className="pp-t-body">
                {item.label}
                {item.note && <em className="pp-t-caption pp-c-secondary"> — {item.note}</em>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="pp-t-caption pp-legend__note">{note}</p>}
    </div>
  );
}

function sample(from: number, to: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => from + ((to - from) * i) / (steps - 1));
}
