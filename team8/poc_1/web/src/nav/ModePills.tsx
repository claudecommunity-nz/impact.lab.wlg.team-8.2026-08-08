/**
 * Band B, second group. New — it wires the SET_MODE action that had been in the
 * reducer with nothing dispatching it.
 *
 * Three pills over a five-value union. The whole finding is that pedestrians
 * fell about twice as hard as cars, so People and Vehicles are the cut that
 * carries it; a bus pill invites a question the coverage cannot answer. The
 * other three modes stay in state and in the selection card.
 *
 * Filtering HIDES non-viable marks and rows. It must never render them as zero
 * — that is the one thing this whole tool exists to refuse.
 */

import { Button } from '../ui';
import { useAppState, useDispatch } from '../state/app';
import type { ModeFilter } from '../data/types';

const PILLS: ReadonlyArray<{ mode: ModeFilter; label: string; title: string }> = [
  { mode: 'all', label: 'All', title: 'Every mode the sensors report' },
  { mode: 'pedestrian', label: 'People', title: 'Pedestrians only' },
  { mode: 'car', label: 'Vehicles', title: 'Cars — the largest vehicle class on this network' },
];

export function ModePills() {
  const { mode } = useAppState();
  const dispatch = useDispatch();

  return (
    <div className="pp-pills" role="group" aria-label="Mode">
      {PILLS.map((p) => (
        <Button
          key={p.mode}
          variant="chip"
          className="pp-pill"
          data-active={mode === p.mode}
          data-mode={p.mode}
          aria-pressed={mode === p.mode}
          title={p.title}
          onClick={() => dispatch({ type: 'SET_MODE', mode: p.mode })}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}
