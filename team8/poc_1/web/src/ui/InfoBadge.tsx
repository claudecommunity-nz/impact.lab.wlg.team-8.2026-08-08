import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small (i) that holds a sentence the primary UI should not be spending lines
 * on.
 *
 * This exists because the honesty copy was winning the layout fight. Every card
 * carried two or three lines of explanation — why a feed returned nothing, that
 * an edge's numbers are inferred rather than measured — and those sentences are
 * load-bearing, so they could not simply be cut. Behind an (i) they stay one
 * click from the number they qualify, and the card goes back to being readable.
 *
 * POSITIONED FIXED, DELIBERATELY. The Context popover in the nav spent this
 * whole build invisible because its ancestor had `overflow-x: auto`, which CSS
 * promotes to `auto` on both axes, and a scroll container clips absolutely
 * positioned descendants no matter what their z-index says. Anchoring to the
 * viewport sidesteps every ancestor's overflow and stacking context. The cost is
 * that the panel does not follow a scroll, so it closes on scroll instead.
 *
 * PORTALLED TO document.body, and that is a correctness fix rather than tidying.
 * The popover is a <div>, and the badge is used inside running prose — the map
 * readout's caption, the feed roster's note, the standing-conditions note are
 * all <p>. A <div> inside a <p> is invalid HTML: the browser closes the
 * paragraph early and React logs "<p> cannot contain a nested <div>" on every
 * open. Three of those errors were live in the console at integration. A portal
 * puts the popover at the end of <body> where nothing can be nested wrongly,
 * costs nothing (it was already position: fixed, so its coordinates do not
 * depend on where in the tree it sits), and keeps React event bubbling — the
 * dismiss handlers below and the callers' stopPropagation still behave.
 */
export interface InfoBadgeProps {
  /** Accessible name — say what the explanation is ABOUT, not "more info". */
  label: string;
  children: ReactNode;
  /** Width of the popover in px. */
  width?: number;
}

export function InfoBadge({ label, children, width = 260 }: InfoBadgeProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    // Flip to the left, and above, when the badge sits near an edge — these live
    // in 380px rails hard against the viewport, so the naive placement is off
    // screen about half the time.
    const left = Math.min(Math.max(8, b.left), window.innerWidth - width - 8);
    const below = b.bottom + 8;
    setPos({ top: below, left });
  }, [width]);

  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: Event) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Fixed positioning cannot follow a scrolling ancestor, so dismiss instead
    // of drifting away from the thing being explained.
    const onScroll = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="pp-info"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            className="pp-info__pop"
            role="note"
            style={{ top: pos.top, left: pos.left, width }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
