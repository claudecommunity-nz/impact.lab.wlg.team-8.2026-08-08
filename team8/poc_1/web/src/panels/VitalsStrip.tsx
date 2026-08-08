/**
 * THE ECG. Citywide pedestrian volume as one continuous trace.
 *
 * A normal week is a clean repeating waveform. On 23 Oct 2025 it flattens, and
 * nobody needs a flatline explained to them. On 4–5 Oct the trace is CUT, not
 * dropped: a partial ingest is drawn as a break in the line, because drawing it
 * as a low value would be the lie the whole tool exists to refuse.
 */

import { useMemo } from 'react';
import { VitalsTrace } from '../ui';
// Deep import on purpose: the axis labels are HTML siblings of the SVG and have
// to land on the SVG's own geometry, so they share its function rather than
// re-deriving it. Not re-exported from the barrel — it is not a primitive.
import { traceFrac } from '../ui/VitalsTrace';
import { useAppState, useDispatch } from '../state/app';
import { useData } from '../data/DataProvider';
import { signedPct } from '../copy/strings';

/** A calendar week, not a sliding window.
 *
 * Two days either side put the replay day in the middle every time, so the
 * shape around it changed with the weekday: a Thursday came flanked by two
 * weekdays, a Saturday by a weekend. The whole read of this trace is "the week
 * did its usual thing and then it didn't", and that only works when the week
 * is the frame — same start, same five working humps, in the same place. */
const WEEK_DAYS = 7;

/** A flatline needs vertical room to be flat in. At 96px inside a 162px strip
 *  the 23 October amplitude collapse read as a small dip rather than an arrest. */
// Shorter than the old boxed layout: in the portal the trace is a strip in the
// bottom bar, not a panel of its own, and 170px was a third of the viewport.
const VITALS_HEIGHT = 96;

export function VitalsStrip() {
  const { date, hour } = useAppState();
  const dispatch = useDispatch();
  const { vitals, model } = useData();

  const win = useMemo(() => {
    if (!vitals) return null;
    const at = vitals.day_index.findIndex((d) => d.date === date);
    if (at < 0) return null;
    const entry = vitals.day_index[at];

    // `weekday` is a full name written by the pipeline, so walk back through
    // the index rather than doing date arithmetic on strings. Stopping at 0 is
    // the guard for a file that opens mid-week.
    let mon = at;
    while (mon > 0 && vitals.day_index[mon].weekday !== 'Monday') mon--;

    // 2026-08-06 is the LAST day of its file, so its week runs off the end.
    // Clamp and let the axis show four days: an axis that draws days the feed
    // never delivered is the same lie as drawing an unreported hour as zero.
    const from = vitals.day_index[mon].offset;
    const to = Math.min(vitals.hours, from + WEEK_DAYS * 24);
    const slice = <T,>(a: T[]) => a.slice(from, to);
    const flags = slice(vitals.flags);

    // hours the feed never delivered → BREAKS in the line, never zeros
    const gaps: Array<[number, number]> = [];
    let open = -1;
    flags.forEach((f, i) => {
      if (f === 1 && open < 0) open = i;
      if (f !== 1 && open >= 0) {
        gaps.push([open, i]);
        open = -1;
      }
    });
    if (open >= 0) gaps.push([open, flags.length]);

    const marks = vitals.day_index
      .filter((d) => d.offset >= from && d.offset < to)
      .map((d) => ({ at: d.offset - from, label: d.weekday.slice(0, 3), date: d.date }));

    return {
      actual: slice(vitals.actual.pedestrian),
      expected: slice(vitals.expected.pedestrian),
      band: { lo: slice(vitals.band_lo.pedestrian), hi: slice(vitals.band_hi.pedestrian) },
      gaps,
      marks,
      cursor: entry.offset - from + hour,
      entry,
      weekStart: `${vitals.day_index[mon].weekday} ${vitals.day_index[mon].date}`,
    };
  }, [vitals, date, hour]);

  if (!win) {
    return <div className="pp-vitals pp-vitals--empty pp-t-caption pp-c-secondary">loading vitals…</div>;
  }

  const delta = model?.file.summary.citywide_delta_pct ?? null;
  const flat = model?.refused
    ? 'trace cut — the feed stopped delivering'
    : delta !== null && delta <= -25
      ? 'trace flattens through the hand-entered warning window'
      : 'trace tracks its expected waveform';

  return (
    <div className="pp-vitals">
      <div className="pp-vitals__head">
        <span className="pp-t-label pp-c-secondary">Citywide pedestrians · hourly</span>
        <span className="pp-t-mono-sm pp-c-secondary">
          {win.entry.weekday} {date} · {flat}
          {delta !== null && !model?.refused ? ` · ${signedPct(delta, 1)} on the day` : ''}
        </span>
      </div>
      <VitalsTrace
        actual={win.actual}
        expected={win.expected}
        band={win.band}
        gaps={win.gaps}
        days={win.marks}
        cursor={win.cursor}
        height={VITALS_HEIGHT}
        onSeek={(h) => {
          const rel = h - (win.cursor - hour);
          if (rel >= 0 && rel < 24) dispatch({ type: 'SEEK', hour: rel });
        }}
        ariaSummary={`Citywide pedestrian volume for ${win.entry.weekday} ${date}, shown across the ${win.marks.length} days from ${win.weekStart}. ${flat}.`}
      />
      <div className="pp-vitals__axis pp-t-caption pp-c-muted">
        {win.marks.map((m) => (
          <span
            key={m.date}
            className="pp-vitals__tick"
            data-current={m.date === date}
            /* Noon of the day, not its midnight: with the days banded, a label
               sitting on a boundary belongs to neither side. traceFrac, not
               at/length — the label was drifting half an hour off the SVG. */
            style={{
              left: `${traceFrac(Math.min(m.at + 12, win.actual.length - 1), win.actual.length) * 100}%`,
            }}
          >
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}
