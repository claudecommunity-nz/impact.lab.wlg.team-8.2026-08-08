/**
 * The instrument. MapLibre draws a knocked-back basemap; deck.gl draws the
 * network on top and owns interaction (so picking works), pushing its view
 * state back into MapLibre each frame.
 *
 * Two clocks, and that separation is the whole performance story:
 *   Clock A — playback. Advances the hour. Crosses into React 24 times per
 *             playthrough, never more.
 *   Clock B — the pulse. 60 fps, lives entirely in a ref, never touches React.
 *             It keeps breathing while a panel opens or the app is paused.
 */

import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  type Layer,
  type MapViewState,
} from '@deck.gl/core';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState, useDispatch, useSelection } from '../state/app';
import { useData } from '../data/DataProvider';
import { RINGS, type DayModel, type SiteView } from '../data/derive';
import { pulse } from '../theme/foundations';
import { loadGeoJson, type GeoJsonLike } from '../data/load';
import type { GisLayerMeta, LayerId } from '../data/types';
import { buildLayers, type LayerCtx } from './layers';
import { REDUCED_MOTION_BEAT, SUPPRESSED_BEAT, easeCardiac, prefersReducedMotion } from './cardiac';
import { MapTooltip } from './MapTooltip';
import './map.css';

/**
 * Bearing 90 — east up — is measured, not taste. Simulated over the real 118
 * site positions, cross-place occlusion is 5.5% at bearing 90 against 15.3%
 * north-up, because PCA on the 66 CBD sites gives a principal axis at bearing
 * 0.4° with 2.0 anisotropy: Wellington's sensor network IS a north–south
 * ribbon, so north-up looks straight down it and stacks Courtenay Place in
 * front of Lambton Quay. East-up lays the ribbon across the viewport width and
 * puts the harbour — empty, no basemap clutter — behind the CBD columns.
 * The cost is that north points left, which the compass in the chrome pays for.
 *
 * Pitch 48 is the knee: occlusion runs 0% / 3.0% / 5.5% / 7.6% at 0 / 25 / 48 /
 * 65, while height legibility rises fast. Capped at 55 because the CARTO raster
 * basemap smears at the horizon beyond it.
 */
const INITIAL_VIEW: MapViewState = {
  longitude: 174.7790,
  latitude: -41.2905,
  zoom: 13.1,
  pitch: 48,
  bearing: 90,
  maxPitch: 55,
};

/**
 * deck.gl's default lighting darkens the side faces enough that a −25% and a
 * −55% column can land on the same rendered colour — which would put the
 * lighting model into the measurement channel. 0.82/0.38 gives just enough form
 * to read the box while keeping every face within a ramp step of its true
 * value. The cases opt out entirely (`material: false`).
 */
const LIGHTING = new LightingEffect({
  ambient: new AmbientLight({ intensity: 0.82 }),
  dir: new DirectionalLight({ intensity: 0.38, direction: [-1, -0.4, -1] }),
});

/** manifest gis ids → the toggle ids the UI speaks */
const GIS_BY_TOGGLE: Partial<Record<LayerId, string>> = {
  tsunami: 'tsunami-evacuation-zones',
  routes: 'emergency-routes',
  closures: 'street-events-road-closures',
  hubs: 'community-emergency-hubs',
};

/** "Thu 23 Oct 2025" — short enough for the corner chip, unambiguous anyway. */
const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/**
 * The map selects a SITE now, but selection state is still keyed by countline
 * index and every panel reads `byCi`. Rather than fork the key type underneath
 * the panels, a site resolves to its busiest counted member on the way in and
 * back through `siteOfCi` on the way out — two map lookups, and nothing
 * downstream has to know the map changed scale.
 */
function representativeCi(site: SiteView): number {
  const pool = site.counted.length ? site.counted : site.members;
  return pool.reduce((best, l) => (l.record.exp > best.record.exp ? l : best), pool[0]).ci;
}

const siteOfCi = (model: DayModel, ci: number | null): string | null =>
  ci == null ? null : (model.siteOfCi.get(ci) ?? null);

const ciOfSite = (model: DayModel, siteId: string | null): number | null => {
  const site = siteId == null ? undefined : model.bySiteId.get(siteId);
  return site ? representativeCi(site) : null;
};

export function MapCanvas() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compassRef = useRef<SVGSVGElement>(null);
  const deckRef = useRef<Deck<MapView> | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const viewRef = useRef<MapViewState>({ ...INITIAL_VIEW });
  const gisRef = useRef<Partial<Record<LayerId, GeoJsonLike>>>({});

  const { palette } = useTheme();
  const state = useAppState();
  const dispatch = useDispatch();
  const selection = useSelection();
  const { model, manifest } = useData();

  // Everything the rAF loop needs, refreshed on every React render. The loop
  // itself is created once and never torn down.
  const live = useRef({ state, palette, model, selection, dispatch });
  live.current = { state, palette, model, selection, dispatch };

  /* --- basemap + deck, created once -------------------------------- */
  useEffect(() => {
    if (!mapDiv.current || !canvasRef.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      interactive: false,
      attributionControl: false,
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      style: {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: [palette.basemap.tiles],
            tileSize: 256,
            attribution: palette.basemap.attribution,
          },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
    });
    mapRef.current = map;

    const deck = new Deck<MapView>({
      canvas: canvasRef.current,
      views: new MapView({ id: 'map' }),
      initialViewState: INITIAL_VIEW,
      // Rotating out of an occlusion is the only recovery for the ~5% of
      // columns a nearer one hides, and it is the gesture that sells 3D in a
      // four-minute demo. It is also what makes the bearing-derived pair offset
      // and square angle in layers.ts mandatory rather than decorative.
      controller: { dragRotate: true },
      effects: [LIGHTING],
      layers: [],
      getTooltip: () => null,
      onViewStateChange: ({ viewState }) => {
        const v = viewState as MapViewState;
        viewRef.current = v;
        map.jumpTo({
          center: [v.longitude, v.latitude],
          zoom: v.zoom,
          bearing: v.bearing ?? 0,
          pitch: v.pitch ?? 0,
        });
      },
    });
    deckRef.current = deck;

    return () => {
      deck.finalize();
      map.remove();
      deckRef.current = null;
      mapRef.current = null;
    };
    // Created once and never torn down. The palette's basemap tiles are swapped
    // in place by the effect below rather than by rebuilding the map.
  }, []);

  /* --- palette swap repaints the basemap without rebuilding the map --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('base');
      if (src && 'setTiles' in src) (src as { setTiles: (t: string[]) => void }).setTiles([palette.basemap.tiles]);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [palette]);

  /* --- lazily fetch a GIS layer the first time it is switched on ----- */
  useEffect(() => {
    if (!manifest) return;
    for (const [toggle, gisId] of Object.entries(GIS_BY_TOGGLE) as Array<[LayerId, string]>) {
      if (!state.layers[toggle] || gisRef.current[toggle]) continue;
      const meta = manifest.gis_layers.find((g: GisLayerMeta) => g.id === gisId);
      if (!meta) continue;
      loadGeoJson(meta.file)
        .then((fc) => {
          gisRef.current[toggle] = fc;
        })
        .catch(() => {
          /* a missing context layer must never take the map down */
        });
    }
  }, [manifest, state.layers]);

  /* --- the two clocks ------------------------------------------------- */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let phase = 0;
    let hourAccum = 0;
    let bearingShown = NaN;
    const reduced = prefersReducedMotion();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(120, now - last);
      last = now;
      const { state: s, palette: p, model: m, selection: sel, dispatch: dis } = live.current;
      const deck = deckRef.current;
      if (!deck || !m) return;

      // Clock A — playback. The only thing that crosses into React.
      const msPerHour = (s.secondsPerDay * 1000) / 24;
      if (s.playing && !s.scrubbing) {
        hourAccum += dt;
        if (hourAccum >= msPerHour) {
          hourAccum -= msPerHour;
          dis({ type: 'TICK' });
        }
      } else {
        hourAccum = 0;
      }

      // Clock B — the pulse. Never crosses the React boundary.
      const bpm = m.bpm[s.hour] || pulse.bpmMin;
      const period = 60000 / bpm;
      phase = (phase + dt / period) % 1;

      const ringBeats: number[] = [];
      for (let r = 0; r < RINGS; r++) {
        if (m.refused) ringBeats.push(SUPPRESSED_BEAT);
        else if (reduced) ringBeats.push(REDUCED_MOTION_BEAT);
        else {
          const offset = (pulse.propagationMs / period) * (r / Math.max(1, RINGS - 1));
          ringBeats.push(easeCardiac(phase - offset + 1));
        }
      }

      const view = viewRef.current;
      const ctx: LayerCtx = {
        model: m,
        hour: s.hour,
        beat: ringBeats[0],
        ringBeats,
        palette: p,
        ghost: s.ghost,
        showCoverage: s.showCoverage,
        showDiagnosis: s.layers.diagnosis,
        refused: m.refused,
        mode: s.mode,
        selectedSite: siteOfCi(m, sel.selected),
        hoveredSite: siteOfCi(m, sel.hovered),
        zoom: view.zoom,
        bearing: view.bearing ?? 0,
        latitude: view.latitude,
        gis: gisRef.current,
        layers: s.layers,
        onHover: (siteId) => sel.setHovered(ciOfSite(m, siteId)),
        onClick: (siteId) => sel.setSelected(ciOfSite(m, siteId)),
      };

      // The needle is the price of bearing 90. Written straight to the DOM and
      // only when it moves — a compass in React state would put a float from a
      // drag gesture through the reducer.
      if (compassRef.current && bearingShown !== ctx.bearing) {
        bearingShown = ctx.bearing;
        compassRef.current.style.transform = `rotate(${-ctx.bearing}deg)`;
      }

      deck.setProps({
        viewState: viewRef.current,
        layers: buildLayers(ctx) as Layer[],
      });
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pp-map" data-refused={model?.refused ?? false}>
      <div
        className="pp-map__base"
        ref={mapDiv}
        style={{ opacity: palette.basemap.opacity, filter: palette.basemap.filter }}
      />
      <canvas className="pp-map__deck" ref={canvasRef} />
      {model?.refused && <div className="pp-map__hatch" aria-hidden="true" />}
      <MapTooltip />
      {/* Persistent, and deliberately in the corner a screenshot crop keeps.
          A pulsing map with no date on it reads as a live situation report. */}
      <div className="pp-map__replay pp-t-label">
        <span className="pp-map__replay-tag">Replay</span>
        <span>
          {model ? `${shortDate(model.date)} · ${String(state.hour).padStart(2, '0')}:00` : '—'}
        </span>
        <span className="pp-map__replay-not-live">not live</span>
      </div>
      {/* Compass and legend ride one bar in the free strip between the floating
          panels — the map's corners all belong to something else now.

          The legend is load-bearing, not decoration: half the map renders
          neutral once the noise floor is applied and the suburbs are stubs,
          both of which are correct and both of which read as "broken" to
          anyone who has not been told what the two channels are. But the
          prose version of it was four lines wide enough to sit on top of the
          CBD columns at the default view — a legend that occludes the data it
          explains. So the always-visible part is now the drawn key plus one
          clause per channel, and the caveats that only matter once you are
          reading a specific column moved behind the disclosure. */}
      <div className="pp-map__chrome">
        {/* North is to the left at the default bearing. An 8-point occlusion
            penalty is worse than a rotated compass, so the compass pays. */}
        <div className="pp-map__compass" aria-label="north indicator">
          <svg viewBox="0 0 32 32" ref={compassRef} aria-hidden="true">
            <path d="M16 3.5 L20.6 21 L16 17.4 L11.4 21 Z" />
            <text x="16" y="29.5" textAnchor="middle">
              N
            </text>
          </svg>
        </div>
        {/* One column, drawn. The gap between the case top and the solid top
            is the entire encoding, and showing it teaches it faster than the
            sentence underneath ever did. */}
        <svg className="pp-map__key" viewBox="0 0 34 40" aria-hidden="true">
          <rect className="pp-map__key-case" x="8.5" y="6.5" width="17" height="30" rx="1" />
          <rect className="pp-map__key-solid" x="11" y="24" width="12" height="12" />
          <path className="pp-map__key-gap" d="M5 7 L5 23.5 M3 7 L7 7 M3 23.5 L7 23.5" />
        </svg>
        <div className="pp-map__coverage pp-t-caption">
          <span>
            <strong>Height</strong> is volume
          </span>
          <span>
            <strong>Colour</strong> is change against normal
          </span>
          {/* The pair glyph, drawn. "Pedestrians left, vehicles right" was
              ambiguous the moment the camera rotated; a square beside a
              triangle is not, so the legend shows the two footprints rather
              than naming two sides. */}
          <span className="pp-map__pair">
            <svg viewBox="0 0 40 18" aria-hidden="true">
              <rect className="pp-map__key-ped" x="3" y="4" width="11" height="11" />
              <path className="pp-map__key-veh" d="M31 3 L38 15 L24 15 Z" />
            </svg>
            people / vehicles
          </span>
          <details className="pp-map__more">
            {/* Both numbers in one string. The moving one (this day) and the
                fixed one (the network) were on screen simultaneously with the
                same noun and nothing reconciling them. */}
            <summary>
              {model?.nSites ?? '—'} of {manifest?.network.camera_sites ?? '—'} camera sites
              reported
            </summary>
            {/* One wrapper, because the bar is flush to the bottom edge and the
                disclosure has to open UPWARD — which means one absolutely
                positioned box, not four stacked on each other. */}
            <div className="pp-map__more-body">
            <p>
              Full height is 2,400 movements an hour, one linear scale citywide. The gap between
              the top of the pale case and the top of the solid inside it is the shortfall, to
              scale.
            </p>
            <p>
              The pale case is the usual hour for that site — an 84-day median, not today's data,
              so it never takes the colour ramp. An empty case is an hour the feed did not deliver;
              it is not a reported zero. Colour is dropped under 20/hr, where a percentage is a
              rounding error.
            </p>
            <p>
              Short stubs are a minimum drawn height so a reporting sensor stays visible — read the
              figure, not the stub. Vehicles are car, bus and LGV. A blank map is unwatched city,
              not quiet city.
            </p>
            <p>
              Height clips at 2,400/hr, so the three busiest pedestrian sites in the CBD draw the
              same full case. Where it clips, the readout says{' '}
              <span className="pp-t-mono-sm">2,400+</span> — read the figure there, not the column.
            </p>
            </div>
          </details>
        </div>
      </div>
      <div className="pp-map__attrib pp-t-caption">
        Movement: WCC / VivaCity via Pōneke Travel Insights · Basemap {palette.basemap.attribution}
      </div>
    </div>
  );
}
