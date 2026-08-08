/**
 * Band B, third group — what the bottom chart draws: the whole week, or the 24
 * hours of the day the cursor is sitting on.
 *
 * Two pills, not a select: it sits beside the mode pills and has to read as the
 * same kind of control at a glance. It reuses `.pp-pills` / `.pp-pill` for
 * exactly that reason — a second pill vocabulary in the same 60px strip is how
 * a toolbar stops looking like one toolbar.
 *
 * It changes the WINDOW and never the cursor. The day shown is derived from
 * `weekHour`, so a calendar chip moves it and nothing here has to be kept in
 * sync with anything there.
 */

import { Button } from '../ui';
import { useAppState, useDispatch, type Scope } from '../state/app';

const PILLS: ReadonlyArray<{ scope: Scope; label: string; title: string }> = [
  { scope: 'day', label: 'Day', title: 'Chart the 24 hours of the selected day' },
  { scope: 'week', label: 'Week', title: 'Chart all 168 hours of the week' },
];

export function ScopeToggle() {
  const { scope } = useAppState();
  const dispatch = useDispatch();

  return (
    <div className="pp-cal__scope">
      {/* Without the word, two pills reading "Day  Week" next to
          "All People Vehicles" look like two more mode filters. */}
      <span className="pp-t-label pp-cal__scope-label">chart</span>
      <div className="pp-pills" role="group" aria-label="Chart window">
        {PILLS.map((p) => (
          <Button
            key={p.scope}
            variant="chip"
            className="pp-pill"
            data-active={scope === p.scope}
            aria-pressed={scope === p.scope}
            title={p.title}
            onClick={() => dispatch({ type: 'SET_SCOPE', scope: p.scope })}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
