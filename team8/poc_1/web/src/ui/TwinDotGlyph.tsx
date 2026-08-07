import { cssColor } from '../theme/color';
import type { DotState } from '../copy/strings';

/**
 * The colour-independent half of the diagnosis encoding, and the half that
 * does the real work: two dots, left = pedestrian, right = vehicle.
 *   filled = mode held up · hollow ring = mode collapsed · struck = not viable.
 * "Cannot type" is therefore two struck dots and needs no colour at all.
 */
export function TwinDotGlyph({
  pedestrian,
  vehicle,
  size = 14,
  title,
}: {
  pedestrian: DotState;
  vehicle: DotState;
  size?: number;
  title?: string;
}) {
  const h = size;
  const w = size * 1.8;
  return (
    <svg width={w} height={h} viewBox="0 0 18 10" role="img" aria-label={title ?? glyphAlt(pedestrian, vehicle)}>
      {title && <title>{title}</title>}
      <Dot cx={5} state={pedestrian} />
      <Dot cx={13} state={vehicle} />
    </svg>
  );
}

function Dot({ cx, state }: { cx: number; state: DotState }) {
  const stroke = cssColor('text-primary', 0.85);
  if (state === 'filled') return <circle cx={cx} cy={5} r={3} fill={stroke} />;
  return (
    <>
      <circle cx={cx} cy={5} r={2.6} fill="none" stroke={stroke} strokeWidth={1.2} />
      {state === 'struck' && (
        <line x1={cx - 4} y1={9} x2={cx + 4} y2={1} stroke={stroke} strokeWidth={1.2} />
      )}
    </>
  );
}

const word = (s: DotState) => (s === 'filled' ? 'held up' : s === 'hollow' ? 'collapsed' : 'not viable');

export const glyphAlt = (p: DotState, v: DotState) =>
  `pedestrians ${word(p)}, vehicles ${word(v)}`;
