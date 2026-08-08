/**
 * The compounding read: movement deviation INSIDE a known hazard area.
 *
 * This is the one thing on the page that no existing tool says. A citywide
 * deviation tells a duty officer that something moved; an edge deviation tells
 * them which street. Neither says whether it matters. Joining the deviation to
 * a hazard polygon does: +22% on the waterfront inside a tsunami evacuation
 * zone is a different fact from +22% in Karori.
 *
 * The card is built so the claim can never appear without its arithmetic. The
 * headline is generated from the numbers, the evidence line under it carries
 * the counts, the camera total and the streets it rests on, and the areas we
 * cannot see are listed rather than filtered out. A confident sentence with no
 * working behind it is exactly what this project exists to argue against.
 */

import { InfoBadge, Panel } from '../../ui';
import { signedPct } from '../../copy/strings';
import type { Advisement } from '../../data/types';
import type { AreaSeries } from './types';
import {
  coverageNote,
  leadArea,
  rankAreas,
  statementFor,
  type RankedArea,
} from './model';
import type { AreaRiskFile } from './types';

export interface AreaRiskCardProps {
  file: AreaRiskFile | null;
  series: AreaSeries;
  weekHour: number;
  /** Hour label, e.g. "THU 09:00". */
  at: string;
  /**
   * A public warning covering this hour, or null. Only a warning licenses the
   * compliance reading of a drop — without one, a fall is just a fall.
   */
  warning?: Advisement | null;
  /** Past the newest confirmed hour. The card used to say "no hazard area has
   *  enough cameras inside it" while its own subtitle three lines above read
   *  "3 of 9 areas judgeable" — inviting a duty officer to conclude the sensor
   *  coverage failed when in fact the day simply has not happened. */
  beyondHorizon?: boolean;
}

/**
 * One row after the lead, and it earns its place.
 *
 * The zones NEST, so the second row is the same coastline read at a wider
 * radius — and that contrast is the finding: +22% inside the shore exclusion
 * zone against −3% across the whole self-evacuation zone says the rise is
 * concentrated at the water, not a citywide drift. Rows three and four say the
 * same thing again with more sensors, and this card sits above the edge list,
 * which has to stay on screen.
 */
const CONTEXT_ROWS = 1;

export function AreaRiskCard({
  file,
  series,
  weekHour,
  at,
  warning = null,
  beyondHorizon = false,
}: AreaRiskCardProps) {
  if (!file) return null;

  const rows = rankAreas(file.areas, series, weekHour);
  const lead = leadArea(rows);
  const rest = rows.filter((r) => r !== lead).slice(0, CONTEXT_ROWS);

  return (
    <Panel
      title="Movement inside a risk area"
      subtitle={`${at} · ${file.n_areas_judged} of ${file.n_areas} areas judgeable`}
      // Behind the (i), not in `footnote`. Coverage and inference together ran
      // to a clamped three-line bordered block on the FIRST card of a 524px
      // rail, and the card below it is the edge list — the payoff for the map.
      // Load-bearing honesty, so moved rather than cut: "6 of 9 hazard areas
      // have no camera inside them" is one click from the claim it qualifies.
      // Legal in the header only because this Panel is not collapsible (its
      // head is a <div>); a collapsible head is a <button> and would nest.
      actions={
        <InfoBadge label="Coverage behind this reading, and what it infers" width={300}>
          <span className="pp-area__pop">
            <span>{coverageNote(file.areas, file.min_sites)}</span>
            <span>{file.method.inference}</span>
          </span>
        </InfoBadge>
      }
    >
      {lead ? <Lead row={lead} series={series} warning={warning} /> : (
        <p className="pp-t-body pp-c-secondary">
          {beyondHorizon
            ? 'Beyond the confirmed feed — no actual for this hour yet, so no zone is scored.'
            : 'No hazard area has enough cameras inside it to judge at this hour.'}
        </p>
      )}

      {rest.length > 0 && (
        <ul className="pp-area">
          {rest.map((r) => (
            <Row key={r.area.id} row={r} />
          ))}
        </ul>
      )}

    </Panel>
  );
}

function Lead({
  row,
  series,
  warning,
}: {
  row: RankedArea;
  series: AreaSeries;
  warning: Advisement | null;
}) {
  const { claim, zone, reading, evidence } = statementFor(row, series, warning);
  return (
    <div
      className="pp-area__lead"
      data-dir={!row.material || row.dev == null ? 'flat' : row.dev < 0 ? 'down' : 'up'}
    >
      {/* Figure and zone on ONE line. Concatenated into a single sentence they
          wrapped to five lines at 330px and pushed the edge list off screen. */}
      <p className="pp-area__claim">
        <span className="pp-t-metric">{claim}</span>
        <span className="pp-t-body-lg">{zone}</span>
      </p>
      <p className="pp-t-body">{reading}</p>
      {/* The counts and the street names ARE the citation. Without them,
          "inside the zone" is an assertion about geography that the reader has
          no way to check — which is the failure mode this card exists to
          avoid. */}
      <p className="pp-t-caption pp-c-muted">{evidence}</p>
    </div>
  );
}

function Row({ row }: { row: RankedArea }) {
  const dev = row.dev;
  return (
    <li className="pp-area__row" data-judged={row.judged}>
      <span className="pp-area__name">
        <span className="pp-t-body">{row.area.class}</span>
        <span className="pp-t-caption pp-c-muted">
          {row.area.name} ·{' '}
          {row.area.sites === 0
            ? 'no camera inside'
            : `${row.area.sites} camera${row.area.sites === 1 ? '' : 's'}`}
          {row.area.sites > 0 && !row.judged ? ', unjudged' : ''}
        </span>
      </span>
      <span
        className="pp-area__dev pp-t-mono-sm"
        data-dir={dev == null ? 'none' : !row.material ? 'flat' : dev < 0 ? 'down' : 'up'}
      >
        {dev == null ? '—' : signedPct(dev)}
      </span>
    </li>
  );
}
