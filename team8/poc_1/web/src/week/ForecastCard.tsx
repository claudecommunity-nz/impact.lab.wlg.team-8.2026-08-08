/**
 * Left column, card 1. What the week is expected to be, and how far into it we
 * actually are.
 *
 * The delta beside the hero number is tiny on purpose (+0.1%): the forecast IS
 * the same-weekday median baseline with a citywide trend factor on it, and
 * showing that honestly is better than inventing a headline movement. The
 * interesting delta is the second tile — week to date against forecast to date.
 */

import { InfoBadge, Panel, StatTile } from '../ui';
import { useData } from '../data/DataProvider';
import { useAppState } from '../state/app';
import { weekSeriesFor } from './model';

const MODE_LABEL: Record<string, string> = {
  all: 'All modes',
  pedestrian: 'People',
  car: 'Vehicles',
  cyclist: 'Cyclists',
  bus: 'Buses',
  lgv: 'Light goods',
};

export function ForecastCard() {
  const { week } = useData();
  const { mode } = useAppState();
  if (!week) return null;

  const s = weekSeriesFor(mode);
  const forecast = week.week.forecast[s];
  const toDate = week.week.actual_to_date[s];
  const toDateDev = week.week.deviation_pct[s];

  return (
    <Panel
      title="Forecast for the week"
      subtitle={`${MODE_LABEL[mode] ?? mode} · ${week.label}`}
      // In `actions`, not `footnote`: as a footnote this cost a bordered
      // three-line block at the top of a 524px rail that has three cards to
      // fit. It is method, not a finding — the reader needs it once, on
      // demand. Safe in the header only because this Panel is NOT collapsible,
      // so the head is a <div>; on a collapsible Panel the head is a <button>
      // and a nested button is invalid HTML React refuses to hydrate.
      actions={
        <InfoBadge label="How the forecast is built" width={300}>
          The baseline pool ends the day before the week starts, so every hour is scored against
          a genuine forecast.
        </InfoBadge>
      }
    >
      {/* No delta beside the hero. Forecast IS the baseline times a 1.0013
          trend, so the honest number is +0.1% — and a "+0%" chip next to a
          nine-million figure reads as a broken stat, not as candour. The trend
          is named in the basis line where it can be read as method. */}
      <StatTile
        label="Movements expected"
        value={forecast}
        emphasis="hero"
        basis={`same-weekday same-hour median baseline × trend ${week.model.trend_factor}`}
      />

      <div className="pp-hairline" />

      <div className="pp-grid-2">
        <StatTile
          label="Week to date"
          value={toDate}
          delta={{ value: toDateDev, direction: toDateDev < 0 ? 'down' : 'up' }}
          basis="vs forecast"
        />
        <StatTile
          label="Confirmed"
          value={`${week.confirmed_hours}h`}
          basis={`of ${week.hours} hours`}
        />
      </div>
    </Panel>
  );
}
