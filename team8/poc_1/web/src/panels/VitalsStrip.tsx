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
import { useAppState, useDispatch } from '../state/app';
import { useData } from '../data/DataProvider';
import { signedPct } from '../copy/strings';

/** Days of context either side of the replay day. */
const PAD_DAYS = 2;

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
    const entry = vitals.day_index.find((d) => d.date === date);
    if (!entry) return null;
    const from = Math.max(0, entry.offset - PAD_DAYS * 24);
    const to = Math.min(vitals.hours, entry.offset + (PAD_DAYS + 1) * 24);
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
        cursor={win.cursor}
        height={VITALS_HEIGHT}
        onSeek={(h) => {
          const rel = h - (win.cursor - hour);
          if (rel >= 0 && rel < 24) dispatch({ type: 'SEEK', hour: rel });
        }}
        ariaSummary={`Citywide pedestrian volume for ${date} with two days either side. ${flat}.`}
      />
      <div className="pp-vitals__axis pp-t-caption pp-c-muted">
        {win.marks.map((m) => (
          <span
            key={m.date}
            className="pp-vitals__tick"
            data-current={m.date === date}
            style={{ left: `${(m.at / win.actual.length) * 100}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}
