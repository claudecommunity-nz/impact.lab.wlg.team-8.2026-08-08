/**
 * Right column, card 3 — the caveats that are true all week.
 *
 * These are the reasons a number above might be wrong. Also a feed: roadworks
 * come from the WCC closure layer, dark sensors and baseline-less sites are
 * derived from the movement feed itself.
 *
 * DRAWN AS BRICKS, NOT PROSE — the same tiles as the feed roster, for the same
 * reason. Four headings each trailing a two-sentence paragraph read as an
 * apology and ran ~380px in a 524px column, which is why this card ended up
 * collapsed by default in the first place. A tag chip plus the claim is what a
 * duty officer scans; the window it applies to, the working behind it and the
 * source all move behind the (i). Moved, never cut: every sentence that was on
 * the face is still one click from the claim it qualifies.
 */

import { InfoBadge, Panel } from '../ui';
import type { StandingCondition } from '../data/types';

export interface StandingConditionsProps {
  items: StandingCondition[];
  /** The one sentence that has to survive even if every row is quiet. */
  note?: string;
}

export function StandingConditions({ items, note }: StandingConditionsProps) {
  return (
    <Panel
      title="Standing conditions"
      subtitle={
        items.length === 0
          ? 'True for the whole week'
          : `${items.length} true for the whole week`
      }
      // Collapsed: third card in a 524px column, and open it pushed the edge
      // list off screen. The subtitle now carries the count, so the fact that
      // there ARE caveats survives without their rows.
      collapsible
      defaultOpen={false}
    >
      {/* NB not in Panel's `actions`: a collapsible Panel's header IS a button,
          and a button inside a button is invalid HTML that React refuses to
          hydrate. */}
      {note && (
        <p className="pp-roster__note pp-t-caption pp-c-muted">
          What these caveats do not cover
          <InfoBadge label="What standing conditions do not cover" width={300}>
            {note}
          </InfoBadge>
        </p>
      )}
      {items.length === 0 ? (
        <p className="pp-t-body pp-c-secondary">
          Nothing standing. That is a statement about the feeds we have connected, not about the
          city.
        </p>
      ) : (
        <ul className="pp-bricks pp-bricks--cond">
          {items.map((c, i) => (
            <li className="pp-brick" key={`${c.kind}-${i}`} data-kind={c.kind}>
              <span className="pp-brick__name pp-t-caption">{c.title}</span>
              <span className="pp-brick__foot">
                <span className="pp-brick__tag pp-t-mono-sm" data-kind={c.kind}>
                  {c.tag}
                </span>
                {/* The working is the payload. A condition with no reasoning
                    behind it is an assertion the reader cannot check, which is
                    the failure mode this whole card exists to argue against. */}
                <InfoBadge label={`Why: ${c.title}`} width={300}>
                  <span className="pp-cond__pop">
                    <span className="pp-cond__tag pp-t-mono-sm" data-kind={c.kind}>
                      {c.window}
                    </span>
                    {c.detail && <span>{c.detail}</span>}
                    {c.effect && <span>{c.effect}</span>}
                    {c.provenance && <span className="pp-c-muted">{c.provenance}</span>}
                  </span>
                </InfoBadge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
