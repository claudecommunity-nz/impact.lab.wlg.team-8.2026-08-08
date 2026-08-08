/**
 * Right column, card 1 — the streets furthest off forecast at the cursor hour.
 *
 * Unjudged edges (fewer than two contributing sensors — one camera speaking for
 * a whole street) are ranked alongside everything else and GREYED, never
 * dropped. Filtering them out would make a list built on 123 cameras look like
 * complete coverage of the city.
 */

import { Button, Panel } from '../ui';
import { signedPct } from '../copy/strings';
import { MIN_FORECAST_FLOW, type RankedEdge } from './model';

export interface EdgeDeviationListProps {
  rows: RankedEdge[];
  /** Hour label, e.g. "THU 6 AUG 09:00". */
  at: string;
  /** The cursor is past the newest confirmed hour, so there is no actual to
   *  deviate FROM. A different fact from "no street clears the volume floor",
   *  and the card used to print the second reason for the first situation. */
  beyondHorizon?: boolean;
  /** The day the cursor is on, for the beyond-horizon sentence. */
  dayLabel?: string;
  onAll: () => void;
}

export function EdgeDeviationList({
  rows,
  at,
  beyondHorizon = false,
  dayLabel,
  onAll,
}: EdgeDeviationListProps) {
  return (
    <Panel
      // Not "now". The subtitle already carries the hour, and on a scrubber that
      // reaches three days into the forecast "now" is a claim about the present
      // that the cursor is free to contradict.
      title="Edges off forecast"
      subtitle={at}
      footnote={`Inferred from up to four sensors, not established cause. Greyed = one sensor. Hours forecast under ${MIN_FORECAST_FLOW}/hr are excluded.`}
    >
      {rows.length === 0 ? (
        <p className="pp-t-body pp-c-secondary">
          {beyondHorizon ? (
            <>
              <strong>Beyond the confirmed feed.</strong> {dayLabel ?? 'This day'} has not happened
              — there is no actual to compare against, so no edge carries a deviation.
            </>
          ) : (
            <>
              No edge has a judgeable forecast at this hour — overnight, most streets fall under the{' '}
              {MIN_FORECAST_FLOW}/hr floor where a ratio is noise.
            </>
          )}
        </p>
      ) : (
        <ul className="pp-edges">
          {rows.map((r) => (
            <li className="pp-edges__row" key={r.edge.id} data-judged={r.judged}>
              <span
                className="pp-edges__chip"
                data-dir={(r.dev as number) < 0 ? 'down' : 'up'}
                aria-hidden="true"
              />
              {/* Flow lives in the caption, not its own column: at 330px a
                  four-column row truncated "Thorndon Quay" to "Thorndon …",
                  and the street name is the only part a duty officer acts on. */}
              <span className="pp-edges__name">
                <span className="pp-t-body-lg">{r.edge.name}</span>
                {/* Sensor count is deliberately NOT here: it is the same fact
                    as the grey, and spelling it out cost enough width to
                    truncate "Lady Elizabeth Lane" to "Lady Elizabeth La…". */}
                <span className="pp-t-caption pp-c-muted">
                  {r.edge.suburb ?? 'Wellington'} ·{' '}
                  {r.flow == null ? '—' : r.flow.toLocaleString('en-NZ')}/hr
                  {r.judged ? '' : ' · unjudged, 1 sensor'}
                </span>
              </span>
              <span
                className="pp-edges__dev pp-t-mono-sm"
                data-dir={(r.dev as number) < 0 ? 'down' : 'up'}
              >
                {signedPct(r.dev as number)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Names what it actually opens. It read "All {n} edges by deviation" and
          landed on the SITE table, which ranks camera sites and tops out around
          −16% where this list is showing −56% — so the one explicit call to
          action in the right rail made the headline finding evaporate. */}
      <Button className="pp-edges__all" onClick={onAll}>
        All camera sites by deviation →
      </Button>
    </Panel>
  );
}
