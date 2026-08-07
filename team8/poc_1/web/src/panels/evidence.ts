/**
 * The vocabulary shared by every place a countline's numbers are shown.
 * Kept in one file so "offline" and "a genuine zero" can never accidentally be
 * described the same way in two different panels.
 */

import { HOURS, type DayModel, type LineView } from '../data/derive';

export type CellState = 'offline' | 'zero' | 'unscorable' | 'scored' | 'suppressed';

export function cellState(model: DayModel, line: LineView, hour: number): CellState {
  if (model.refused) return 'suppressed';
  const k = line.i * HOURS + hour;
  if (!model.reported[k]) return 'offline';
  if (!model.scorable[k]) return 'unscorable';
  if (model.actual[k] === 0) return 'zero';
  return 'scored';
}

/** Pipeline caveat slugs, said in words. */
export const CAVEAT_LABEL: Record<string, string> = {
  new_sensor_no_baseline: 'new sensor, no history to compare against',
  intermittent_sensor: 'sensor was mostly offline during the baseline',
  low_baseline_volume: 'baseline volume too low to be meaningful',
  single_mode_only: 'only one mode carries usable volume here',
  partial_hours: 'the feed did not deliver the whole day',
  sensor_silent_all_day: 'sensor reported nothing at all',
};
