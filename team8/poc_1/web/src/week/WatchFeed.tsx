/**
 * Left column, card 2 — "What to watch this week".
 *
 * Known upcoming events are what a duty officer should EXPECT to move the
 * numbers, so this is the briefing half of the product. It renders a FEED and
 * nothing else: a stadium calendar, a MetService warning, a cruise-berth
 * schedule and the WCC street-closure layer all arrive in the same shape.
 *
 * Two rules the component enforces rather than trusts:
 *   - an empty feed says "nothing scheduled", never an empty box. An empty
 *     week means the sources we have are quiet, not that the week is.
 *   - `applied: false` is badged. Nothing invented may move a published number,
 *     so an item that did not drive the forecast has to say so on its face.
 */

import { InfoBadge, Panel } from '../ui';
import { signedPct } from '../copy/strings';
import type { Advisement } from '../data/types';

export interface WatchFeedProps {
  items: Advisement[];
  /** Where the feed came from and what its silence means. Always rendered. */
  note?: string;
}

/**
 * Anything with a quantified effect leads, biggest first; the rest fall back to
 * chronological.
 *
 * The list used to be source order, which put an overnight motorway off-ramp
 * closure on SUNDAY at the top of a card headed "this week". Chronological is
 * the floor a briefing has to clear, and the delta rule means the day a feed
 * does publish an effect size, that item leads without another code change.
 */
function briefingOrder(items: Advisement[]): Advisement[] {
  const mag = (a: Advisement) => (a.expected_delta_pct == null ? -1 : Math.abs(a.expected_delta_pct));
  return [...items].sort(
    (a, b) => mag(b) - mag(a) || (a.starts ?? '').localeCompare(b.starts ?? ''),
  );
}

export function WatchFeed({ items, note }: WatchFeedProps) {
  const ordered = briefingOrder(items);
  const quantified = items.filter((a) => a.expected_delta_pct != null).length;

  return (
    <Panel
      title="What to watch this week"
      // The subtitle used to promise "events that should move the numbers"
      // above a list where every expected delta rendered "—". It now says which
      // it is, because a promise the rows do not keep reads as filler.
      subtitle={
        quantified > 0
          ? `${items.length} scheduled · ${quantified} with an expected effect`
          : `${items.length} scheduled · no feed publishes an expected effect`
      }
      // Behind the (i), like the forecast and area-risk cards. As a footnote it
      // was a 76px bordered block in a 524px rail — and its headline claim,
      // that nothing here moved the forecast, is already on the face of every
      // row as an explicit "not applied" badge. So the fact survives on screen
      // and the paragraph explaining it is one click away. Header placement is
      // legal only because this Panel is not collapsible: its head is a <div>,
      // where a collapsible head is a <button> and would nest buttons.
      actions={
        note ? (
          <InfoBadge label="Where these items come from, and what they do not do" width={300}>
            {note}
          </InfoBadge>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="pp-watch__empty pp-t-body">
          <strong>Nothing scheduled.</strong> No connected feed has an event starting in this
          week — so every deviation below is unexplained, not expected.
        </p>
      ) : (
        <ul className="pp-watch">
          {ordered.map((a, i) => (
            // One column, not two. The when/body split forced a 74px gutter that
            // wrapped "Road Work · SH 2 — Ngauranga Southbound Off-Ramp" onto
            // four lines inside a 380px rail. A pill costs one line and buys the
            // title the full width.
            <li className="pp-watch__row" key={a.id ?? `${a.when}-${i}`}>
              <span className="pp-watch__head">
                <span className="pp-watch__pill pp-t-mono-sm">{a.when}</span>
                <span
                  className="pp-watch__delta pp-t-mono-sm"
                  data-dir={
                    a.expected_delta_pct == null ? 'none' : a.expected_delta_pct < 0 ? 'down' : 'up'
                  }
                >
                  {a.expected_delta_pct == null ? '—' : signedPct(a.expected_delta_pct)}
                </span>
              </span>
              <span className="pp-t-body pp-watch__title">{a.title}</span>
              {/* Agency copy runs to a paragraph. Two lines here, the rest one
                  click away — it is context, not the headline. */}
              {a.detail && (
                <span className="pp-watch__detail pp-t-caption pp-c-secondary">
                  {a.detail}
                  <InfoBadge label={`Full notice for ${a.title}`}>{a.detail}</InfoBadge>
                </span>
              )}
              <span className="pp-watch__tags pp-t-caption">
                <span className="pp-watch__tag" data-applied={a.applied}>
                  {a.applied ? 'applied to forecast' : 'not applied'}
                </span>
                {a.hand_entered && <span className="pp-watch__tag">hand-entered</span>}
                <span className="pp-c-muted">{a.source}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
