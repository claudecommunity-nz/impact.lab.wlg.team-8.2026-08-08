/**
 * Band B — the week. Seven chips, Monday-anchored, and the whole point of the
 * component is that THREE OF THEM HAVE NOT HAPPENED YET.
 *
 * A forecast day must never look like a measurement. Suffixing a percentage
 * with "fcst" is not enough — at chip scale the eye reads the number and the
 * colour, not the label. So the two states do not share a unit:
 *
 *   confirmed / partial   a SIGNED PERCENT against this week's forecast for the
 *                         hours that have actually happened, coloured by sign
 *   forecast              the forecast VOLUME, mono, muted, uncoloured, over a
 *                         hatched chip
 *
 * Deviating from the mock's "forecast deviation" on purpose: forecast is
 * baseline x trend, so every future day's deviation-from-baseline is the trend
 * factor (+0.1%) and seven identical numbers would be theatre.
 */

import { useData } from '../data/DataProvider';
import { useAppState, useDispatch } from '../state/app';
import { ModePills } from './ModePills';
import { ScopeToggle } from './ScopeToggle';
import { weekSeriesFor } from '../week/model';
import type { WeekDay } from '../data/types';

/** 1,444,990 -> "1.44M". Chips are 92px; a full thousands-separated total is
 *  three times the width of the label above it. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const signed = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}%`;

export function CalendarStrip() {
  const { week, manifest } = useData();
  const { dayOffset, mode } = useAppState();
  const dispatch = useDispatch();
  const series = weekSeriesFor(mode);

  if (!week) {
    return (
      <div className="pp-cal">
        <span className="pp-t-label pp-c-secondary">loading the week…</span>
      </div>
    );
  }

  // A replay artefact only exists for a handful of dates. Where one does,
  // picking the chip also moves the per-countline day the map is drawing, so
  // the calendar and the instrument never disagree about which day it is.
  const artefactDates = new Set((manifest?.days ?? []).map((d) => d.date));

  return (
    <div className="pp-cal">
      <span className="pp-cal__label pp-t-label">{week.label}</span>

      <div className="pp-cal__days" role="group" aria-label="Day of the week">
        {week.days.map((d) => (
          <DayChip
            key={d.date}
            day={d}
            series={series}
            selected={d.dow === dayOffset}
            onSelect={() => {
              dispatch({ type: 'SET_WEEK_DAY', offset: d.dow });
              if (artefactDates.has(d.date)) dispatch({ type: 'SET_DATE', date: d.date });
            }}
          />
        ))}
      </div>

      <div className="pp-cal__modes">
        <ModePills />
        {/* Route-independent on purpose. Gating it on `useRoute()` here meant a
            SECOND subscription to hashchange, and the copy that mounted before
            the app's own redirect missed the event and disagreed with the
            Shell about which tab was open. Scope changes the chart on Week and
            the playback window everywhere, so it is never a dead control. */}
        <ScopeToggle />
      </div>
    </div>
  );
}

function DayChip({
  day,
  series,
  selected,
  onSelect,
}: {
  day: WeekDay;
  series: ReturnType<typeof weekSeriesFor>;
  selected: boolean;
  onSelect: () => void;
}) {
  const dev = day.deviation_pct?.[series] ?? null;
  const future = day.state === 'forecast';

  const value = future ? compact(day.forecast[series]) : dev === null ? '—' : signed(dev);
  const suffix = future ? 'fcst' : day.state === 'partial' ? 'so far' : 'actual';

  const title = future
    ? `${day.weekday} ${day.date} — not happened yet. Forecast ${day.forecast[
        series
      ].toLocaleString('en-NZ')} movements, from ${day.baseline_n} matched weekdays.`
    : `${day.weekday} ${day.date} — ${day.confirmed_hours} of 24 hours confirmed, measured against this week's forecast for those hours.`;

  return (
    <button
      type="button"
      className="pp-cal__chip"
      data-date={day.date}
      data-state={day.state}
      data-selected={selected}
      aria-pressed={selected}
      title={title}
      onClick={onSelect}
    >
      <span className="pp-cal__short pp-t-label">{day.short}</span>
      <span
        className="pp-cal__value pp-t-mono-sm"
        data-dir={future || dev === null ? 'none' : dev < 0 ? 'down' : 'up'}
      >
        {value}
      </span>
      <span className="pp-cal__suffix pp-t-caption">{suffix}</span>
    </button>
  );
}
