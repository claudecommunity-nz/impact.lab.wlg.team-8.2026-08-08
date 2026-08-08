/**
 * Band D — the citywide week, 168 hours, with a sliding horizon.
 *
 * The one reading this has to deliver: the forecast and its 80% band run the
 * WHOLE week, and the measured line stops dead at the newest confirmed hour.
 * That cliff is the T+1 feed drawn rather than described — you can watch the
 * tool run out of knowledge. Everything here serves that contrast:
 *
 *   - forecast DASHED across all 168 hours, because a forecast is not a
 *     measurement and must not be mistaken for one;
 *   - actual solid only to min(cursor, horizon);
 *   - the space between them filled on both signs, so the running balance is
 *     an area you see rather than a gap between two hairlines;
 *   - the unreached remainder WASHED and labelled. It was previously left
 *     blank, and a blank right-hand third of a volume chart reads as a city
 *     that stopped moving on Friday morning — the single worst misreading
 *     this tool could invite.
 *
 * Built on the VitalsTrace primitive rather than a second SVG: it already
 * draws band + expectation + actual + breaks + day banding, and two charts
 * drifting apart is how a product stops looking like one instrument. The
 * horizon behaviour lives in the primitive too, behind its `horizon` prop.
 *
 * Earlier revision passed `gaps: [[confirmed, 168]]` instead. That reads
 * correctly for the actual line and WRONGLY for everything else: a gap breaks
 * the band and the expectation too, so the forecast — the part of the week a
 * duty officer is actually being briefed on — vanished.
 *
 * DAY SCOPE draws the same picture over 24 hours instead of 168 — same band,
 * same dashed forecast across the whole window, same wash past the horizon. It
 * is a WINDOW into the same series, not a second chart: `d0`/`span` slice the
 * week arrays and everything downstream is unchanged. The cursor stays the one
 * 0..167 week index; the day comes from it, never the other way round.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, VitalsTrace } from '../ui';
// Deep import on purpose: the day cells and the horizon flag are HTML siblings
// of the SVG and have to land on the SVG's own geometry, so they share its
// function rather than re-deriving it. Not a primitive, so not in the barrel.
import { traceFrac } from '../ui/VitalsTrace';
import { useData } from '../data/DataProvider';
import {
  useAppState,
  useDispatch,
  HOURS_PER_DAY,
  HOURS_PER_WEEK,
  type Scope,
} from '../state/app';
import { signedPct } from '../copy/strings';
import { weekSeriesFor } from './model';

/** Tall enough for a shortfall to look like one. Below ~130px the 8 Aug band
 *  and the actual line sit on top of each other. */
const CHART_HEIGHT = 150;

/** Fast enough to watch the shortfall accumulate inside a four-minute demo,
 *  slow enough that you can still see WHICH day it happened on. */
/**
 * Playback rates, ms per hour of the week.
 *
 * ×1 is the readable one and is DELIBERATELY slower than the old fixed 70 ms:
 * at 70 ms a 168-hour week is over in 12 seconds, which is a blur you cannot
 * narrate. ×1 takes ~24 s and lets someone watch a weekday build and fall; ×4
 * is the scrub for getting across the week while talking.
 */
const RATES = [
  { label: '×1', ms: 10000 },
  { label: '×2', ms: 5000 },
  { label: '×4', ms: 2500 },
] as const;

/**
 * Which rate each scope OPENS on, as an index into RATES.
 *
 * At ×1 an hour takes ten seconds, so a day runs 4 minutes and a week 28. A
 * week at ×1 is not a demo, it is a screensaver; a day at ×4 is 60 seconds and
 * the complaint that started this was that playback outran the side panels.
 * So: the week scrubs (×4), the day plays (×1).
 */
const DEFAULT_RATE: Record<Scope, number> = { week: 2, day: 0 };

/** `hourOnly` drops the weekday from the big clock. Streets always draws the
 *  newest CONFIRMED day, so only the hour of the scrubber drives anything on
 *  that screen — but the scrubber still walks the whole week. Seeking to Sat 8
 *  on WEEK and then opening STREETS put "Thu 6 Aug 06:00" in the header over a
 *  "SAT 8 06:00" clock over a Thursday table: two clocks disagreeing on a
 *  projector. TopBar already pins its stamp to the settled day for this reason;
 *  the fix never reached the bottom band, so the contradiction just moved down
 *  the screen. NOT derived from `chart`, which is also false on AREAS — there
 *  the header stamp does follow the cursor's day, so the day belongs. */
export function WeekChart({ chart = true, hourOnly = false }: { chart?: boolean; hourOnly?: boolean }) {
  const { week } = useData();
  const { weekHour, mode, dayOffset, scope: appScope } = useAppState();
  const dispatch = useDispatch();
  const series = weekSeriesFor(mode);

  /* Scope is the WINDOW: what the chart draws and what playback walks. On
   * Streets there is no chart, so it is only the second — "run this day" while
   * the rows update, which is the thing the scrubber was too fast to show. The
   * clock and the lit calendar chip both say which day, so a 24-hour scrubber
   * there is still legible. */
  const scope: Scope = appScope;
  const span = scope === 'day' ? HOURS_PER_DAY : HOURS_PER_WEEK;
  /** First hour-of-week the window covers. The window follows the cursor's day;
   *  a calendar chip moves the cursor, so it moves the window for free. */
  const d0 = scope === 'day' ? dayOffset * HOURS_PER_DAY : 0;

  /* Week playback is NOT the reducer's `playing`. TICK loops the DAY on
   * purpose, so the replay tab repeats; this walks the whole week once and
   * wraps. Two engines driving one cursor would fight, so starting this one
   * pauses that one. */
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState(DEFAULT_RATE[scope]);
  // Switching scope re-picks the rate rather than carrying it over: ×4 is the
  // right speed for 168 hours and a blur across 24.
  useEffect(() => setRate(DEFAULT_RATE[scope]), [scope]);
  // The interval closes over the render that armed it. A ref lets it read the
  // live cursor without re-arming every hour — re-arming threw away part of
  // each tick and turned a steady walk into a stutter.
  const cursorRef = useRef(weekHour);
  cursorRef.current = weekHour;

  useEffect(() => {
    if (!running) return;
    // Wraps inside the WINDOW. In day scope walking off midnight would change
    // which day the chart is drawing mid-sentence — the same reason the
    // reducer's own TICK loops the day rather than the week.
    const id = window.setInterval(
      () =>
        dispatch({ type: 'SEEK_WEEK', index: d0 + ((cursorRef.current - d0 + 1) % span) }),
      RATES[rate].ms,
    );
    return () => window.clearInterval(id);
  }, [running, dispatch, rate, d0, span]);

  const geom = useMemo(() => {
    if (!week) return null;
    // The window's OWN horizon: how many of its hours the feed has filled.
    // Clamped both ways — a past day is 24, a day that has not happened is 0
    // and the wash then covers the whole chart, which is the truth.
    const horizon = Math.max(0, Math.min(span, week.confirmed_hours - d0));
    const cut = (s: number[]) => s.slice(d0, d0 + span);
    const raw = week.actual[series].slice(d0, d0 + span);

    // null -> 0 for the GEOMETRY ONLY. Every one of those hours is either
    // inside `gaps` or past `horizon`, so no zero is ever drawn. NaN would be
    // the tidier sentinel and is unusable: one NaN in a path's `d` attribute
    // makes the browser silently discard the entire path.
    const actual = raw.map((v) => v ?? 0);

    // A hole BEFORE the horizon is a different fact from the horizon itself:
    // the feed delivered that hour and it was empty. Breaks, never zeros.
    const gaps: Array<[number, number]> = [];
    let open = -1;
    for (let i = 0; i < horizon; i++) {
      if (raw[i] === null && open < 0) open = i;
      if (raw[i] !== null && open >= 0) {
        gaps.push([open, i]);
        open = -1;
      }
    }
    if (open >= 0) gaps.push([open, horizon]);

    return {
      horizon,
      actual,
      expected: cut(week.forecast[series]),
      band: { lo: cut(week.band_lo[series]), hi: cut(week.band_hi[series]) },
      gaps,
      // Day banding is a seven-day idea. Omitted in day scope ON PURPOSE: with
      // no `days`, VitalsTrace falls back to its 24-column chart-paper, which
      // is an hour grid — correct over 24 hours, and a rule every 7 hours
      // (i.e. lined up with nothing) over 168.
      days: scope === 'day' ? undefined : week.days.map((d) => ({ at: d.offset })),
    };
  }, [week, series, d0, span, scope]);

  if (!week || !geom) return <div className="pp-weekchart pp-weekchart--empty" />;

  const dayIdx = Math.min(week.days.length - 1, Math.floor(weekHour / HOURS_PER_DAY));
  const day = week.days[dayIdx];
  const hh = `${String(weekHour % HOURS_PER_DAY).padStart(2, '0')}:00`;
  const dev = week.week.deviation_pct[series];
  // Mirrors VitalsTrace's own reveal rule — two limits, both real: the feed's
  // and the replay's. The flag has to land on the boundary the SVG drew, so it
  // derives it the same way rather than assuming the cursor won.
  const cursor = weekHour - d0;
  const revealed = Math.min(geom.horizon, cursor + 1);
  const dayDev = day.deviation_pct?.[series] ?? null;

  return (
    <div className="pp-weekchart">
      {chart && (
        <>
          <div className="pp-weekchart__head">
            <span className="pp-t-label pp-c-secondary">
              {scope === 'day'
                ? /* `short` ("THU 6"), not the weekday or the ISO date: the head
                     is uppercased by .pp-t-label, and "THURSDAY 2026-08-06" ran
                     the line into the figures on its right. Same token the
                     chips and the clock use. */
                  `Citywide · ${day.short} · 24 hourly slots · forecast band vs actual`
                : 'Citywide · hourly · forecast band vs actual'}
            </span>
            <span className="pp-t-mono-sm pp-c-secondary">
              {scope === 'day' ? (
                <>
                  actual has filled {geom.horizon} of {HOURS_PER_DAY} hours ·{' '}
                  {/* A day with no confirmed hour has no deviation, and printing
                      one would be a measurement of something that has not
                      happened. */}
                  {dayDev == null
                    ? 'no actual yet — forecast only'
                    : `day running ${signedPct(dayDev, 1)} against forecast`}
                </>
              ) : (
                <>
                  actual has filled {week.confirmed_hours} of {week.hours} hours · running{' '}
                  {signedPct(dev, 1)} against forecast
                </>
              )}
            </span>
          </div>

          <div className="pp-weekchart__plot">
            <VitalsTrace
              actual={geom.actual}
              expected={geom.expected}
              band={geom.band}
              gaps={geom.gaps}
              days={geom.days}
              cursor={cursor}
              horizon={geom.horizon}
              height={CHART_HEIGHT}
              onSeek={(h) => {
                setRunning(false);
                dispatch({ type: 'SEEK_WEEK', index: d0 + Math.round(h) });
              }}
              ariaSummary={
                scope === 'day'
                  ? `Citywide ${series} movement for ${day.weekday} ${day.date}. The forecast and its 80 percent band run across all ${HOURS_PER_DAY} hours; the measured actual runs to hour ${revealed} of that day. ${dayDev == null ? 'No hour of this day has been confirmed yet.' : `The day is running ${signedPct(dayDev, 1)} against forecast.`}`
                  : `Citywide ${series} movement for ${week.label}. The forecast and its 80 percent band run across all ${week.hours} hours; the measured actual runs to hour ${revealed}, the newest confirmed hour being ${week.horizon.last_confirmed_hour}. Week to date is running ${signedPct(dev, 1)} against forecast.`
              }
            />

            {/* Pinned to the HORIZON, never to the cursor. It used to ride the
                reveal boundary and swap its text to "not yet replayed", which
                made a scrubber position look like the edge of the feed. Now it
                is a fixed landmark you scrub across.
                Only drawn where the feed actually ends INSIDE this window: on a
                day that is wholly past or wholly ahead it would sit against an
                edge and claim the feed stops at midnight. */}
            {geom.horizon > 0 && geom.horizon < span && (
              <span
                className="pp-weekchart__flag pp-t-caption"
                style={{ left: `${traceFrac(geom.horizon - 1, span) * 100}%` }}
              >
                feed ends · {week.horizon.last_confirmed_hour.replace('T', ' ')}:00 ·{' '}
                {week.horizon.feed_lag}
              </span>
            )}
          </div>

          {/* Seven cells positioned off the SVG's own geometry, not at 1/7
              each: on an endpoint-anchored axis the last day spans 23 hours,
              and evenly-spaced cells drift off the bands they label. In day
              scope the same row becomes a three-hourly clock, positioned the
              same way and off the same function. */}
          <div className="pp-weekchart__axis pp-t-caption">
            {scope === 'day'
              ? Array.from({ length: HOURS_PER_DAY / 3 }, (_, k) => {
                  const from = k * 3;
                  const to = Math.min(span - 1, from + 3);
                  const left = traceFrac(from, span) * 100;
                  return (
                    <button
                      key={from}
                      type="button"
                      className="pp-weekchart__day"
                      data-current={Math.floor(cursor / 3) === k}
                      /* Past the horizon these hours have a forecast and no
                         measurement — the same italic the unhappened days get. */
                      data-state={from >= geom.horizon ? 'forecast' : 'confirmed'}
                      title={`${day.weekday} ${String(from).padStart(2, '0')}:00`}
                      onClick={() => dispatch({ type: 'SEEK_WEEK', index: d0 + from })}
                      style={{
                        left: `${left}%`,
                        width: `${traceFrac(to, span) * 100 - left}%`,
                      }}
                    >
                      {String(from).padStart(2, '0')}:00
                    </button>
                  );
                })
              : week.days.map((d, k) => {
                  const to =
                    k + 1 < week.days.length ? week.days[k + 1].offset : HOURS_PER_WEEK - 1;
                  const left = traceFrac(d.offset, HOURS_PER_WEEK) * 100;
                  const dd = d.deviation_pct?.[series];
                  return (
                    <button
                      key={d.date}
                      type="button"
                      className="pp-weekchart__day"
                      data-current={k === dayIdx}
                      data-state={d.state}
                      title={`${d.weekday} ${d.date} — ${d.state}`}
                      onClick={() => dispatch({ type: 'SET_WEEK_DAY', offset: k })}
                      style={{
                        left: `${left}%`,
                        width: `${traceFrac(to, HOURS_PER_WEEK) * 100 - left}%`,
                      }}
                    >
                      {d.short}
                      {dd == null ? (
                        /* A day that has not happened has no deviation, and
                           printing 0.0% for it would be an invented measurement. */
                        <span className="pp-weekchart__dev pp-c-muted">fcst</span>
                      ) : (
                        <span className="pp-weekchart__dev" data-sign={dd < 0 ? 'down' : 'up'}>
                          {signedPct(dd, 1)}
                        </span>
                      )}
                    </button>
                  );
                })}
          </div>
        </>
      )}

      <div className="pp-weekchart__cursor">
        <Button
          variant="chip"
          aria-pressed={running}
          title={scope === 'day' ? 'Run the day' : 'Run the week'}
          onClick={() => {
            dispatch({ type: 'PAUSE' });
            setRunning((r) => !r);
          }}
        >
          {running ? 'Pause' : 'Play'}
        </Button>
        {/* Rate, not duration. The old control offered "8s 12s 20s 40s", where
            the smallest number was the fastest — a scale that reads backwards
            at a glance and cost a beat every time someone used it. */}
        <span className="pp-weekchart__rates">
          {RATES.map((r, i) => (
            <Button
              key={r.label}
              variant="chip"
              data-active={i === rate}
              aria-pressed={i === rate}
              title={`${r.label} playback`}
              onClick={() => setRate(i)}
            >
              {r.label}
            </Button>
          ))}
        </span>
        {/* "Now", beside a large mono clock, labelled forecast-only hours as
            the present on a feed the rest of the product calls T+1. Dragged
            past hour 95 it read "NOW SAT 8 09:00" for a day that has not
            happened, in the biggest type on the screen. */}
        <span className="pp-t-label pp-c-secondary">At</span>
        <span className="pp-weekchart__clock pp-t-metric">
          {hourOnly ? hh : `${day.short} ${hh}`}
        </span>
        {/* Still the 0..167 week index — only its BOUNDS narrow in day scope,
            so the value under the thumb is the same number the map and Streets
            are reading. Two cursors is a bug this build has already had. */}
        <input
          className="pp-weekchart__range"
          type="range"
          min={d0}
          max={d0 + span - 1}
          step={1}
          value={weekHour}
          aria-label={scope === 'day' ? 'Hour of the day' : 'Hour of the week'}
          aria-valuetext={hourOnly ? hh : `${day.weekday} ${hh}`}
          onChange={(e) => {
            setRunning(false);
            dispatch({ type: 'SEEK_WEEK', index: Number(e.currentTarget.value) });
          }}
        />
        <span className="pp-weekchart__legend pp-t-caption pp-c-muted">
          <span className="pp-weekchart__key">
            <i className="pp-weekchart__swatch" /> actual
          </span>
          <span className="pp-weekchart__key">
            <i className="pp-weekchart__swatch pp-weekchart__swatch--forecast" /> forecast
          </span>
          <span className="pp-weekchart__key">
            <i className="pp-weekchart__swatch pp-weekchart__swatch--band" /> 80% band
          </span>
          <span className="pp-weekchart__key">
            <i className="pp-weekchart__swatch pp-weekchart__swatch--unknown" /> no actual yet
          </span>
        </span>
      </div>
    </div>
  );
}
