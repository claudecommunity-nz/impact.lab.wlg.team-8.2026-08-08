/**
 * Band B, third group. Was a 661px card in the right rail.
 *
 * The three layers anyone touches in a demo are inline chips. The four context
 * GIS layers are behind a popover because they are reference geography that is
 * never scored, and their hints — particularly the closures one, which says out
 * loud that these are NOT the closures in force on the replay date — are
 * load-bearing honesty text that had to survive the compaction intact.
 *
 * PaletteSwitcher is gone from the product chrome entirely. It is a design
 * tool; it lives at #/gallery, which renders every palette side by side.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Toggle } from '../ui';
import { useAppState, useDispatch } from '../state/app';
import { useData } from '../data/DataProvider';
import type { LayerId } from '../data/types';

const CONTEXT_LAYERS: ReadonlyArray<{ id: LayerId; label: string; hint: string }> = [
  { id: 'hubs', label: 'Community emergency hubs', hint: 'WCC · 36 hubs' },
  { id: 'routes', label: 'Emergency routes', hint: 'WCC · 429 segments' },
  { id: 'tsunami', label: 'Tsunami evacuation zones', hint: 'WREMO / GWRC · hazard planning only' },
  {
    id: 'closures',
    label: 'Street-event road closures',
    hint: 'A current snapshot of scheduled street-event closures. These are NOT the closures in force on the replay date — they are shown as reference geography only.',
  },
];

export function LayerPills() {
  const { ghost, showCoverage, layers } = useAppState();
  const dispatch = useDispatch();
  const { model } = useData();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const on = CONTEXT_LAYERS.filter((l) => layers[l.id]).length;

  return (
    <div className="pp-pills" ref={wrap} role="group" aria-label="Layers">
      <Button
        variant="chip"
        className="pp-pill"
        data-active={ghost}
        aria-pressed={ghost}
        title="The city as it should have been, drawn beneath what actually happened. The gap is the emergency."
        onClick={() => dispatch({ type: 'SET_GHOST', on: !ghost })}
      >
        Ghost <span className="pp-pill__key">G</span>
      </Button>

      <Button
        variant="chip"
        className="pp-pill"
        data-active={layers.diagnosis}
        aria-pressed={layers.diagnosis}
        disabled={model?.refused ?? false}
        title={
          model?.refused
            ? 'Nothing is typed on a day we declined to assess.'
            : 'A ring around marks with a named cause. Never the fill — the ramp owns that.'
        }
        onClick={() => dispatch({ type: 'TOGGLE_LAYER', id: 'diagnosis', on: !layers.diagnosis })}
      >
        Diagnosis
      </Button>

      <Button
        variant="chip"
        className="pp-pill"
        data-active={showCoverage}
        aria-pressed={showCoverage}
        title="Rings mark sensors that delivered nothing this hour; dots mark sensors we can see but cannot score."
        onClick={() => dispatch({ type: 'SET_COVERAGE', on: !showCoverage })}
      >
        Blind spots
      </Button>

      <div className="pp-pop">
        <Button
          variant="chip"
          className="pp-pill"
          data-active={on > 0}
          aria-expanded={open}
          title="Hazard and reference geography. Never scored."
          onClick={() => setOpen((v) => !v)}
        >
          Context{on > 0 ? ` (${on})` : ''} <span aria-hidden="true">▾</span>
        </Button>
        {open && (
          <div className="pp-pop__panel">
            <p className="pp-t-label pp-c-secondary">Reference geography, never scored</p>
            {CONTEXT_LAYERS.map((l) => (
              <Toggle
                key={l.id}
                label={l.label}
                checked={layers[l.id]}
                onChange={(v) => dispatch({ type: 'TOGGLE_LAYER', id: l.id, on: v })}
                hint={l.hint}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
