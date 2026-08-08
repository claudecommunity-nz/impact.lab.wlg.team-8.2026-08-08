/**
 * Loads the feed layer once, outside the main DataProvider.
 *
 * Deliberately not folded into the provider: the feeds are the MODULAR half of
 * the product, and the whole claim is that a source can be added or lost
 * without the instrument changing. A feed that 404s must not take the week view
 * down with it, so a failure here resolves to `null` and every consumer already
 * handles the null case — the same way it handles a feed that returns nothing.
 */

import { useEffect, useState } from 'react';
import { loadJson } from '../../data/load';
import type { AreaRiskFile, FeedBundle, FeedFile, FeedIndex } from './types';

export function useFeeds(): FeedBundle | null {
  const [bundle, setBundle] = useState<FeedBundle | null>(null);

  useEffect(() => {
    let live = true;
    loadJson<FeedIndex>('feeds/index.json')
      .then(async (index) => {
        const [feeds, areaRisk] = await Promise.all([
          Promise.all(index.advisement_feeds.map((f) => loadJson<FeedFile>(f.file))),
          loadJson<AreaRiskFile>(index.area_risk_file),
        ]);
        if (live) setBundle({ index, feeds, areaRisk });
      })
      .catch(() => {
        // Swallowed on purpose. The console stays clean, the week view keeps
        // working, and the absence shows up where it belongs: WatchFeed says
        // "nothing scheduled" and the roster is simply not rendered.
      });
    return () => {
      live = false;
    };
  }, []);

  return bundle;
}
