/**
 * Four screens does not justify a router.
 *
 * Two of them are tabs: WEEK (the duty officer's brief) and STREETS (every edge
 * ranked). The other two are deliberately NOT:
 *
 *   `replay`  the single-day storm replay of 23 Oct 2025. It is the evidence
 *             that the method works, not the product; giving it a tab put a
 *             historical incident on the same footing as this week's brief.
 *             Kept reachable so the demo can jump to it.
 *   `gallery` renders synthetic numbers to prove no component reaches past a
 *             custom property. A judge clicking it mid-demo would be looking
 *             at fabricated data.
 */

import { useEffect, useState } from 'react';

export type Route = 'week' | 'streets' | 'replay' | 'gallery';
/** The two routes that are actually tabs. */
export type Tab = 'week' | 'streets';

export const TABS: ReadonlyArray<{ tab: Tab; label: string; href: string; key: string }> = [
  { tab: 'week', label: 'Week', href: '#/', key: 'W' },
  { tab: 'streets', label: 'Streets', href: '#/streets', key: 'S' },
];

export function parseRoute(hash: string): Route {
  if (hash.startsWith('#/gallery')) return 'gallery';
  if (hash.startsWith('#/streets')) return 'streets';
  if (hash.startsWith('#/replay')) return 'replay';
  return 'week';
}

/** Which tab reads as current. On the unlisted routes: neither. */
export const tabOf = (route: Route): Tab | null =>
  route === 'week' || route === 'streets' ? route : null;

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parseRoute(hash);
}

const HREF: Record<Route, string> = {
  week: '#/',
  streets: '#/streets',
  replay: '#/replay',
  gallery: '#/gallery',
};

/** Sets the hash rather than lifting a piece of state, so browser back works
 *  and the keyboard shortcut is a shortcut for a real link. */
export function goToRoute(route: Route): void {
  window.location.hash = HREF[route];
}
