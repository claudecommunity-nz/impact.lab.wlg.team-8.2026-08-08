/**
 * Plain React. The whole app state is one small reducer plus a hover value,
 * and the only problem a store would solve — context re-render fanout — is
 * solved by splitting into two contexts. That is one file, not one dependency.
 *
 * Deliberately NOT in React state: the pulse phase and the deck.gl view state.
 * Both live in refs inside MapCanvas. A 60 Hz float in useState is how you
 * lose the frame budget.
 */

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { IsoDate, LayerId, ModeFilter } from '../data/types';

export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;
export const HOURS_PER_WEEK = HOURS_PER_DAY * DAYS_PER_WEEK; // 168

/** Watchable in a four-minute demo. Configurable from the time bar. */
export const SPEEDS = [8, 12, 20, 40] as const;
export type SecondsPerDay = (typeof SPEEDS)[number];

/**
 * How much of the feed the bottom chart draws: all 168 hours, or the 24 of the
 * day the cursor is on.
 *
 * It is a WINDOW, not a second cursor. The cursor stays `weekHour` in both, and
 * the day shown in DAY scope is derived from it — a separate "selected day"
 * field is exactly how the Week and Streets tabs ended up disagreeing about
 * what "now" was. A calendar chip already moves `weekHour`, so it moves the
 * day view for free.
 */
export type Scope = 'week' | 'day';

/**
 * The cursor is ONE number: hour-of-week, 0..167. It was hour-of-day, and the
 * week view needs a day too — but storing both is how a day chip and a scrubber
 * end up disagreeing about what "now" is. Day offset and hour-of-day are
 * DERIVED (see AppView), so every consumer that still says `hour` keeps working
 * and there is nothing to keep in sync.
 */
export interface AppState {
  date: IsoDate;
  weekHour: number; // integer 0..167
  playing: boolean;
  secondsPerDay: SecondsPerDay;
  scrubbing: boolean;
  scope: Scope;
  ghost: boolean;
  showCoverage: boolean;
  mode: ModeFilter;
  layers: Record<LayerId, boolean>;
}

/** What the map layers and the replay tab still think in: hour-of-day plus the
 *  day the cursor is sitting on. Never stored — always recomputed. */
export interface AppView extends AppState {
  /** 0..23. The map's typed arrays are indexed [i * 24 + hour]. */
  hour: number;
  /** 0..6, Monday-anchored — which day chip is lit. */
  dayOffset: number;
}

export type Action =
  /** Hour-of-day 0..23 within the day the cursor is already on. */
  | { type: 'SEEK'; hour: number }
  /** Hour-of-week 0..167 — the week scrubber and the week chart. */
  | { type: 'SEEK_WEEK'; index: number }
  /** Day chip: move to day 0..6, keeping the hour of day. */
  | { type: 'SET_WEEK_DAY'; offset: number }
  | { type: 'TICK' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'SET_SPEED'; secondsPerDay: SecondsPerDay }
  | { type: 'SCRUB_START' }
  | { type: 'SCRUB_END' }
  /** Week chart window — 168 hours or the cursor's own 24. */
  | { type: 'SET_SCOPE'; scope: Scope }
  | { type: 'SET_DATE'; date: IsoDate }
  | { type: 'SET_GHOST'; on: boolean }
  | { type: 'SET_COVERAGE'; on: boolean }
  | { type: 'SET_MODE'; mode: ModeFilter }
  | { type: 'TOGGLE_LAYER'; id: LayerId; on: boolean };

export const initialAppState: AppState = {
  // The landing view is the week, and the week's newest confirmed day is
  // Thu 6 Aug — the same day the per-countline artefact exists for, so the
  // calendar chip, the map and the chart all open on the same fact.
  date: '2026-08-06',
  weekHour: 3 * HOURS_PER_DAY + 9, // Thu 09:00 — the duty officer's morning
  playing: false,
  secondsPerDay: 12,
  scrubbing: false,
  // Opens on the week: the whole point of the landing view is the forecast band
  // running past the horizon, which needs the seven days to be legible.
  scope: 'week',
  ghost: true,
  showCoverage: false,
  mode: 'all',
  layers: {
    ghost: true,
    // Off by default. The map's default state has to be a measurement: with the
    // diagnosis on, 23 Oct at noon and 16 Oct at noon have the same skyline in
    // different colours, because the silhouette is the expectation. Off, the
    // solids fill ~90% of the case on 16 Oct and 30–40% on 23 Oct and the
    // collapse needs nothing explained. The inference is one pill away.
    diagnosis: false,
    coverage: false,
    hubs: false,
    tsunami: false,
    routes: false,
    closures: false,
  },
};

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SEEK':
      return { ...state, weekHour: dayStart(state.weekHour) + clampHour(action.hour) };
    case 'SEEK_WEEK':
      return { ...state, weekHour: clampWeekHour(action.index) };
    case 'SET_WEEK_DAY':
      return {
        ...state,
        weekHour:
          clampDay(action.offset) * HOURS_PER_DAY + (state.weekHour % HOURS_PER_DAY),
      };
    // Playback loops the DAY, not the week: the speed control is "24h in 12s"
    // and a scrubber that silently walks into Sunday mid-sentence is worse
    // television than one that repeats.
    case 'TICK':
      return {
        ...state,
        weekHour: dayStart(state.weekHour) + ((state.weekHour + 1) % HOURS_PER_DAY),
      };
    case 'PLAY':
      return { ...state, playing: true };
    case 'PAUSE':
      return { ...state, playing: false };
    case 'TOGGLE_PLAY':
      return { ...state, playing: !state.playing };
    case 'SET_SPEED':
      return { ...state, secondsPerDay: action.secondsPerDay };
    case 'SCRUB_START':
      return { ...state, scrubbing: true, playing: false };
    case 'SCRUB_END':
      return { ...state, scrubbing: false };
    case 'SET_SCOPE':
      // Deliberately does NOT move the cursor. Switching window must not change
      // what hour the rest of the product is showing.
      return { ...state, scope: action.scope };
    case 'SET_DATE':
      return { ...state, date: action.date };
    case 'SET_GHOST':
      return { ...state, ghost: action.on, layers: { ...state.layers, ghost: action.on } };
    case 'SET_COVERAGE':
      return { ...state, showCoverage: action.on, layers: { ...state.layers, coverage: action.on } };
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'TOGGLE_LAYER':
      return { ...state, layers: { ...state.layers, [action.id]: action.on } };
    default:
      return state;
  }
}

const clampHour = (h: number) => Math.max(0, Math.min(HOURS_PER_DAY - 1, Math.round(h)));
const clampDay = (d: number) => Math.max(0, Math.min(DAYS_PER_WEEK - 1, Math.round(d)));
const clampWeekHour = (h: number) => Math.max(0, Math.min(HOURS_PER_WEEK - 1, Math.round(h)));
const dayStart = (weekHour: number) => weekHour - (weekHour % HOURS_PER_DAY);

const AppStateContext = createContext<AppView | null>(null);
const AppDispatchContext = createContext<Dispatch<Action> | null>(null);

export interface SelectionValue {
  hovered: number | null; // ci
  selected: number | null; // ci
  setHovered: (ci: number | null) => void;
  setSelected: (ci: number | null) => void;
}
const SelectionContext = createContext<SelectionValue | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  // Derived, memoised on the reducer's identity: consumers that only ever knew
  // about `hour` never learn that the cursor grew a week around it.
  const view = useMemo<AppView>(
    () => ({
      ...state,
      hour: state.weekHour % HOURS_PER_DAY,
      dayOffset: Math.floor(state.weekHour / HOURS_PER_DAY),
    }),
    [state],
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const selection = useMemo<SelectionValue>(
    () => ({ hovered, selected, setHovered, setSelected }),
    [hovered, selected],
  );

  return (
    <AppStateContext.Provider value={view}>
      <AppDispatchContext.Provider value={dispatch}>
        <SelectionContext.Provider value={selection}>{children}</SelectionContext.Provider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppView {
  const v = useContext(AppStateContext);
  if (!v) throw new Error('useAppState outside <AppProviders>');
  return v;
}

export function useDispatch(): Dispatch<Action> {
  const v = useContext(AppDispatchContext);
  if (!v) throw new Error('useDispatch outside <AppProviders>');
  return v;
}

export function useSelection(): SelectionValue {
  const v = useContext(SelectionContext);
  if (!v) throw new Error('useSelection outside <AppProviders>');
  return v;
}
