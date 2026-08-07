/**
 * Fetch + module-level cache. Switching dates is instant after first load.
 * Every URL goes through dataUrl() — never a bare '/data/...'.
 */

import type { FeatureCollection } from 'geojson';
import { dataUrl } from './dataUrl';
import type {
  ContextFile,
  CountlineIndex,
  DayFile,
  IsoDate,
  Manifest,
  VitalsFile,
} from './types';

const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  const key = path;
  let hit = cache.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = fetch(dataUrl(path)).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
      return r.json() as Promise<T>;
    });
    cache.set(key, hit);
  }
  return hit;
}

/** Manifest paths are written as 'data/day/x.json'; dataUrl() adds 'data/'. */
const strip = (p: string) => p.replace(/^data\//, '');

export const loadManifest = () => get<Manifest>('manifest.json');
export const loadCountlines = () => get<CountlineIndex>('countlines.json');
export const loadDay = (date: IsoDate) => get<DayFile>(`day/${date}.json`);
export const loadContext = (date: IsoDate) => get<ContextFile>(`context/${date}.json`);
export const loadVitals = (file: string) => get<VitalsFile>(strip(file));
export const loadGeoJson = (file: string) => get<GeoJsonLike>(strip(file));

/** deck.gl's GeoJsonLayer wants the real GeoJSON types, not a lookalike. */
export type GeoJsonLike = FeatureCollection;

/**
 * Decode a base64 packed bitset, LSB-first, into one byte per bit.
 * This is the ONLY way the UI may distinguish "no traffic" from "sensor
 * offline". Conflating those is the commonest misreading of this dataset.
 */
export function decodeBitset(b64: string, length: number): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const byte = bin.charCodeAt(i >> 3);
    out[i] = (byte >> (i & 7)) & 1;
  }
  return out;
}
