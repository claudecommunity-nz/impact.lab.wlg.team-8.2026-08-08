import { useEffect, useRef, useState } from 'react';
import { AppProviders, useAppState, useDispatch, useSelection } from './state/app';
import { DataProvider, useData } from './data/DataProvider';
import { MapCanvas } from './map/MapCanvas';
import { StreetsView } from './streets/StreetsView';
import { TopBar } from './nav/TopBar';
import { ControlBar } from './nav/ControlBar';
import { goToTab, TABS, type Tab } from './nav/route';
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

/**
 * The tab switch lives in Layout, INSIDE the providers, and that placement is
 * the whole design. Branching in App.tsx would remount AppProviders and reset
 * date, hour, playback and selection to initialAppState on every tab click.
 * Here the tab is a subtree swap: playback keeps running while you switch, and
 * clicking a Streets row then pressing M lands you on the map with that
 * countline already selected.
 */
export function Shell({ tab }: { tab: Tab }) {
  return (
    <AppProviders>
      <DataProvider>
        <Layout tab={tab} />
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
 *   ← →        ±1 hour
 *   1–5        jump to replay day
 *   G          ghost overlay
 *   M S        Map / Streets
 *   P          presentation mode (rails only — Streets has none)
 *   Esc        clear selection
 */
function useDemoKeys(onStage: () => void, modalOpen: boolean) {
  const { hour, playing, ghost } = useAppState();
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
        case 'ArrowLeft':
          e.preventDefault();
          dispatch({ type: 'SEEK', hour: (hour + 23) % 24 });
          return;
        case 'ArrowRight':
          e.preventDefault();
          dispatch({ type: 'SEEK', hour: (hour + 1) % 24 });
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
          goToTab(tab.tab);
          return;
        }
      }

      // Digits stay owned by the replay days; never overload 1–5.
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= days.length) {
        dispatch({ type: 'SET_DATE', date: days[n - 1].date });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hour, playing, ghost, manifest, dispatch, onStage, setSelected, modalOpen]);
}

function Layout({ tab }: { tab: Tab }) {
  const { error } = useData();
  const { date } = useAppState();
  const { selected } = useSelection();
  const [stage, setStage] = useState(false);
  const landing = useLanding();
  const leftRail = useRef<HTMLElement>(null);
  const rightRail = useRef<HTMLElement>(null);

  useDemoKeys(() => setStage((s) => !s), landing.open);

  // Changing the day — or the tab — changes what the cards are saying; leaving
  // them half-scrolled hides the headline the new day just produced.
  useEffect(() => {
    leftRail.current?.scrollTo({ top: 0 });
    rightRail.current?.scrollTo({ top: 0 });
  }, [date, tab]);

  return (
    <div className={`pp-shell${stage ? ' pp-shell--stage' : ''}`} data-tab={tab}>
      <TopBar tab={tab} onOpenExplainer={landing.reopen} />
      <ControlBar />

      {error ? (
        <main className="pp-shell__stage">
          <div className="pp-slot pp-t-caption">Could not load the artefacts: {error}</div>
        </main>
      ) : tab === 'streets' ? (
        <main className="pp-shell__stage pp-shell__stage--table">
          <StreetsView />
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
        {tab === 'map' && <VitalsStrip />}
        <TimeBar />
      </div>

      {/* Promoted out of the bottom bar so it renders on BOTH tabs. */}
      <div className="pp-shell__footer">
        <ProvenanceFooter onOpenExplainer={landing.reopen} />
      </div>

      <LandingModal open={landing.open} onClose={landing.close} />
    </div>
  );
}
