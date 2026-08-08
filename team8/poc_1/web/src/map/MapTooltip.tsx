/**
 * A fixed corner readout rather than a cursor-following tooltip: an instrument
 * has a readout panel, and it means the numbers stay still long enough to be
 * read from the back of the room.
 *
 * It describes the EDGE, because the edge is what the map draws now. It used to
 * describe a camera site, and when the marks became streets that readout started
 * answering a question nobody had asked — you hover Thorndon Quay and get the
 * numbers for one of the cameras on it.
 *
 * The per-mode signature is the point of the block, not decoration. A drop in
 * people with vehicles holding is an exposure hazard; vehicles alone is a
 * closure the footpath survived; both together is loss of access. That is a
 * hypothesis to investigate and the caption says so — the artefact's own
 * `inference` rule is that an edge's numbers are spread from up to four sensors,
 * not measured along the whole street.
 */

import { EDGE_SERIES, type Edge, type EdgeSeries } from '../data/types';
import { signedPct } from '../copy/strings';
import { InfoBadge } from '../ui';
import { isJudgedEdge } from './layers';

const nz = (v: number) => Math.round(v).toLocaleString('en-NZ');

const SERIES_LABEL: Record<EdgeSeries, string> = {
  total: 'all',
  pedestrian: 'people',
  veh: 'vehicles',
};

export interface MapTooltipProps {
  edge: Edge | null;
  weekHour: number;
  /** Which series the mode pills are asking for — highlighted in the signature. */
  series: EdgeSeries;
  /** False past the T+1 horizon: there is a forecast and no actual. */
  confirmed: boolean;
  /** "THU 6 09:00", already formatted by the map. */
  at: string;
}

export function MapTooltip({ edge, weekHour, series, confirmed, at }: MapTooltipProps) {
  if (!edge) return null;

  const flow = edge.flow[weekHour];
  const forecast = edge.forecast_flow[weekHour] ?? 0;
  const judged = isJudgedEdge(edge);

  return (
    <div className="pp-map__readout">
      <div className="pp-map__readout-head">
        <span className="pp-t-h3">{edge.name}</span>
        <span className="pp-t-mono-sm pp-c-muted">
          {[edge.suburb, edge.road_category, `${nz(edge.length_m)} m`].filter(Boolean).join(' · ')}
        </span>
      </div>

      {confirmed && flow != null ? (
        <div className="pp-map__readout-grid pp-map__readout-grid--4 pp-t-mono-sm">
          <span className="pp-c-secondary pp-t-label">{at}</span>
          <span className="pp-c-secondary pp-t-label">obs</span>
          <span className="pp-c-secondary pp-t-label">fcst</span>
          <span className="pp-c-secondary pp-t-label">Δ</span>
          <span className="pp-c-secondary">flow/hr</span>
          <span>{nz(flow)}</span>
          <span>{nz(forecast)}</span>
          <span>{devText(edge, 'total', weekHour, judged)}</span>
        </div>
      ) : (
        <p className="pp-t-caption pp-c-secondary">
          {at} is past the confirmed feed. Forecast is{' '}
          <span className="pp-t-mono-sm">{nz(forecast)}</span>/hr; there is no actual to compare it
          with yet.
        </p>
      )}

      {/* The mode signature. Shown even when it is flat — "people and vehicles
          both moved as forecast" is a finding, and hiding the rows that happen
          to be quiet would make the block look like it only ever fires. */}
      {confirmed && (
        <div className="pp-map__signature pp-t-mono-sm">
          {EDGE_SERIES.map((s) => (
            <span key={s} data-on={s === series}>
              <span className="pp-c-secondary">{SERIES_LABEL[s]}</span>{' '}
              {devText(edge, s, weekHour, judged)}
            </span>
          ))}
        </div>
      )}

      {/* The sensor count stays on the face; the inference caveat moved behind
          the (i) because it was two of the readout's five lines. MOVED, NOT
          CUT — "inferred, not measured" is the difference between an honest
          instrument and a misleading one, so it is one click from the numbers
          it qualifies rather than gone. The unjudged case keeps its sentence in
          the open: it explains why the edge in front of you is grey. */}
      <p className="pp-t-caption pp-c-secondary">
        {edge.sensors} camera site{edge.sensors === 1 ? '' : 's'} on this edge
        {edge.sensors_direct < edge.sensors
          ? ` (${edge.sensors_direct} on it, the rest propagated)`
          : ''}
        .{' '}
        {judged ? (
          <>
            Inferred, not measured{' '}
            <InfoBadge label="How this edge's numbers are inferred" width={280}>
              Numbers are inferred from those sensors, spread along the street — not measured along
              all of it. It is never established cause.
            </InfoBadge>
          </>
        ) : (
          'One camera is speaking for the whole street, so this edge is not judged and draws grey.'
        )}
      </p>
    </div>
  );
}

/** "—" is the honest render for a null: the pipeline drops the percentage under
 *  5/hr forecast, and an unjudged edge never gets one at all. Neither is 0%. */
function devText(edge: Edge, s: EdgeSeries, weekHour: number, judged: boolean): string {
  if (!judged) return 'unjudged';
  const d = edge.dev[s]?.[weekHour];
  return d == null || !Number.isFinite(d) ? '—' : signedPct(d);
}
