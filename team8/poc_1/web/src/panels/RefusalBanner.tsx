/**
 * The refusal to panic, as a designed screen rather than an error toast.
 *
 * The strongest thing in the demo is that we display the number we are
 * declining to report. Asserting the guard fires is weak; showing the alert it
 * suppressed is not.
 *
 * The guard itself lives in the pipeline, not here: on a refused day the
 * `scorable` bitset is written all-zero and every line's diagnosis is
 * 'not_observed'. There is no code path in this UI that could alert on it,
 * because the numbers to alert on were never written to disk.
 */

import { Callout } from '../ui';
import { useDispatch } from '../state/app';
import { useData } from '../data/DataProvider';
import { honesty, signedPct } from '../copy/strings';

export function RefusalBanner() {
  const { model } = useData();
  const dispatch = useDispatch();
  const refusal = model?.file.refusal;
  if (!model?.refused || !refusal) return null;

  return (
    <div className="pp-refusal">
      {/* One sentence on screen while you say the rest. Five paragraphs is a
          wall you read aloud badly or visibly skip; the line that lands is the
          headline and the one under it. Everything else is the arithmetic, and
          the arithmetic is for the sceptic who asks, not for the room. */}
      <Callout intent="refusal" title={honesty.refusalTitle}>
        <p className="pp-refusal__lead">
          The missing volume is missing data, not missing people.
        </p>
        <details className="pp-refusal__more">
          <summary className="pp-t-label">Show the arithmetic</summary>
          <p>{refusal.message}</p>
          <p>
            A naive detector reads this day as{' '}
            <strong className="pp-refusal__naive">{signedPct(refusal.naive_delta_pct, 1)}</strong>{' '}
            citywide. It is a partial ingest, not an event. The map is frozen and hatched because we
            have nothing to say about it.
          </p>
          <p className="pp-t-caption">
            {refusal.hours_reported} of 24 hours delivered (threshold {refusal.threshold}). Missing:{' '}
            {compress(refusal.hours_missing)}.
          </p>
          <p className="pp-t-caption">
            {refusal.seam.note}{' '}
            <button
              type="button"
              className="pp-btn pp-btn--chip"
              onClick={() => dispatch({ type: 'SET_DATE', date: refusal.seam.partner_date })}
            >
              see {refusal.seam.partner_date}
            </button>
          </p>
        </details>
      </Callout>
    </div>
  );
}

function compress(hours: number[]): string {
  if (!hours.length) return 'none';
  const runs: string[] = [];
  let start = hours[0];
  let prev = hours[0];
  for (const h of hours.slice(1)) {
    if (h !== prev + 1) {
      runs.push(start === prev ? `${pad(start)}` : `${pad(start)}–${pad(prev)}`);
      start = h;
    }
    prev = h;
  }
  runs.push(start === prev ? `${pad(start)}` : `${pad(start)}–${pad(prev)}`);
  return runs.join(', ');
}

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
