/**
 * Transport controls. A full 24 hours in 8–40 seconds, so the city can be seen
 * to breathe inside a four-minute demo. Hours the feed never delivered are
 * hatched on the track, so the hole is visible before you press play.
 */

import { Scrubber, formatHour } from '../ui';
import { SPEEDS, useAppState, useDispatch, type SecondsPerDay } from '../state/app';
import { useData } from '../data/DataProvider';

export function TimeBar() {
  const { hour, playing, secondsPerDay } = useAppState();
  const dispatch = useDispatch();
  const { model } = useData();

  const missing = model?.file.coverage.hours_missing ?? [];
  const unavailable: Array<[number, number]> = missing.map((h) => [h, h + 1]);

  const marks = model?.date === '2025-10-23' ? WARNING_MARKS : [];

  return (
    <div className="pp-timebar">
      <div className="pp-timebar__controls">
        <button
          type="button"
          className="pp-btn pp-btn--primary"
          onClick={() => dispatch({ type: 'TOGGLE_PLAY' })}
          aria-label={playing ? 'Pause playback' : 'Play the day'}
        >
          {playing ? '❚❚' : '▶'}
          <span className="pp-t-label">{playing ? 'Pause' : 'Play the day'}</span>
        </button>
        <button
          type="button"
          className="pp-btn"
          onClick={() => dispatch({ type: 'SEEK', hour: (hour + 23) % 24 })}
          aria-label="Previous hour"
        >
          −1h
        </button>
        <button
          type="button"
          className="pp-btn"
          onClick={() => dispatch({ type: 'SEEK', hour: (hour + 1) % 24 })}
          aria-label="Next hour"
        >
          +1h
        </button>
        <span className="pp-timebar__clock pp-t-metric">{formatHour(hour)}</span>
        <span className="pp-timebar__speed">
          <span className="pp-t-label pp-c-secondary">24h in</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className="pp-btn pp-btn--chip"
              data-active={s === secondsPerDay}
              onClick={() => dispatch({ type: 'SET_SPEED', secondsPerDay: s as SecondsPerDay })}
            >
              {s}s
            </button>
          ))}
        </span>
      </div>
      <Scrubber
        min={0}
        max={23}
        step={1}
        value={hour}
        onChange={(v) => dispatch({ type: 'SEEK', hour: v })}
        onScrubStart={() => dispatch({ type: 'SCRUB_START' })}
        onScrubEnd={() => dispatch({ type: 'SCRUB_END' })}
        marks={marks}
        unavailable={unavailable}
        readout={formatHour(hour)}
        ariaLabel="Hour of the replay day"
      />
    </div>
  );
}

/** The 23 Oct red-warning window. Hand-entered — labelled everywhere it shows. */
const WARNING_MARKS = [
  { at: 8, label: 'red warning (hand-entered)', token: 'status-provisional' as const },
  { at: 18, label: 'warning expires (hand-entered)', token: 'status-provisional' as const },
];
