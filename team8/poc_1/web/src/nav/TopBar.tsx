/**
 * Band A — the identity bar. Opaque, full width, and the only place in the
 * product where the institutional accent fills a surface rather than drawing a
 * hairline.
 *
 * The not-live flag lives HERE, not in a card, because this bar survives
 * presentation mode (P), survives a screenshot, and cannot scroll away. It is
 * the first tier of the three the honesty statements are spread across.
 */

import { Button } from '../ui';
import { useData } from '../data/DataProvider';
import { useAppState } from '../state/app';
import { TABS, type Tab } from './route';

/** "Thu 23 Oct 2025". en-NZ puts a comma after the weekday; strip it — this
 *  sits in a mono flag beside two more mono fields and the comma reads as a
 *  separator between them rather than part of the date. */
const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`)
    .toLocaleDateString('en-NZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    .replace(',', '');

export function TopBar({ tab, onOpenExplainer }: { tab: Tab; onOpenExplainer: () => void }) {
  const { date } = useAppState();
  const { manifest } = useData();
  const day = manifest?.days.find((d) => d.date === date);

  return (
    <header className="pp-bar">
      <span className="pp-bar__mark">Pōneke Pulse</span>

      <nav className="pp-bar__tabs" aria-label="Views">
        {TABS.map((t) => (
          <a
            key={t.tab}
            className="pp-bar__tab pp-t-label"
            href={t.href}
            data-active={t.tab === tab}
            aria-current={t.tab === tab ? 'page' : undefined}
            title={`${t.label} (${t.key})`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      <span className="pp-bar__flag pp-t-mono-sm" title={day?.label}>
        {shortDate(date)}
        <span className="pp-bar__sep" aria-hidden="true">
          ·
        </span>
        <strong>NOT LIVE</strong>
        <span className="pp-bar__sep" aria-hidden="true">
          ·
        </span>
        T+1
      </span>

      <Button
        variant="ghost"
        icon
        className="pp-bar__help"
        aria-label="What is this?"
        title="What is this?"
        onClick={onOpenExplainer}
      >
        ?
      </Button>
    </header>
  );
}
