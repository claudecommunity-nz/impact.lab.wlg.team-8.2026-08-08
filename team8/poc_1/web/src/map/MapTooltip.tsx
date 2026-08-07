/**
 * A fixed corner readout rather than a cursor-following tooltip: an instrument
 * has a readout panel, and it means the numbers stay still long enough to be
 * read from the back of the room. Reads SelectionContext only, so hovering
 * never re-renders the map.
 *
 * It describes the SITE, because the site is what the map draws. It used to
 * resolve the picked site to `representativeCi` — its busiest countline — and
 * then render that one member's name, counts and caveats as though they were
 * the mark's. Click a 9-countline camera and you got a ninth of the evidence
 * labelled as all of it, with only that member's caveats. The member is still
 * here; it is now a labelled sub-block that says which of how many it is.
 *
 * `site.caveats` is the worst-first union built in derive.ts so that "a site
 * never reads cleaner than its dirtiest member". This is the first place in the
 * app that actually renders it.
 */

import { useAppState, useSelection } from '../state/app';
import { useData } from '../data/DataProvider';
import { HOURS, ROLE_SERIES, type SiteSeriesKey, type SiteView } from '../data/derive';
import { signedPct } from '../copy/strings';
import { DiagnosisChip } from '../ui';
import { CAVEAT_LABEL, cellState } from '../panels/evidence';
import { VFULL } from './layers';

const nz = (v: number) => Math.round(v).toLocaleString('en-NZ');

/** Height clips at VFULL with no marker on the column, so a 2,400/hr case and a
 *  6,996/hr case are the same 200px. ColumnLayer cannot draw a floating plate
 *  above its own top, so the admission goes where it costs nothing: on the
 *  figure. 39 of 4,704 site-role-hours on 23 Oct, across 7 sites — but three of
 *  them are the busiest pedestrian sites in the CBD, in the hero frame. */
const Figure = ({ v }: { v: number }) => (
  <span>
    {nz(v)}
    {v > VFULL && (
      <span className="pp-map__clip" title={`above ${nz(VFULL)}/hr — the column is clipped here`}>
        {' '}
        ▲
      </span>
    )}
  </span>
);

function Row({ label, site, key_, hour }: { label: string; site: SiteView; key_: SiteSeriesKey; hour: number }) {
  const { model } = useData();
  if (!model) return null;
  const g = model.siteGrid;
  const k = site.s * HOURS + hour;
  const exp = g.expected[key_][k];
  if (exp <= 0) return null;
  const d = g.delta[key_][k];
  return (
    <>
      <span className="pp-c-secondary">{label}</span>
      <Figure v={g.actual[key_][k]} />
      <Figure v={exp} />
      <span>{Number.isFinite(d) ? signedPct(d) : '—'}</span>
    </>
  );
}

export function MapTooltip() {
  const { hovered, selected } = useSelection();
  const { hour } = useAppState();
  const { model } = useData();
  const ci = hovered ?? selected;
  if (!model || ci == null) return null;
  const line = model.byCi.get(ci);
  const siteId = model.siteOfCi.get(ci);
  const site = siteId == null ? undefined : model.bySiteId.get(siteId);
  if (!line || !site) return null;

  const k = line.i * HOURS + hour;
  const state = cellState(model, line, hour);
  const d = model.delta[k];
  const reported = model.siteGrid.reported[site.s * HOURS + hour] === 1;

  return (
    <div className="pp-map__readout">
      <div className="pp-map__readout-head">
        <span className="pp-t-h3">{site.name}</span>
        <span className="pp-t-mono-sm pp-c-muted">
          camera {site.siteId} · {site.members.length} countline
          {site.members.length === 1 ? '' : 's'} · {String(hour).padStart(2, '0')}:00
        </span>
      </div>

      {reported ? (
        <div className="pp-map__readout-grid pp-map__readout-grid--4 pp-t-mono-sm">
          <span className="pp-c-secondary pp-t-label">at this hour</span>
          <span className="pp-c-secondary pp-t-label">obs</span>
          <span className="pp-c-secondary pp-t-label">usual</span>
          <span className="pp-c-secondary pp-t-label">Δ</span>
          <Row label="all" site={site} key_="total" hour={hour} />
          <Row label="people" site={site} key_={ROLE_SERIES.ped} hour={hour} />
          <Row label="vehicles" site={site} key_={ROLE_SERIES.veh} hour={hour} />
        </div>
      ) : (
        <p className="pp-t-caption pp-c-secondary">
          This camera delivered no row for this hour. That is missing data, not missing people.
        </p>
      )}

      <DiagnosisChip code={site.code} confidence={site.confidence} compact />
      {/* The site's caveats, not the dominant member's — worst first. */}
      {site.caveats.length > 0 && (
        <p className="pp-t-caption pp-c-secondary">
          {site.caveats.map((c) => CAVEAT_LABEL[c] ?? c).join(' · ')}
        </p>
      )}

      <div className="pp-map__readout-member">
        <p className="pp-t-caption pp-c-muted">
          showing 1 of {site.members.length} countline{site.members.length === 1 ? '' : 's'} at this
          camera
        </p>
        <p className="pp-t-caption">
          <span className="pp-t-mono-sm">{line.name}</span> · countline {line.id} ·{' '}
          {state === 'offline' ? 'not reported' : `${nz(model.actual[k])} observed`}
          {Number.isFinite(d) ? ` · ${signedPct(d)}` : ''} · n={line.record.baseline_n}
        </p>
        {STATE_COPY[state] && (
          <p className="pp-t-caption pp-c-secondary">{STATE_COPY[state]}</p>
        )}
      </div>
    </div>
  );
}

const STATE_COPY: Record<ReturnType<typeof cellState>, string> = {
  offline: 'This countline reported nothing this hour. Missing data, not missing people.',
  zero: 'This countline reported, and the count was genuinely zero. A real measurement.',
  unscorable: 'Reported, but the baseline is too thin to score. We can see, we cannot judge.',
  scored: '',
  suppressed: 'This day is not being assessed. Coverage was too poor to look at.',
};
