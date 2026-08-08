/**
 * The sources behind "What to watch", including the ones that said nothing.
 *
 * This exists because of a single rule: a feed that returns nothing must say
 * why. "No cruise berthings this week" and "we never connected the cruise
 * schedule" are completely different facts to a duty officer, and an empty
 * watch list conflates them.
 *
 * DRAWN AS BRICKS, NOT PROSE. Each adapter was a heading with a paragraph under
 * it, which read as an apology and ate a third of the left rail. A grid of tiles
 * with a status chip reads as what these actually are — plug-in adapters, one
 * shape each, two of them currently returning nothing and the page unbothered by
 * that. The reason a feed is silent moves behind its (i): still one click from
 * the claim, no longer competing with it.
 */

import { InfoBadge, Panel } from '../../ui';
import type { AdvisementFeed } from './types';

export interface FeedRosterProps {
  feeds: AdvisementFeed[];
  note?: string;
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'connected',
  'hand-entered': 'hand-entered',
  stub: 'not connected',
};

export function FeedRoster({ feeds, note }: FeedRosterProps) {
  if (feeds.length === 0) return null;
  const connected = feeds.filter((f) => f.status === 'connected').length;
  const items = feeds.reduce((n, f) => n + f.items, 0);

  return (
    <Panel
      title="Feeds behind this week"
      subtitle={`${feeds.length} adapters · ${connected} connected · ${items} items`}
      collapsible
      defaultOpen={false}
    >
      {/* NB not in Panel's `actions`: a collapsible Panel's header IS a button,
          and a button inside a button is invalid HTML that React refuses to
          hydrate. */}
      {note && (
        <p className="pp-roster__note pp-t-caption pp-c-muted">
          How the feed layer works
          <InfoBadge label="How the feed layer works" width={300}>
            {note}
          </InfoBadge>
        </p>
      )}
      <ul className="pp-bricks">
        {feeds.map((f) => (
          <li className="pp-brick" key={f.id} data-status={f.status}>
            <span className="pp-brick__name pp-t-caption">{f.name}</span>
            <span className="pp-brick__foot">
              <span className="pp-brick__tag pp-t-mono-sm" data-status={f.status}>
                {STATUS_LABEL[f.status] ?? f.status}
              </span>
              <span className="pp-t-mono-sm pp-c-muted">{f.items}</span>
              {/* When the count is zero the reason IS the payload, so it must
                  stay reachable — but it is a sentence, not a headline. */}
              <InfoBadge label={`Why ${f.name} reports what it does`}>
                {f.empty_reason ?? f.provenance}
              </InfoBadge>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
