import { cssColor } from '../theme/color';
import type { ColorToken } from '../theme/palettes';

export interface ScrubberProps {
  min: number;
  max: number;
  step: number;
  /** Fractional hour 0..24 (controlled). */
  value: number;
  onChange: (v: number) => void;
  /** Playback pauses while the user drags. */
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  /** Warning window, sunrise, EOC activation… */
  marks?: Array<{ at: number; label?: string; token?: ColorToken }>;
  /** Hatched spans = hours the feed never delivered. The hole, visible before you play. */
  unavailable?: Array<[number, number]>;
  ariaLabel: string;
  /** Optional right-hand readout, e.g. the formatted hour. */
  readout?: string;
}

export function Scrubber({
  min,
  max,
  step,
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
  marks = [],
  unavailable = [],
  ariaLabel,
  readout,
}: ScrubberProps) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className="pp-scrub">
      <div className="pp-scrub__track-wrap">
        <div className="pp-scrub__track">
          <div className="pp-scrub__fill" style={{ width: `${pct(value)}%` }} />
          {unavailable.map(([a, b]) => (
            <div
              key={`gap-${a}-${b}`}
              className="pp-scrub__gap"
              style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }}
              title={`hours ${a}–${b} were never reported`}
            />
          ))}
        </div>
        {marks.map((m) => (
          <div
            key={`mark-${m.at}`}
            className="pp-scrub__mark"
            style={{ left: `${pct(m.at)}%`, background: cssColor(m.token ?? 'status-provisional', 0.8) }}
          >
            {m.label && <span className="pp-scrub__mark-label">{m.label}</span>}
          </div>
        ))}
        <input
          className="pp-scrub__input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={ariaLabel}
          aria-valuetext={readout}
          onPointerDown={onScrubStart}
          onPointerUp={onScrubEnd}
          onKeyDown={onScrubStart}
          onKeyUp={onScrubEnd}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
        />
      </div>
      <div className="pp-scrub__readout pp-t-mono-sm">
        <span>{formatHour(min)}</span>
        {readout && <span className="pp-c-primary">{readout}</span>}
        <span>{formatHour(max)}</span>
      </div>
    </div>
  );
}

export function formatHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
