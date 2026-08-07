import { useMemo, useRef, type MouseEvent } from 'react';

export type Series = Float32Array | readonly number[];

export interface VitalsTraceProps {
  actual: Series;
  expected: Series;
  /** p10/p90 envelope. */
  band?: { lo: Series; hi: Series };
  /** Unreported hours — drawn as BREAKS, never as zeros. Inclusive-exclusive. */
  gaps?: Array<[number, number]>;
  /** Current fractional hour. */
  cursor?: number;
  onSeek?: (hour: number) => void;
  height?: number;
  /** Screen-reader description of the trace. Required — the flatline must be sayable. */
  ariaSummary: string;
}

const PAD = { top: 10, right: 8, bottom: 10, left: 8 };

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
  cursor,
  onSeek,
  height = 112,
  ariaSummary,
}: VitalsTraceProps) {
  const ref = useRef<SVGSVGElement>(null);
  const n = actual.length;
  const W = 1000;
  const H = height;

  const geom = useMemo(() => {
    const max = Math.max(
      1,
      ...Array.from(actual),
      ...Array.from(expected),
      ...(band ? Array.from(band.hi) : []),
    );
    const x = (i: number) => PAD.left + ((W - PAD.left - PAD.right) * i) / Math.max(1, n - 1);
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

    return { x, y, runs, path, bandPath, deficitRuns, deficitArea, missing };
  }, [actual, expected, band, gaps, n, H]);

  const seek = (e: MouseEvent<SVGSVGElement>) => {
    if (!onSeek || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const t = (e.clientX - box.left) / box.width;
    onSeek(Math.max(0, Math.min(n, t * n)));
  };

  const gridCols = 24;

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
      {/* chart-paper, not a data grid */}
      {Array.from({ length: gridCols + 1 }, (_, i) => {
        const gx = PAD.left + ((W - PAD.left - PAD.right) * i) / gridCols;
        return (
          <line
            key={i}
            className={i % 6 === 0 ? 'pp-trace__grid pp-trace__grid--major' : 'pp-trace__grid'}
            x1={gx}
            x2={gx}
            y1={0}
            y2={H}
          />
        );
      })}

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

      {cursor !== undefined && (
        <>
          <line className="pp-trace__cursor" x1={geom.x(cursor)} x2={geom.x(cursor)} y1={0} y2={H} />
          {!geom.missing.has(Math.floor(cursor)) && (
            <circle
              className="pp-trace__dot"
              cx={geom.x(cursor)}
              cy={geom.y(actual[Math.min(n - 1, Math.floor(cursor))])}
              r={3}
            />
          )}
        </>
      )}
    </svg>
  );
}
