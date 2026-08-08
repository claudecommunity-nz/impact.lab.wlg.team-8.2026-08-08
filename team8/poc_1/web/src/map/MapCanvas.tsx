/**
 * The instrument. MapLibre draws a knocked-back basemap; deck.gl draws the
 * street network on top and owns interaction (so picking works), pushing its
 * view state back into MapLibre each frame.
 *
 * ONE clock now, not two. The second clock was the cardiac pulse, and it existed
 * to make 3D columns breathe; with the columns gone there is nothing for a beat
 * to ride that would not be a lie — line weight is carrying a flow figure, and a
 * number that throbs is a number you cannot read off the screen. What is left is
 * playback: it advances the hour and crosses into React 24 times per
 * playthrough, never more.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Deck, MapView, type Layer, type MapViewState } from '@deck.gl/core';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState, useDispatch, useSelection } from '../state/app';
import { useData } from '../data/DataProvider';
import type { DayModel, SiteView } from '../data/derive';
import { rampColor, cssRgb } from '../theme/color';
import { thresholds } from '../theme/foundations';
import { signedPct } from '../copy/strings';
import { loadGeoJson, type GeoJsonLike } from '../data/load';
import { dataUrl } from '../data/dataUrl';
import { sampleAlongPath, type HeatPoint, type RoadBase } from './heat';

/**
 * Heat points, memoised on (rows, series, hour).
 *
 * Rebuilt on the hour boundary — 24 times a playthrough — not on each of the 60
 * frames in between. Sampling ~3,400 points every frame would cost more than the
 * whole rest of the layer stack.
 */
let heatCache: {
  rows: unknown;
  series: string;
  hour: number;
  points: HeatPoint[];
} | null = null;

function heatFor(
  rows: EdgeRow[],
  series: string,
  weekHour: number,
  confirmedHours: number,
): HeatPoint[] {
  if (
    heatCache &&
    heatCache.rows === rows &&
    heatCache.series === series &&
    heatCache.hour === weekHour
  ) {
    return heatCache.points;
  }
  const points: HeatPoint[] = [];
  // Past the T+1 horizon there is no actual, so there is no heat. A forecast
  // must never render as a measurement.
  if (weekHour < confirmedHours) {
    for (const r of rows) {
      // `flow` is the flat measured series; `dev` is the per-series one. Heat is
      // WHERE PEOPLE ARE, so it rides volume — deviation is already the edge
      // colour underneath and does not need saying twice.
      const flow = r.edge.flow?.[weekHour];
      if (flow == null || flow <= 0) continue;
      points.push(...sampleAlongPath(r.path, flow));
    }
  }
  heatCache = { rows, series, hour: weekHour, points };
  return points;
}
import type { Edge, GisLayerMeta, LayerId } from '../data/types';
import { edgeSeriesFor, weekSeriesFor } from '../week/model';
import { buildLayers, edgeRows, isJudgedEdge, type EdgeRow, type LayerCtx } from './layers';
import { MapTooltip } from './MapTooltip';
import './map.css';

/**
 * North up, flat. Bearing 90 — east up — was measured, not taste: it cut
 * cross-place occlusion from 15.3% to 5.5% because Wellington's sensor network
 * is a north–south ribbon. That argument was entirely about COLUMNS occluding
 * each other. Without them it buys nothing and costs every viewer a mental
 * rotation before they can match the map to a street they know.
 *
 * Pitch 0 and maxPitch 0: this is a 2D edge map. A pitched camera foreshortens
 * the far half of the network, which would make line weight — the flow channel —
 * a function of where the street happens to sit on screen.
 *
 * The framing is deliberately NOT a fit-to-data, and this was measured. The
 * edges span Johnsonville to Island Bay — 20 km, which fits at z10.4; the median
 * edge is 137 m, which is EIGHT PIXELS there. Fitting the network turns it into
 * a field of dots and throws away the one thing paths buy over points, which is
 * that a line has a direction you can follow along a street you know. z13 puts
 * the median edge at 18 px and the CBD reads as a street map.
 *
 * The cost is honest and stated in the legend: the network continues past this
 * frame. The map pans, and Streets is the full inventory of all 147.
 */
const INITIAL_VIEW: MapViewState = {
  longitude: 174.7815,
  latitude: -41.2935,
  zoom: 13.0,
  pitch: 0,
  bearing: 0,
  maxPitch: 0,
};

/** manifest gis ids → the toggle ids the UI speaks */
const GIS_BY_TOGGLE: Partial<Record<LayerId, string>> = {
  tsunami: 'tsunami-evacuation-zones',
  routes: 'emergency-routes',
  closures: 'street-events-road-closures',
  hubs: 'community-emergency-hubs',
};

/**
 * Selection is still keyed by countline index downstream — every panel reads
 * `byCi`. An edge resolves to the busiest counted member of its first
 * contributing camera on the way in, so clicking a street still fills the
 * selection panel and nothing downstream has to learn that the map changed
 * scale from a point to a line.
 */
function representativeCi(site: SiteView): number {
  const pool = site.counted.length ? site.counted : site.members;
  return pool.reduce((best, l) => (l.record.exp > best.record.exp ? l : best), pool[0]).ci;
}

/** Every camera site that fed this edge, in the day model. Missing ones are
 *  dropped rather than faked: a site can contribute to the week artefact and be
 *  absent from a particular day's file. */
function sitesOfEdge(model: DayModel | null, edge: Edge | null): SiteView[] {
  if (!model || !edge) return [];
  return edge.sensor_sites
    .map((id) => model.bySiteId.get(String(id)))
    .filter((s): s is SiteView => !!s);
}

const nz = (v: number) => Math.round(v).toLocaleString('en-NZ');

/**
 * The citywide headline has to use the SAME dead zone the map's colour ramp
 * does, or the sentence and the picture disagree: a −0.4% hour rendered
 * "−0%" beside a map on which every edge under 8% is deliberately flat, which
 * reads as a broken stat next to a broken map. Under the dead zone the honest
 * word is the one the ramp is already saying.
 */
function cityText(dev: number | null): string {
  if (dev == null) return '—';
  return Math.abs(dev) < thresholds.deadZonePct
    ? 'on forecast'
    : `${signedPct(dev)} against forecast`;
}

/** The stops the legend draws. Ends are the ramp's own display clamp; the middle
 *  is the dead zone, which is a rendered state and therefore has to be in the
 *  key or half the map reads as broken. */
const RAMP_STOPS = [-100, -60, -30, -12, 0, 12, 30, 50] as const;

export function MapCanvas() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compassRef = useRef<SVGSVGElement>(null);
  const deckRef = useRef<Deck<MapView> | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const viewRef = useRef<MapViewState>({ ...INITIAL_VIEW });
  const gisRef = useRef<Partial<Record<LayerId, GeoJsonLike>>>({});
  // The cold base: every street in the city. ~0.5 MB gzipped, fetched once and
  // never invalidated — the road network does not change during a demo.
  const roadBaseRef = useRef<RoadBase | null>(null);

  useEffect(() => {
    let live = true;
    fetch(dataUrl('data/gis/road-base.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RoadBase | null) => {
        if (live && d?.paths?.length) roadBaseRef.current = d;
      })
      // A missing cold base must never take the map down; you just lose the
      // context layer and the lit edges still draw.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const { palette } = useTheme();
  const state = useAppState();
  const dispatch = useDispatch();
  const selection = useSelection();
  const { model, manifest, week, edges } = useData();

  // The pick is an EDGE now. It is React state and not a ref because the readout
  // renders from it — but it changes at human speed, and the render it causes
  // does not touch the rAF loop, which reads everything through `live`.
  const [hoveredEdge, setHoveredEdge] = useState<Edge | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);

  // Flattened once per artefact load. 147 edges become 353 polylines; deck.gl
  // regenerates its attribute buffers whenever `data` changes identity, so this
  // must not be rebuilt per frame.
  const allRows = useMemo(() => (edges ? edgeRows(edges.edges) : []), [edges]);

  /**
   * The edge artefact covers ONE week. The unlisted replay route drives `date`
   * to October 2025 while the week cursor stays where it was, so without this
   * gate the map drew week 32 of 2026 under a 23 Oct 2025 headline — a false
   * temporal register, which is the one failure mode this codebase treats as
   * disqualifying. On Week and Streets the date is always inside the week, so
   * this is a no-op there.
   */
  const weekStart = week?.week_start ?? edges?.week_start ?? null;
  const weekEnd = week?.week_end ?? null;
  const inWeek =
    weekStart != null && weekEnd != null && state.date >= weekStart && state.date <= weekEnd;
  const rows = inWeek ? allRows : [];

  const series = edgeSeriesFor(state.mode);
  const confirmedHours = edges?.confirmed_hours ?? 0;
  const markedSites = useMemo(
    () => sitesOfEdge(model, selectedEdge ?? hoveredEdge),
    [model, selectedEdge, hoveredEdge],
  );

  // Everything the rAF loop needs, refreshed on every React render. The loop
  // itself is created once and never torn down.
  const live = useRef({
    state,
    palette,
    model,
    dispatch,
    rows,
    series,
    confirmedHours,
    hoveredEdge,
    selectedEdge,
    markedSites,
    setHoveredEdge,
    setSelectedEdge,
    selection,
  });
  live.current = {
    state,
    palette,
    model,
    dispatch,
    rows,
    series,
    confirmedHours,
    hoveredEdge,
    selectedEdge,
    markedSites,
    setHoveredEdge,
    setSelectedEdge,
    selection,
  };

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
      // Rotation stays available on ctrl/right-drag, and touchRotate is on
      // because deck defaults it OFF — on a trackpad-only demo machine the
      // two-finger gesture was the only rotation anyone would reach for. The
      // default is north-up, so the compass is the way back.
      controller: { dragRotate: true, touchRotate: true },
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

  /* --- Esc clears the pick -------------------------------------------- *
   * The shell owns the Escape key and clears the countline selection, which is
   * what every panel reads. The map's edge pick is a second selection channel
   * and was not listening, so Esc emptied the rail and left the street lit and
   * its readout up. One-way sync: the countline selection is the authority. */
  const { selected: selectedCi } = selection;
  useEffect(() => {
    if (selectedCi == null) setSelectedEdge(null);
  }, [selectedCi]);

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

  /* --- the clock ------------------------------------------------------- */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hourAccum = 0;
    let bearingShown = NaN;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(120, now - last);
      last = now;
      const l = live.current;
      const s = l.state;
      const deck = deckRef.current;
      if (!deck) return;

      // Playback. The only thing in here that crosses into React.
      const msPerHour = (s.secondsPerDay * 1000) / 24;
      if (s.playing && !s.scrubbing) {
        hourAccum += dt;
        if (hourAccum >= msPerHour) {
          hourAccum -= msPerHour;
          l.dispatch({ type: 'TICK' });
        }
      } else {
        hourAccum = 0;
      }

      const view = viewRef.current;
      const ctx: LayerCtx = {
        rows: l.rows,
        weekHour: s.weekHour,
        confirmedHours: l.confirmedHours,
        series: l.series,
        palette: l.palette,
        model: l.model,
        hour: s.hour,
        refused: l.model?.refused ?? false,
        showCoverage: s.showCoverage,
        hoveredEdge: l.hoveredEdge?.id ?? null,
        selectedEdge: l.selectedEdge?.id ?? null,
        markedSites: l.markedSites,
        gis: gisRef.current,
        layers: s.layers,
        roadBase: roadBaseRef.current,
        heatPoints: heatFor(l.rows, l.series, s.weekHour, l.confirmedHours),
        // Always on for now. A toggle needs a new LayerId, and the nav is being
        // edited concurrently — not worth the merge on build day.
        showHeat: true,
        onHover: (edge) => {
          if ((l.hoveredEdge?.id ?? null) === (edge?.id ?? null)) return;
          l.setHoveredEdge(edge);
        },
        onClick: (edge) => {
          l.setSelectedEdge(edge);
          // The panels downstream still speak countline. Bridge, do not fork.
          const site = sitesOfEdge(l.model, edge)[0];
          l.selection.setSelected(site ? representativeCi(site) : null);
        },
      };

      // The needle. Written straight to the DOM and only when it moves — a
      // compass in React state would put a float from a drag gesture through
      // the reducer, sixty times a second.
      const bearing = view.bearing ?? 0;
      if (compassRef.current && bearingShown !== bearing) {
        bearingShown = bearing;
        compassRef.current.style.transform = `rotate(${-bearing}deg)`;
      }

      deck.setProps({
        viewState: viewRef.current,
        layers: buildLayers(ctx) as Layer[],
      });
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /**
   * The compass was decoration for the whole build — a div inside a
   * pointer-events: none bar, so a viewer who had rotated the map had no way
   * back except guessing the drag. It writes viewRef directly rather than going
   * through React: the rAF loop pushes viewRef into deck every frame, so the
   * next frame picks the change up. MapLibre has to be told separately, because
   * it only follows deck via onViewStateChange and that fires on gestures, not
   * on us setting the view state ourselves.
   */
  const resetNorth = () => {
    const v = { ...viewRef.current, bearing: 0 };
    viewRef.current = v;
    mapRef.current?.jumpTo({
      center: [v.longitude, v.latitude],
      zoom: v.zoom,
      bearing: 0,
      pitch: v.pitch ?? 0,
    });
  };

  /* --- the two overlays ------------------------------------------------- */
  const day = week?.days[state.dayOffset];
  const at = day ? `${day.short} ${String(state.hour).padStart(2, '0')}:00` : '—';
  const confirmed = state.weekHour < confirmedHours;

  // Counted from what is actually on screen, never typed. `scored` is the honest
  // denominator for anything the headline claims: an edge with one sensor, or a
  // forecast under 5/hr, carries no percentage and is not in it.
  let scored = 0;
  let below = 0;
  let above = 0;
  if (confirmed && edges) {
    for (const e of edges.edges) {
      if (!isJudgedEdge(e)) continue;
      const d = e.dev[series]?.[state.weekHour];
      if (d == null) continue;
      scored++;
      if (d <= -thresholds.deadZonePct) below++;
      else if (d >= thresholds.deadZonePct) above++;
    }
  }

  // The citywide figure is the WEEK artefact's own, not a sum of edges: edges
  // cover 147 streets of a whole city, and summing them would quietly redefine
  // "citywide" as "the streets we happen to watch".
  const wSeries = weekSeriesFor(state.mode);
  const cityActual = week?.actual[wSeries]?.[state.weekHour] ?? null;
  const cityForecast = week?.forecast[wSeries]?.[state.weekHour] ?? null;
  const cityDev =
    cityActual != null && cityForecast ? ((cityActual - cityForecast) / cityForecast) * 100 : null;

  const refused = model?.refused ?? false;

  return (
    <div className="pp-map" data-refused={refused}>
      <div
        className="pp-map__base"
        ref={mapDiv}
        style={{ opacity: palette.basemap.opacity, filter: palette.basemap.filter }}
      />
      <canvas className="pp-map__deck" ref={canvasRef} />
      {refused && <div className="pp-map__hatch" aria-hidden="true" />}

      {/* ONE top-left column, stamp then readout. They were two independently
          positioned boxes and the readout was pinned to the bottom of the map,
          where it landed on the legend bar; stacking them in a flow column
          makes non-intersection structural instead of a pair of magic offsets
          that go stale the moment either box changes height. */}
      <div className="pp-map__tl">
        {/* Deliberately in the corner a screenshot crop keeps: a coloured map
            with no date and no "not live" on it reads as a live situation
            report. */}
        <div className="pp-map__stamp">
          <div className="pp-map__stamp-head pp-t-label">
            <span>Flow rate vs forecast</span>
            <span className="pp-map__stamp-at pp-t-mono-sm">{at}</span>
          </div>
          <p className="pp-map__stamp-line pp-t-caption">
            {!inWeek ? (
              <>
                No flow layer for {state.date}. The edge artefact covers {weekStart ?? '—'} to{' '}
                {weekEnd ?? '—'} only — the map is showing context layers, not a blank city.
              </>
            ) : refused ? (
              'This day is not being assessed — coverage was too poor to look at. No edge is coloured.'
            ) : !confirmed ? (
              <>
                Beyond the confirmed feed. Lines are drawn at <strong>forecast</strong> weight and
                carry no deviation colour.
              </>
            ) : (
              <>
                Citywide <strong>{cityText(cityDev)}</strong> this hour. {scored} of{' '}
                {edges?.n_edges ?? 0} edges scored — <strong>{below}</strong> below,{' '}
                <strong>{above}</strong> above.
              </>
            )}
          </p>
          <span className="pp-map__stamp-tag pp-t-caption">
            T+1 feed · not live · deviation is measured, cause is not
          </span>
        </div>

        <MapTooltip
          edge={hoveredEdge ?? selectedEdge}
          weekHour={state.weekHour}
          series={series}
          confirmed={confirmed}
          at={at}
        />
      </div>

      {/* The key, bottom-left. It was a 767px bar centred on an 832px map — a
          full-width slab of caption text for what is a key, not content — and
          its right end ran under the attribution block. Everything here is now
          a swatch plus two or three words; the sentences it used to carry are
          in the disclosure, which is where they were already going. */}
      <div className="pp-map__key">
        {/* A control, not an ornament: the default is north-up, so the only
            reason the needle ever moves is that the viewer rotated the map,
            and the thing showing them they have is also the way back. */}
        <button
          type="button"
          className="pp-map__compass"
          aria-label="Reset the map to north up"
          title="Reset to north up"
          onClick={resetNorth}
        >
          <svg viewBox="0 0 32 32" ref={compassRef} aria-hidden="true">
            <path d="M16 3.5 L20.6 21 L16 17.4 L11.4 21 Z" />
            <text x="16" y="29.5" textAnchor="middle">
              N
            </text>
          </svg>
        </button>

        <div className="pp-map__ramp" aria-hidden="true">
          <span>−40</span>
          <span className="pp-map__ramp-swatches">
            {RAMP_STOPS.map((v) => (
              <i key={v} style={{ background: cssRgb(rampColor(palette, v).rgb) }} />
            ))}
          </span>
          <span>+40</span>
        </div>
        {/* "flat band = on forecast (±8%)" for a swatch the eye has already
            read as flat. The dead zone is the number worth keeping. */}
        <span>±{thresholds.deadZonePct}% = flat</span>

        <span>
          <strong>weight</strong> = flow
        </span>
        <span className="pp-map__grey">
          <i /> unjudged
        </span>
        <details className="pp-map__more">
          <summary>how to read</summary>
          {/* One wrapper, because the key sits at the bottom edge and the
              disclosure has to open UPWARD — which means one absolutely
              positioned box, not four stacked on each other. */}
          <div className="pp-map__more-body pp-t-caption">
            <p>
              An edge is one WCC road id. Its numbers are <strong>inferred</strong>: each camera's
              reading is spread along the street it sits on and decays to zero at 300 m. It is not a
              measurement of the whole stretch, and it is never established cause.
            </p>
            <p>
              Line weight is movements per hour on a square-root scale, full weight at{' '}
              <span className="pp-t-mono-sm">1,500/hr</span>. Colour is deviation from this week's
              forecast for this same hour — not from last week.
            </p>
            <p>
              Grey means we declined to judge:{' '}
              {edges ? edges.n_edges - (edges.measured.edges_with_2plus_sensors ?? 0) : '—'} edges
              have one camera speaking for the whole street, and any edge forecast under 5/hr loses
              its percentage because a ratio on that denominator is noise.
            </p>
            <p>
              Most of Wellington has no sensor on it at all and draws nothing. A blank street is an
              unwatched street, not a quiet one.
            </p>
          </div>
        </details>
      </div>

      {/* Provenance, bottom-right. Attribution and coverage are both required
          on the frame and neither is content, so they sit together at the
          smallest size that still reads. The site/edge counts moved here from
          the key's summary: they are what we can see, not how to read it. */}
      <div className="pp-map__prov">
        <span>
          {edges ? nz(edges.n_sites) : '—'} camera sites on {edges?.n_edges ?? '—'} edges ·{' '}
          {edges?.measured.edges_with_2plus_sensors ?? '—'} judged
        </span>
        <span>
          Movement: WCC / VivaCity via Pōneke Travel Insights · Roads: WCC centrelines · Basemap{' '}
          {palette.basemap.attribution}
        </span>
      </div>
    </div>
  );
}
