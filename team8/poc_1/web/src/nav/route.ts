/**
 * Three screens does not justify a router.
 *
 * `gallery` is deliberately NOT a tab. It renders synthetic numbers to prove no
 * component reaches past a custom property, and a judge clicking it mid-demo
 * would be looking at fabricated data. It stays reachable only from the
 * provenance footer.
 */

import { useEffect, useState } from 'react';

export type Route = 'map' | 'streets' | 'gallery';
/** The two routes that are actually tabs. */
export type Tab = 'map' | 'streets';

export const TABS: ReadonlyArray<{ tab: Tab; label: string; href: string; key: string }> = [
  { tab: 'map', label: 'Map', href: '#/', key: 'M' },
  { tab: 'streets', label: 'Streets', href: '#/streets', key: 'S' },
];

export function parseRoute(hash: string): Route {
  if (hash.startsWith('#/gallery')) return 'gallery';
  if (hash.startsWith('#/streets')) return 'streets';
  return 'map';
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parseRoute(hash);
}

/** Sets the hash rather than lifting a piece of state, so browser back works
 *  and the keyboard shortcut is a shortcut for a real link. */
export function goToTab(tab: Tab): void {
  window.location.hash = tab === 'streets' ? '#/streets' : '#/';
}
