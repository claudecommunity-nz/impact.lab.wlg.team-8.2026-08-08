/**
 * Band B, first group. Was a 702px card in the left rail.
 *
 * Unobservable days stay SELECTABLE and badged — picking one is the point of
 * the demo, not a debug flag — so the refused chips keep their hatch and read
 * "not assessed" rather than a number we did not earn.
 *
 * The role badge collapsed to a leading dot: at chip scale the words "the
 * event" / "the rhythm" doubled the width of every pill to say something the
 * delta already says.
 */

import { Button } from '../ui';
import { useAppState, useDispatch } from '../state/app';
import { useData } from '../data/DataProvider';
import { signedPct } from '../copy/strings';

/** "23 Oct" — the year is on the identity bar and never differs between days. */
const chipDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });

export function ReplayPills() {
  const { date } = useAppState();
  const dispatch = useDispatch();
  const { manifest } = useData();
  if (!manifest) return null;

  return (
    <div className="pp-pills" role="group" aria-label="Replay day">
      {manifest.days.map((d) => (
        <Button
          key={d.date}
          variant="chip"
          className="pp-pill pp-pill--day"
          data-active={d.date === date}
          data-date={d.date}
          data-verdict={d.verdict}
          title={d.label}
          aria-pressed={d.date === date}
          onClick={() => dispatch({ type: 'SET_DATE', date: d.date })}
        >
          <span className="pp-pill__dot" data-role={d.role} aria-hidden="true" />
          <span className="pp-pill__date">{chipDate(d.date)}</span>
          <span
            className="pp-pill__delta"
            data-null={d.citywide_delta_pct === null}
            data-dir={(d.citywide_delta_pct ?? 0) < 0 ? 'down' : 'up'}
          >
            {d.citywide_delta_pct === null ? 'not assessed' : signedPct(d.citywide_delta_pct)}
          </span>
        </Button>
      ))}
    </div>
  );
}
