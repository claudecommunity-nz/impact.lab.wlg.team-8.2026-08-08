import { signedPct } from '../copy/strings';

export interface StatTileProps {
  label: string;
  value: string | number;
  unit?: string;
  /** Signed percent versus expected. */
  delta?: { value: number; direction: 'up' | 'down' };
  /** e.g. "vs 11 Thursdays, holidays and partial ingests excluded" */
  basis?: string;
  /** 'suppressed' renders an em-dash, never a fabricated zero. */
  state?: 'ok' | 'suppressed' | 'unknown';
  emphasis?: 'normal' | 'hero';
}

const fmt = (v: string | number) =>
  typeof v === 'number' ? v.toLocaleString('en-NZ') : v;

/** One number and its honesty. */
export function StatTile({
  label,
  value,
  unit,
  delta,
  basis,
  state = 'ok',
  emphasis = 'normal',
}: StatTileProps) {
  const suppressed = state !== 'ok';
  const valueClass = emphasis === 'hero' ? 'pp-t-metric-xl' : 'pp-t-metric';

  return (
    <div className="pp-stat" data-state={state}>
      <span className="pp-t-label pp-stat__label">{label}</span>
      <span className="pp-stat__value">
        <span className={valueClass}>{suppressed ? '—' : fmt(value)}</span>
        {unit && !suppressed && <span className="pp-stat__unit">{unit}</span>}
        {delta && !suppressed && (
          <span className="pp-t-mono-sm pp-stat__delta" data-dir={delta.direction}>
            {signedPct(delta.value)}
          </span>
        )}
      </span>
      {basis && <span className="pp-t-caption pp-stat__basis">{basis}</span>}
      {suppressed && (
        <span className="pp-t-caption pp-stat__basis">
          {state === 'suppressed' ? 'not reported — coverage too poor to judge' : 'cannot compare'}
        </span>
      )}
    </div>
  );
}
