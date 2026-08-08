import { useEffect, useRef, useState } from 'react';
import { AppProviders, useAppState, useDispatch, useSelection } from './state/app';
import { DataProvider, useData } from './data/DataProvider';
import { MapCanvas } from './map/MapCanvas';
import { StreetsView } from './streets/StreetsView';
import { AreasView } from './areas';
import { WeekView, WeekChart } from './week';
import { TopBar } from './nav/TopBar';
import { ControlBar } from './nav/ControlBar';
import { CalendarStrip } from './nav/CalendarStrip';
import { goToRoute, TABS, type Route } from './nav/route';
import { VitalsStrip } from './panels/VitalsStrip';
import { TimeBar } from './panels/TimeBar';
import { SituationPanel } from './panels/SituationPanel';
import { MoversPanel } from './panels/MoversPanel';
import { ConfidencePanel } from './panels/ConfidencePanel';
import { CorroborationPanel } from './panels/CorroborationPanel';
import { SelectionPanel } from './panels/SelectionPanel';
import { RefusalBanner } from './panels/RefusalBanner';
import { ProvenanceFooter } from './panels/ProvenanceFooter';
import { LandingModal, useLanding } from './panels/LandingModal';
import './shell.css';
import './nav/nav.css';
import './panels/panels.css';
import './week/week.css';

/**
 * The route switch lives in Layout, INSIDE the providers, and that placement is
 * the whole design. Branching in App.tsx would remount AppProviders and reset
 * the week cursor, playback and selection to initialAppState on every tab
 * click. Here the route is a subtree swap: the cursor keeps its hour while you
 * switch, and clicking a Streets row then pressing W lands you on the week with
 * that edge already selected.
 */
export function Shell({ route }: { route: Route }) {
  return (
    <AppProviders>
      <DataProvider>
        <Layout route={route} />
      </DataProvider>
    </AppProviders>
  );
}

/**
 * Demo ergonomics. Four minutes is not enough time to mouse to a control,
 * then to a day picker, then scroll a rail — each hop is a beat of dead air
 * and a chance to click the wrong thing.
 *
 *   space      play / pause
 *   ← →        ±1 hour along the week
 *   1–7        jump to a day of the week (replay tab: to a replay day)
 *   G          ghost overlay
 *   W S        Week / Streets
 *   P          presentation mode (rails only — Streets has none)
 *   Esc        clear selection
 */
function useDemoKeys(route: Route, onStage: () => void, modalOpen: boolean) {
  const { weekHour, playing, ghost } = useAppState();
  const dispatch = useDispatch();
  const { setSelected } = useSelection();
  const { manifest } = useData();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never steal a key from something the user is typing into.
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const days = manifest?.days ?? [];
      switch (e.key) {
        case ' ':
          e.preventDefault();
          dispatch({ type: playing ? 'PAUSE' : 'PLAY' });
          return;
        // The arrows walk the WEEK, clamped at its ends. They used to wrap
        // inside a day, which on a 168-hour cursor would have made Monday 00:00
        // and Monday 23:00 neighbours.
        case 'ArrowLeft':
          e.preventDefault();
          dispatch({ type: 'SEEK_WEEK', index: weekHour - 1 });
          return;
        case 'ArrowRight':
          e.preventDefault();
          dispatch({ type: 'SEEK_WEEK', index: weekHour + 1 });
          return;
        case 'Escape':
          setSelected(null);
          return;
        case 'g':
        case 'G':
          dispatch({ type: 'SET_GHOST', on: !ghost });
          return;
        case 'p':
        case 'P':
          onStage();
          return;
        default:
          break;
      }

      // Tab keys are suppressed while the explainer is up: the modal owns the
      // screen and switching underneath it looks like the app broke.
      if (!modalOpen) {
        const tab = TABS.find((t) => t.key === e.key.toUpperCase());
        if (tab) {
          goToRoute(tab.tab);
          return;
        }
      }

      // Digits mean "day". On the week that is a chip; on the replay tab it is
      // still a replay date, because that tab has no week to index into.
      const n = Number(e.key);
      if (!Number.isInteger(n)) return;
      if (route === 'replay') {
        if (n >= 1 && n <= days.length) dispatch({ type: 'SET_DATE', date: days[n - 1].date });
      } else if (n >= 1 && n <= 7) {
        dispatch({ type: 'SET_WEEK_DAY', offset: n - 1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [weekHour, playing, ghost, manifest, dispatch, onStage, setSelected, modalOpen, route]);
}

function Layout({ route }: { route: Route }) {
  const { error, week } = useData();
  const { date, dayOffset } = useAppState();
  const dispatch = useDispatch();
  const { selected } = useSelection();
  const [stage, setStage] = useState(false);
  const landing = useLanding();
  const leftRail = useRef<HTMLElement>(null);
  const rightRail = useRef<HTMLElement>(null);

  useDemoKeys(route, () => setStage((s) => !s), landing.open);

  /**
   * Hash routing changes the route and nothing else, so coming back from
   * #/replay left `date` on 23 Oct 2025 — outside the edge artefact's week.
   * MapCanvas then correctly refused to draw any flow layer on the one tab
   * where flow IS the product, and the only way out was clicking a day chip.
   * Reconcile on the way in: snap to the newest day that is both inside the
   * week and has a per-countline artefact behind it.
   */
  useEffect(() => {
    if (route === 'replay' || !week) return;
    if (date >= week.week_start && date <= week.week_end) return;
    dispatch({ type: 'SET_DATE', date: week.horizon.newest_data_date });
  }, [route, week, date, dispatch]);

  // Changing the day — or the route — changes what the cards are saying;
  // leaving them half-scrolled hides the headline the new day just produced.
  useEffect(() => {
    leftRail.current?.scrollTo({ top: 0 });
    rightRail.current?.scrollTo({ top: 0 });
  }, [date, dayOffset, route]);

  return (
    <div className={`pp-shell${stage ? ' pp-shell--stage' : ''}`} data-route={route}>
      <TopBar route={route} onOpenExplainer={landing.reopen} />
      {/* Band B is the calendar on the product tabs and the replay pills on the
          unlisted replay route — the two vocabularies never share a screen. */}
      {route === 'replay' ? <ControlBar /> : <CalendarStrip />}

      {error ? (
        <main className="pp-shell__stage">
          <div className="pp-slot pp-t-caption">Could not load the artefacts: {error}</div>
        </main>
      ) : route === 'streets' ? (
        <main className="pp-shell__stage pp-shell__stage--table">
          <StreetsView />
        </main>
      ) : route === 'areas' ? (
        <main className="pp-shell__stage pp-shell__stage--table">
          <AreasView />
        </main>
      ) : route === 'week' ? (
        <main className="pp-shell__stage pp-shell__stage--week">
          <WeekView />
        </main>
      ) : (
        <>
          <main className="pp-shell__stage">
            <MapCanvas />
            {/* The refusal is a designed screen over the instrument, not a
                toast in a card the judge has to scroll to find. */}
            <RefusalBanner />
          </main>

          <aside className="pp-float pp-shell__left" ref={leftRail}>
            <SituationPanel />
            <MoversPanel />
          </aside>

          {/* Selection-exclusive. Two cards never become three: pick something
              and Confidence + Corroboration unmount to give it the whole rail. */}
          <aside className="pp-float pp-shell__right" ref={rightRail}>
            {selected == null ? (
              <>
                <ConfidencePanel />
                <CorroborationPanel />
              </>
            ) : (
              <SelectionPanel />
            )}
          </aside>
        </>
      )}

      <div className="pp-shell__bottom">
        {route === 'replay' ? (
          <>
            <VitalsStrip />
            <TimeBar />
          </>
        ) : (
          // Streets gets the cursor row without the chart: every row in that
          // table already carries its own seven-day trace, and a citywide one
          // above it is context for a map.
          <WeekChart chart={route === 'week'} hourOnly={route === 'streets'} />
        )}
      </div>

      {/* Promoted out of the bottom bar so it renders on EVERY route. */}
      <div className="pp-shell__footer">
        <ProvenanceFooter onOpenExplainer={landing.reopen} />
      </div>

      <LandingModal open={landing.open} onClose={landing.close} />
    </div>
  );
}
