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

/** Watchable in a four-minute demo. Configurable from the time bar. */
export const SPEEDS = [8, 12, 20, 40] as const;
export type SecondsPerDay = (typeof SPEEDS)[number];

export interface AppState {
  date: IsoDate;
  hour: number; // integer 0..23 — the only value React ever sees
  playing: boolean;
  secondsPerDay: SecondsPerDay;
  scrubbing: boolean;
  ghost: boolean;
  showCoverage: boolean;
  mode: ModeFilter;
  layers: Record<LayerId, boolean>;
}

export type Action =
  | { type: 'SEEK'; hour: number }
  | { type: 'TICK' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'SET_SPEED'; secondsPerDay: SecondsPerDay }
  | { type: 'SCRUB_START' }
  | { type: 'SCRUB_END' }
  | { type: 'SET_DATE'; date: IsoDate }
  | { type: 'SET_GHOST'; on: boolean }
  | { type: 'SET_COVERAGE'; on: boolean }
  | { type: 'SET_MODE'; mode: ModeFilter }
  | { type: 'TOGGLE_LAYER'; id: LayerId; on: boolean };

export const initialAppState: AppState = {
  date: '2025-10-23',
  hour: 6,
  playing: false,
  secondsPerDay: 12,
  scrubbing: false,
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
      return { ...state, hour: clampHour(action.hour) };
    case 'TICK':
      return { ...state, hour: (state.hour + 1) % HOURS_PER_DAY };
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
    case 'SET_DATE':
      return { ...state, date: action.date, hour: state.hour };
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

const AppStateContext = createContext<AppState | null>(null);
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
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const selection = useMemo<SelectionValue>(
    () => ({ hovered, selected, setHovered, setSelected }),
    [hovered, selected],
  );

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <SelectionContext.Provider value={selection}>{children}</SelectionContext.Provider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
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
