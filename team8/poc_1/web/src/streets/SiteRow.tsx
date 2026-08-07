/**
 * One site, and — when opened — the countlines it is made of.
 *
 * Memoised on (row, rank, expanded, current, selectedCi, seriesKey). The hour
 * is deliberately NOT in that set: the playback cursor is one absolutely
 * positioned line over the trace column, so a tick touches one element rather
 * than one per row, and the table stays inert while the day runs.
 *
 * The parent row is the sum; the child rows are everything the sum averaged
 * away — which direction, which lane, how long the sensor has existed. The
 * install date on a child row is where the Aro St correction lives.
 */

import { memo } from 'react';
import { DiagnosisChip, TwinDotGlyph, VitalsTrace, glyphAlt } from '../ui';
import { CAVEAT_LABEL } from '../panels/evidence';
import { signedPct } from '../copy/strings';
import { HOURS, type DayModel, type LineView, type SiteSeriesKey, type SiteView } from '../data/derive';
import { thresholds } from '../theme/foundations';
import type { CountlineIndex, Mode } from '../data/types';
import {
  deltaLabel,
  discriminatorOf,
  memberSeries,
  memberVehicle,
  traceSummary,
  type StreetRow,
} from './model';

/**
 * VitalsTrace pads 10px at the top and 10px at the bottom whatever height it is
 * given, so a 28px SVG has 8px of plot left and every day looks like a flat
 * line. These are viewBox heights: CSS compresses the box back to the row
 * scale, which keeps the padding proportional and the amplitude legible.
 * Delete both once the `density` prop lands in ui/.
 */
const TRACE_VIEW = 64;
const TRACE_VIEW_CHILD = 48;

export interface SiteRowProps {
  row: StreetRow;
  /** null in the not-scored section, which has no rank to give. */
  rank: number | null;
  seriesKey: SiteSeriesKey;
  model: DayModel;
  index: CountlineIndex;
  refused: boolean;
  expanded: boolean;
  /** the live selection lands somewhere inside this site */
  current: boolean;
  selectedCi: number | null;
  onToggle: (siteId: string) => void;
  onSelect: (ci: number) => void;
  onHover: (ci: number | null) => void;
}

function SiteRowImpl({
  row,
  rank,
  seriesKey,
  model,
  index,
  refused,
  expanded,
  current,
  selectedCi,
  onToggle,
  onSelect,
  onHover,
}: SiteRowProps) {
  const { site, stat } = row;
  const scored = row.delta !== null && !refused;
  const ramped = scored && !row.belowFloor;
  const childIds = site.members.map((l) => `pp-st-c-${site.siteId}-${l.ci}`).join(' ');

  return (
    <>
      <tr
        role="row"
        className="pp-st__row"
        data-site={site.siteId}
        data-current={current}
        data-no-baseline={stat.basis === 0}
        aria-current={current ? 'true' : undefined}
        onClick={() => onSelect(row.primaryCi)}
        onMouseEnter={() => onHover(row.primaryCi)}
        onMouseLeave={() => onHover(null)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(row.primaryCi);
          }
        }}
      >
        <td role="cell" className="pp-st__c-disclose">
          <button
            type="button"
            className="pp-st__chev"
            aria-expanded={expanded}
            aria-controls={childIds}
            aria-label={`${expanded ? 'Hide' : 'Show'} the ${site.members.length} countlines at ${site.name}`}
            data-open={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(site.siteId);
            }}
          >
            ▾
          </button>
        </td>
        <td role="cell" className="pp-st__c-rank pp-t-mono-sm pp-c-muted">
          {rank ?? ''}
        </td>
        <td role="cell" className="pp-st__c-name pp-t-body" title={site.name}>
          {site.name}
        </td>
        <td role="cell" className="pp-st__c-trace">
          <VitalsTrace
            actual={site.series[seriesKey].actual}
            expected={site.series[seriesKey].expected}
            gaps={site.gaps}
            height={TRACE_VIEW}
            ariaSummary={traceSummary(row, seriesKey, refused)}
          />
        </td>
        <td
          role="cell"
          className="pp-st__c-delta pp-t-mono-sm"
          data-dir={ramped ? ((row.delta ?? 0) < 0 ? 'down' : 'up') : undefined}
          data-flat={scored && row.belowFloor}
          data-words={!scored}
          title={
            row.belowFloor && scored
              ? 'Under ~20 movements an hour — the number stands, the colour does not.'
              : (row.unscoredReason ?? undefined)
          }
        >
          {deltaLabel(row, refused)}
        </td>
        <td role="cell" className="pp-st__c-dx">
          <DiagnosisChip code={site.code} confidence={site.confidence} compact />
        </td>
        <td
          role="cell"
          className="pp-st__c-lines pp-t-mono-sm"
          title={`${stat.basis} of ${site.members.length} countlines here have a baseline for this series`}
        >
          {stat.basis}/{site.members.length}
        </td>
        <td
          role="cell"
          className="pp-st__c-cov pp-t-mono-sm"
          data-partial={site.hoursReported < HOURS}
          title={`${site.hoursReported} of 24 hours delivered by the feed`}
        >
          {site.hoursReported}/24
        </td>
      </tr>

      {expanded &&
        site.members.map((l) => (
          <ChildRow
            key={l.ci}
            id={`pp-st-c-${site.siteId}-${l.ci}`}
            line={l}
            seriesKey={seriesKey}
            model={model}
            index={index}
            refused={refused}
            selected={selectedCi === l.ci}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}

      {expanded && <CaveatRow site={site} seriesKey={seriesKey} model={model} />}
    </>
  );
}

export const SiteRow = memo(SiteRowImpl);

/* ------------------------------------------------------------------ child */

function ChildRow({
  id,
  line,
  seriesKey,
  model,
  index,
  refused,
  selected,
  onSelect,
  onHover,
}: {
  id: string;
  line: LineView;
  seriesKey: SiteSeriesKey;
  model: DayModel;
  index: CountlineIndex;
  refused: boolean;
  selected: boolean;
  onSelect: (ci: number) => void;
  onHover: (ci: number | null) => void;
}) {
  const series = memberSeries(model, line.i, seriesKey);
  let expSum = 0;
  for (let h = 0; h < HOURS; h++) expSum += series.expected[h];

  const gaps: Array<[number, number]> = [];
  for (let h = 0; h < HOURS; h++) {
    if (model.reported[line.i * HOURS + h]) continue;
    const start = h;
    while (h < HOURS && !model.reported[line.i * HOURS + h]) h++;
    gaps.push([start, h]);
  }
  let hoursReported = 0;
  for (let h = 0; h < HOURS; h++) hoursReported += model.reported[line.i * HOURS + h];

  const modeStat = seriesKey === 'total' ? null : line.record.modes[seriesKey as Mode];
  const delta = refused
    ? null
    : modeStat
      ? modeStat.viable
        ? modeStat.delta_pct
        : null
      : line.record.delta_pct;
  /**
   * The same gate the parent row applies, which the child did not have.
   * Expanding Paterson St — the demo's showcase expansion — printed
   * "path right hand side −97.3%" for a countline whose pipeline diagnosis is
   * `no_baseline`, whose confidence is `low`, and which delivered 6 of 24
   * hours. A parent row is careful never to hand out a number it has not
   * earned; a child sitting under it must be too. The figure survives in the
   * cell's title, because suppressing it is a display decision, not a claim
   * that it does not exist.
   */
  const entitled = line.confidence >= 2 && line.record.diagnosis !== 'no_baseline';
  const shown = delta !== null && entitled;
  const label = refused
    ? '—'
    : expSum <= 0
      ? 'no baseline'
      : delta === null
        ? modeStat
          ? 'not viable here'
          : 'no baseline'
        : entitled
          ? signedPct(delta, 1)
          : 'not scored';

  const ped = line.record.modes.pedestrian;
  const veh = memberVehicle(line.record);
  const dot = (viable: boolean, d: number | null) =>
    !viable || d === null
      ? ('struck' as const)
      : d <= thresholds.diagnosis.collapsePct
        ? ('hollow' as const)
        : ('filled' as const);
  const pedDot = dot(ped.viable, ped.delta_pct);
  const vehDot = dot(veh.viable, veh.deltaPct);

  return (
    <tr
      role="row"
      id={id}
      className="pp-st__row pp-st__row--child"
      data-selected={selected}
      data-no-baseline={expSum <= 0}
      onClick={() => onSelect(line.ci)}
      onMouseEnter={() => onHover(line.ci)}
      onMouseLeave={() => onHover(null)}
    >
      <td role="cell" className="pp-st__c-indent" />
      <td role="cell" className="pp-st__c-name pp-t-caption" title={line.name}>
        {discriminatorOf(line.name)}
      </td>
      <td role="cell" className="pp-st__c-trace">
        <VitalsTrace
          actual={series.actual}
          expected={series.expected}
          gaps={gaps}
          height={TRACE_VIEW_CHILD}
          ariaSummary={`${line.name}. ${hoursReported} of 24 hours reported. ${
            expSum <= 0 ? 'No expected line — no comparable history.' : `Change ${label}.`
          }`}
        />
      </td>
      <td
        role="cell"
        className="pp-st__c-delta pp-t-mono-sm"
        data-dir={shown ? (delta < 0 ? 'down' : 'up') : undefined}
        data-flat={delta !== null && !entitled}
        data-words={!shown}
        title={
          delta !== null && !entitled
            ? `${signedPct(delta, 1)} — not scored: ${
                line.record.diagnosis === 'no_baseline' ? 'no usable baseline' : 'low confidence'
              }, ${hoursReported} of 24 hours reported`
            : undefined
        }
      >
        {label}
      </td>
      <td role="cell" className="pp-st__c-dx">
        <TwinDotGlyph
          pedestrian={pedDot}
          vehicle={vehDot}
          title={`this countline: ${glyphAlt(pedDot, vehDot)}`}
        />
      </td>
      <td
        role="cell"
        className="pp-st__c-lines pp-t-mono-sm"
        title={`${line.record.baseline_n} comparable days behind this countline · ${hoursReported} of 24 hours reported`}
      >
        n={line.record.baseline_n}
      </td>
      <td
        role="cell"
        className="pp-st__c-cov pp-t-mono-sm"
        title={`installed ${index.first_seen[line.ci]}`}
      >
        {shortDate(index.first_seen[line.ci])}
      </td>
    </tr>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2025-10-17' → '17 Oct'. The install date has to fit a 60px column. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
}

/**
 * Why the parent reads `2/3`, and what each member is carrying. Without this
 * the countline fraction is a mystery, which is the same as hiding it.
 */
function CaveatRow({
  site,
  seriesKey,
  model,
}: {
  site: SiteView;
  seriesKey: SiteSeriesKey;
  model: DayModel;
}) {
  const excluded = site.members.filter((l) => {
    const s = memberSeries(model, l.i, seriesKey);
    let sum = 0;
    for (let h = 0; h < HOURS; h++) sum += s.expected[h];
    return sum <= 0;
  });
  const caveats = site.members
    .map((l) => ({ name: discriminatorOf(l.name), text: l.record.caveats.map((c) => CAVEAT_LABEL[c] ?? c) }))
    .filter((c) => c.text.length > 0);

  if (excluded.length === 0 && caveats.length === 0) return null;
  return (
    <tr role="row" className="pp-st__row pp-st__row--notes">
      <td role="cell" className="pp-st__notes pp-t-caption pp-c-secondary">
        {excluded.length > 0 && (
          <p>
            Excluded from both sums ({excluded.length} of {site.members.length}): no baseline for{' '}
            {excluded.map((l) => discriminatorOf(l.name)).join(', ')}. Observed and expected always
            cover the same members and the same hours.
          </p>
        )}
        {caveats.map((c) => (
          <p key={c.name}>
            {c.name} — {c.text.join(' · ')}
          </p>
        ))}
      </td>
    </tr>
  );
}
