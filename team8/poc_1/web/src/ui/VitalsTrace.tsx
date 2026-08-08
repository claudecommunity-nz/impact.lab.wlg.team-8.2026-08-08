import { useId, useMemo, useRef, type MouseEvent } from 'react';

export type Series = Float32Array | readonly number[];

export interface VitalsTraceProps {
  actual: Series;
  expected: Series;
  /** p10/p90 envelope. */
  band?: { lo: Series; hi: Series };
  /** Unreported hours — drawn as BREAKS, never as zeros. Inclusive-exclusive. */
  gaps?: Array<[number, number]>;
  /**
   * Midnights, as indices into the series. Given, the vertical rules become one
   * per day plus a short noon tick, and each day gets an alternating band; the
   * 24-column chart-paper is used instead. Multi-day callers MUST pass this —
   * 24 evenly-spaced columns over a 7-day window put a rule every 7 hours,
   * which lines up with nothing and reads as an hour axis that it is not.
   */
  days?: Array<{ at: number }>;
  /** Current fractional hour. */
  cursor?: number;
  /**
   * HORIZON MODE. The number of hours that have an actual; hours from here on
   * have none and will not until the feed catches up.
   *
   * Passing it switches the whole rendering, because a forecast window is a
   * different picture from a finished day:
   *   - `expected` becomes a DASHED line drawn across the WHOLE window, gaps
   *     and all. A forecast exists for every hour — that is what makes it a
   *     forecast — so breaking it where the actual is missing would hide the
   *     one line that is supposed to keep going.
   *   - `actual` is drawn solid only up to min(cursor, horizon), and the
   *     remainder is washed. The band and the dashed forecast continuing while
   *     the actual stops IS the horizon; blank there would read as zero.
   *   - the space between actual and expected is filled on BOTH signs, every
   *     hour, not just where a threshold trips. Over a week the running
   *     balance is the story, not the individual emergencies.
   */
  horizon?: number;
  onSeek?: (hour: number) => void;
  height?: number;
  /** Screen-reader description of the trace. Required — the flatline must be sayable. */
  ariaSummary: string;
}

const PAD = { top: 10, right: 8, bottom: 10, left: 8 };
const W = 1000;

/**
 * Where sample `i` sits, as a fraction of the box width.
 *
 * Endpoint-anchored: the denominator is n-1, so the last sample lands on the
 * right edge rather than one step short of it. Exported because the axis
 * labels are HTML *outside* the SVG — when they computed their own position
 * against n they sat half an hour left of the geometry, invisible at 24 hours
 * and plainly wrong at seven day labels.
 */
export function traceFrac(i: number, n: number) {
  return (PAD.left + ((W - PAD.left - PAD.right) * i) / Math.max(1, n - 1)) / W;
}

/** How far below expected an hour must fall before it is coloured as deficit.
 *  Wide on purpose: the colour has to mean something when it appears. */
const DEFICIT_PCT = 25;

/**
 * Pure SVG. Given series, draws them. Knows nothing about Wellington.
 * The one thing it will not do is draw an unreported hour as a zero.
 */
export function VitalsTrace({
  actual,
  expected,
  band,
  gaps = [],
  days,
  cursor,
  horizon,
  onSeek,
  height = 112,
  ariaSummary,
}: VitalsTraceProps) {
  const ref = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, '');
  const n = actual.length;
  const H = height;

  const geom = useMemo(() => {
    const max = Math.max(
      1,
      ...Array.from(actual),
      ...Array.from(expected),
      ...(band ? Array.from(band.hi) : []),
    );
    const x = (i: number) => traceFrac(i, n) * W;
    const y = (v: number) => H - PAD.bottom - ((H - PAD.top - PAD.bottom) * v) / max;

    const missing = new Set<number>();
    for (const [a, b] of gaps) for (let i = Math.max(0, a); i < Math.min(n, b); i++) missing.add(i);

    /** Split into contiguous reported runs, so a gap is a break in the line. */
    const runs: number[][] = [];
    let run: number[] = [];
    for (let i = 0; i < n; i++) {
      if (missing.has(i)) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push(i);
    }
    if (run.length) runs.push(run);

    const path = (idx: number[], series: Series) =>
      idx.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(series[i]).toFixed(1)}`).join(' ');

    const bandPath = band
      ? runs
          .map((idx) => {
            const up = idx.map((i) => `${x(i).toFixed(1)},${y(band.hi[i]).toFixed(1)}`);
            const down = [...idx]
              .reverse()
              .map((i) => `${x(i).toFixed(1)},${y(band.lo[i]).toFixed(1)}`);
            return `M${up.join(' L')} L${down.join(' L')} Z`;
          })
          .join(' ')
      : '';

    /**
     * Hours the trace is MATERIALLY BELOW its ghost.
     *
     * Previously this was `Math.abs(off) >= deadZonePct`, which is symmetric and
     * only 8% wide — so the deficit colour alternated across every ordinary
     * Tuesday and the one day that matters got no distinction from the rest.
     * The emergency colour is now reserved for real shortfalls, in one
     * direction, so a normal day renders in a single calm colour.
     */
    const deficitRuns: number[][] = [];
    let dRun: number[] = [];
    for (const idx of runs) {
      for (const i of idx) {
        const e = expected[i];
        const off = e > 0 ? ((actual[i] - e) / e) * 100 : 0;
        if (off <= -DEFICIT_PCT) dRun.push(i);
        else {
          if (dRun.length > 1) deficitRuns.push(dRun);
          dRun = [];
        }
      }
      if (dRun.length > 1) deficitRuns.push(dRun);
      dRun = [];
    }

    /** The deficit as a SHAPE: the area between ghost and actual. A gap between
     *  two thin strokes is something you hunt for; an area is something you see. */
    const deficitArea = (idx: number[]) => {
      const top = idx.map((i) => `${x(i).toFixed(1)},${y(expected[i]).toFixed(1)}`);
      const bottom = [...idx].reverse().map((i) => `${x(i).toFixed(1)},${y(actual[i]).toFixed(1)}`);
      return `M${top.join(' L')} L${bottom.join(' L')} Z`;
    };

    /* --- horizon mode ------------------------------------------------- *
     * Everything below is inert unless `horizon` was given. */

    const all = Array.from({ length: n }, (_, i) => i);

    /** How far the solid actual has been revealed. Two limits, both real: the
     *  feed's (horizon) and the replay's (cursor). Whichever bites first. */
    const revealed =
      horizon === undefined
        ? n
        : Math.max(0, Math.min(horizon, cursor === undefined ? horizon : Math.floor(cursor) + 1));

    const actualRuns = runs.map((r) => r.filter((i) => i < revealed)).filter((r) => r.length > 1);

    /* The signed divergence, drawn as ONE area between the two lines per run
     * and then CLIPPED to the half-plane under and over the forecast. Splitting
     * into same-sign runs instead leaves a sliver of white at every crossing,
     * and over 96 hours the fill ends up looking like dashes. The clip is exact
     * at the crossing because both shapes are bounded by the same polyline. */
    const halfPlane = (to: number) =>
      `${all.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(expected[i]).toFixed(1)}`).join(' ')} L${x(n - 1).toFixed(1)},${to} L${x(0).toFixed(1)},${to} Z`;

    return {
      x,
      y,
      runs,
      path,
      bandPath,
      deficitRuns,
      deficitArea,
      missing,
      all,
      revealed,
      /** The last hour that HAS an actual. The wash and the horizon rule hang
       *  off this and nothing else — see the rect below for why. */
      horizonAt: Math.max(0, (horizon ?? n) - 1),
      actualRuns,
      belowClip: halfPlane(H),
      aboveClip: halfPlane(0),
      fullBand: band
        ? `M${all.map((i) => `${x(i).toFixed(1)},${y(band.hi[i]).toFixed(1)}`).join(' L')} L${[...all]
            .reverse()
            .map((i) => `${x(i).toFixed(1)},${y(band.lo[i]).toFixed(1)}`)
            .join(' L')} Z`
        : '',
    };
  }, [actual, expected, band, gaps, n, H, horizon, cursor]);

  const seek = (e: MouseEvent<SVGSVGElement>) => {
    if (!onSeek || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const t = (e.clientX - box.left) / box.width;
    onSeek(Math.max(0, Math.min(n, t * n)));
  };

  return (
    <svg
      ref={ref}
      className="pp-trace"
      viewBox={`0 0 ${W} ${H}`}
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaSummary}
      onClick={onSeek ? seek : undefined}
      style={onSeek ? { cursor: 'crosshair' } : undefined}
    >
      {/* Days as ground, painted before everything: a boundary you read as a
          change of surface rather than a line you have to go looking for. */}
      {days?.map((d, k) => {
        const end = k + 1 < days.length ? days[k + 1].at : n - 1;
        return (
          <rect
            key={`band${d.at}`}
            className="pp-trace__day"
            data-alt={k % 2 === 1}
            x={geom.x(d.at)}
            width={Math.max(0, geom.x(end) - geom.x(d.at))}
            y={0}
            height={H}
          />
        );
      })}

      {/* One rule per midnight, one short tick at noon. Nothing else — an
          hourly grid over a week is noise pretending to be an axis. */}
      {days
        ? days.flatMap((d) => [
            <line
              key={`m${d.at}`}
              className="pp-trace__grid pp-trace__grid--day"
              x1={geom.x(d.at)}
              x2={geom.x(d.at)}
              y1={0}
              y2={H}
            />,
            ...(d.at + 12 <= n - 1
              ? [
                  <line
                    key={`n${d.at}`}
                    className="pp-trace__grid pp-trace__grid--noon"
                    x1={geom.x(d.at + 12)}
                    x2={geom.x(d.at + 12)}
                    y1={H - 12}
                    y2={H}
                  />,
                ]
              : []),
          ])
        : /* chart-paper for the single-day callers: one column per hour */
          Array.from({ length: 25 }, (_, i) => (
            <line
              key={i}
              className={i % 6 === 0 ? 'pp-trace__grid pp-trace__grid--major' : 'pp-trace__grid'}
              x1={PAD.left + ((W - PAD.left - PAD.right) * i) / 24}
              x2={PAD.left + ((W - PAD.left - PAD.right) * i) / 24}
              y1={0}
              y2={H}
            />
          ))}

      {/* unreported hours: shaded, and the line simply is not there */}
      {gaps.map(([a, b]) => (
        <rect
          key={`g${a}-${b}`}
          className="pp-trace__gap"
          x={geom.x(a)}
          width={Math.max(1, geom.x(b) - geom.x(a))}
          y={0}
          height={H}
        />
      ))}

      {horizon === undefined ? (
        <>
          {band && <path className="pp-trace__band" d={geom.bandPath} />}
          {/* the deficit, as filled area — drawn under the strokes */}
          {geom.deficitRuns.map((idx, k) => (
            <path key={`da${k}`} className="pp-trace__deficit-area" d={geom.deficitArea(idx)} />
          ))}
          {geom.runs.map((idx, k) => (
            <path key={`e${k}`} className="pp-trace__ghost" d={geom.path(idx, expected)} />
          ))}
          {geom.runs.map((idx, k) => (
            <path key={`a${k}`} className="pp-trace__actual" d={geom.path(idx, actual)} />
          ))}
          {geom.deficitRuns.map((idx, k) => (
            <path
              key={`d${k}`}
              className="pp-trace__actual pp-trace__actual--deficit"
              d={geom.path(idx, actual)}
            />
          ))}
        </>
      ) : (
        <>
          <defs>
            <clipPath id={`${uid}-below`}>
              <path d={geom.belowClip} />
            </clipPath>
            <clipPath id={`${uid}-above`}>
              <path d={geom.aboveClip} />
            </clipPath>
          </defs>

          {/* Band and forecast run the WHOLE window — the part past the reveal
              is exactly the part a duty officer is being briefed on. */}
          {band && <path className="pp-trace__band" d={geom.fullBand} />}

          {/* Not-yet-known, washed. Without it the empty right-hand side reads
              as a week that collapsed to zero on Friday morning.
              ANCHORED TO `horizon`, NOT to the reveal. It used to start at
              min(cursor+1, horizon), so at cursor h=60 the wash — whose legend
              key reads "no actual yet" — covered 36 hours the feed genuinely
              holds, while the subtitle directly above said "actual has filled
              96 of 168 hours". Two different kinds of fact had one rendering:
              where the SCRUBBER is (UI state, scrub it away) and where
              KNOWLEDGE STOPS (the T+1 claim the whole product rests on). The
              cursor rule below says the first; this wash says only the second,
              so scrubbing across the horizon is now a thing you can watch. */}
          {/* Both marks are suppressed when the window is FULLY CONFIRMED.
              With horizon === n the wash has zero width but the rule still
              landed hard against the right edge — on the 24-hour day view of a
              settled Thursday that is a dashed "knowledge stops here" mark at
              23:00, claiming the feed ends at midnight. There is no edge of
              knowledge inside a window that has none. */}
          {horizon !== undefined && horizon < n && (
            <>
              <rect
                className="pp-trace__unknown"
                x={geom.x(geom.horizonAt)}
                width={Math.max(0, geom.x(n - 1) - geom.x(geom.horizonAt))}
                y={0}
                height={H}
              />

              {/* The edge of knowledge, as its own mark. Dashed and coloured, so
                  it cannot be confused with the thin solid cursor rule. */}
              <line
                className="pp-trace__horizon"
                x1={geom.x(geom.horizonAt)}
                x2={geom.x(geom.horizonAt)}
                y1={0}
                y2={H}
              />
            </>
          )}

          {geom.actualRuns.map((idx, k) => (
            <g key={`sd${k}`}>
              <path
                className="pp-trace__shortfall"
                clipPath={`url(#${uid}-below)`}
                d={geom.deficitArea(idx)}
              />
              <path
                className="pp-trace__surplus"
                clipPath={`url(#${uid}-above)`}
                d={geom.deficitArea(idx)}
              />
            </g>
          ))}

          <path
            className="pp-trace__ghost pp-trace__ghost--forecast"
            d={geom.path(geom.all, expected)}
          />
          {geom.actualRuns.map((idx, k) => (
            <path key={`ha${k}`} className="pp-trace__actual" d={geom.path(idx, actual)} />
          ))}
        </>
      )}

      {cursor !== undefined && (
        <>
          <line className="pp-trace__cursor" x1={geom.x(cursor)} x2={geom.x(cursor)} y1={0} y2={H} />
          {/* Past the horizon there is no actual to sit on, so the head rides
              the forecast instead — hollow, so it never reads as a reading. */}
          {horizon !== undefined && Math.floor(cursor) >= geom.revealed ? (
            <circle
              className="pp-trace__dot pp-trace__dot--forecast"
              cx={geom.x(cursor)}
              cy={geom.y(expected[Math.min(n - 1, Math.floor(cursor))])}
              r={3}
            />
          ) : (
            !geom.missing.has(Math.floor(cursor)) && (
              <circle
                className="pp-trace__dot"
                cx={geom.x(cursor)}
                cy={geom.y(actual[Math.min(n - 1, Math.floor(cursor))])}
                r={3}
              />
            )
          )}
        </>
      )}
    </svg>
  );
}
