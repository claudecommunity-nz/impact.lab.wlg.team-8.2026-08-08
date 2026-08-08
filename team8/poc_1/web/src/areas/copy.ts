/**
 * Every sentence the Areas tab says, built from the numbers rather than
 * written. The point of generating them: a claim can never appear on this
 * screen without the arithmetic that produced it.
 */

import { signedPct } from '../copy/strings';
import type { RiskArea } from '../week/watch/types';
import { EPISODE_THRESHOLD_PCT, type Episode } from './episodes';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Week-hour index -> "MON 06:00". Hour 0 is 00:00 on the week's Monday. */
export function stampOf(weekStart: string, hour: number): string {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setHours(d.getHours() + hour);
  return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:00`;
}

const n = (v: number) => Math.round(v).toLocaleString('en-NZ');

const NOUN: Record<Episode['series'], string> = {
  total: 'movements',
  pedestrian: 'pedestrian movements',
  veh: 'vehicle movements',
};

/** What the run means, in one line, with no cause in it. */
export const sentenceOf = (e: Episode): string =>
  `${e.area.name} — ${
    e.sign < 0
      ? 'fewer people than expected inside a known hazard area.'
      : 'more people than expected inside a known hazard area.'
  }`;

/** The counts ARE the citation: without them "inside the zone" is an assertion
 *  about geography the reader has no way to check. */
export function countsOf(e: Episode): string {
  const streets = e.area.streets.slice(0, 1).join(', ');
  return (
    `${n(e.actual)} ${NOUN[e.series]} vs ${n(e.forecast)} forecast while flagged · ` +
    `${e.area.sites} camera${e.area.sites === 1 ? '' : 's'} on ${e.area.n_streets} street` +
    `${e.area.n_streets === 1 ? '' : 's'}${streets ? `, incl. ${streets}` : ''}`
  );
}

export const overlapLineOf = (e: Episode): string =>
  e.overlaps.length === 0
    ? 'No other hazard footprint holds these cameras.'
    : `Same cameras also sit inside ${e.overlaps.join(', ')} — ${
        e.overlaps.length + 1
      } footprints, one movement.`;

export interface CauseLine {
  text: string;
  /** Nothing on file explains this. The finding, not the absence of one. */
  unexplained: boolean;
  /** Typed in by a person from a public listing. Never presented as a feed. */
  handEntered: boolean;
}

/**
 * THE product line.
 *
 * A deviation is measured. A cause is not. Where a connected feed covers the
 * flagged hours we say what it says and whose it is; where nothing covers them
 * we say that, in the deficit colour, because an unexplained drop inside a
 * hazard footprint is the thing this whole tab exists to surface.
 */
export function causeOf(e: Episode): CauseLine {
  if (e.cause) {
    const who = e.cause.hand_entered ? 'hand-entered, duty desk' : e.cause.source;
    return {
      text: `Stated cause: ${e.cause.title}, ${e.cause.when} (${who})`,
      unexplained: false,
      handEntered: Boolean(e.cause.hand_entered),
    };
  }
  return {
    text:
      e.sign < 0
        ? 'No warning in force — a drop with no stated reason. Possible untracked risk.'
        : 'No event or closure on file — a rise with no stated reason. Possible untracked risk.',
    unexplained: true,
    handEntered: false,
  };
}

/**
 * Chips. Facts off the layer, not a severity rating we invented — and the last
 * one is the standing caveat: these are hazard-PLANNING footprints, so the
 * chip says so on every alert rather than once in a footnote.
 */
export const hazardsOf = (a: RiskArea): string[] => [
  a.layer_name,
  `${a.area_km2} km²`,
  'planning layer only',
];

export const rangeLabelOf = (e: Episode): string =>
  `${signedPct(e.min)} → ${signedPct(e.max)}`;

export const spreadLabelOf = (e: Episode): string =>
  `spread ${Math.round(e.spread)} pts · mean ${signedPct(e.mean)}`;

export const hoursLabelOf = (e: Episode): string =>
  `${e.hours} hour${e.hours === 1 ? '' : 's'} past ±${EPISODE_THRESHOLD_PCT}%`;

export const durationOf = (e: Episode): string =>
  `${e.hours} hour${e.hours === 1 ? '' : 's'}`;

/** −80%..+80% track. Everything outside is clamped to the ends rather than
 *  drawn off the bar. */
export const BAR_RANGE = 80;
export const barPct = (v: number): number =>
  ((Math.max(-BAR_RANGE, Math.min(BAR_RANGE, v)) + BAR_RANGE) / (2 * BAR_RANGE)) * 100;
