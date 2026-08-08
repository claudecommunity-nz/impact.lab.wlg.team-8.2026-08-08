/**
 * One provider above the shell. Loads the static index once, then the per-day
 * artefacts on date change. The fetch cache in load.ts makes a second visit to
 * a date instant, which is what makes the demo's date-flipping watchable.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppState } from '../state/app';
import { buildDayModel, type DayModel } from './derive';
import {
  loadContext,
  loadCountlines,
  loadDay,
  loadEdges,
  loadManifest,
  loadVitals,
  loadWeek,
} from './load';
import type {
  ContextFile,
  CountlineIndex,
  EdgesFile,
  Manifest,
  VitalsFile,
  WeekFile,
} from './types';

export interface DataValue {
  manifest: Manifest | null;
  index: CountlineIndex | null;
  model: DayModel | null;
  context: ContextFile | null;
  vitals: VitalsFile | null;
  /** Week-scoped, loaded once. Every consumer of the week cursor reads these. */
  week: WeekFile | null;
  edges: EdgesFile | null;
  error: string | null;
  loading: boolean;
}

const DataContext = createContext<DataValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { date } = useAppState();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [index, setIndex] = useState<CountlineIndex | null>(null);
  const [model, setModel] = useState<DayModel | null>(null);
  const [context, setContext] = useState<ContextFile | null>(null);
  const [vitals, setVitals] = useState<VitalsFile | null>(null);
  const [week, setWeek] = useState<WeekFile | null>(null);
  const [edges, setEdges] = useState<EdgesFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([loadManifest(), loadCountlines(), loadWeek(), loadEdges()])
      .then(([m, i, w, e]) => {
        if (!live) return;
        setManifest(m);
        setIndex(i);
        setWeek(w);
        setEdges(e);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!index || !manifest) return;
    let live = true;
    setLoading(true);
    const window = manifest.vitals.find((v) => date >= v.start && date <= v.end) ?? manifest.vitals[0];
    Promise.all([loadDay(date), loadContext(date).catch(() => null), loadVitals(window.file)])
      .then(([day, ctx, vit]) => {
        if (!live) return;
        setModel(buildDayModel(day, index));
        setContext(ctx);
        setVitals(vit);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [date, index, manifest]);

  const value = useMemo<DataValue>(
    () => ({ manifest, index, model, context, vitals, week, edges, error, loading }),
    [manifest, index, model, context, vitals, week, edges, error, loading],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataValue {
  const v = useContext(DataContext);
  if (!v) throw new Error('useData outside <DataProvider>');
  return v;
}
