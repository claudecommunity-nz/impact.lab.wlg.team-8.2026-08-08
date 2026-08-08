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
import { TABS, tabOf, type Route } from './route';

/** "Thu 6 Aug 09:00". en-NZ puts a comma after the weekday; strip it — this
 *  sits in a mono flag beside two more mono fields and the comma reads as a
 *  separator between them rather than part of the date. */
const stamp = (iso: string, hour: number): string =>
  `${new Date(`${iso}T00:00:00`)
    .toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '')} ${String(hour).padStart(2, '0')}:00`;

export function TopBar({ route, onOpenExplainer }: { route: Route; onOpenExplainer: () => void }) {
  const { date, hour, dayOffset } = useAppState();
  const { week } = useData();
  const active = tabOf(route);

  // On the WEEK tab the stamp is the week cursor. On replay and streets it is
  // the day artefact those screens are actually drawing: the streets table is
  // always the newest confirmed day, so a chrome stamp reading "Sat 8 Aug" over
  // a Thursday table was the chrome asserting a date the screen does not have.
  const cursorDate = route === 'week' ? (week?.days[dayOffset]?.date ?? date) : date;

  return (
    <header className="pp-bar">
      <span className="pp-bar__mark">Pōneke Pulse</span>

      <nav className="pp-bar__tabs" aria-label="Views">
        {TABS.map((t) => (
          <a
            key={t.tab}
            className="pp-bar__tab pp-t-label"
            href={t.href}
            data-active={t.tab === active}
            aria-current={t.tab === active ? 'page' : undefined}
            title={`${t.label} (${t.key})`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      <span className="pp-bar__flag pp-t-mono-sm">
        <span className="pp-bar__role">
          {route === 'replay' ? 'REPLAY' : 'DUTY OFFICER BRIEF'}
        </span>
        <span className="pp-bar__sep" aria-hidden="true">
          ·
        </span>
        {stamp(cursorDate, hour)}
        <span className="pp-bar__sep" aria-hidden="true">
          ·
        </span>
        <strong>NOT LIVE</strong>
        <span className="pp-bar__sep" aria-hidden="true">
          ·
        </span>
        T+1 FEED
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
