/**
 * AREAS — what has been flagged inside a hazard footprint, for how long, and
 * whether anything on file explains it.
 *
 * The week tab reads one hour: "movement inside this zone is −38% right now".
 * That is a reading. This tab reads runs of hours, so the same measurement
 * becomes an incident with a start, a duration and a state — and, crucially, a
 * CAUSE LINE that is either a feed's own words or an explicit statement that
 * nothing on file explains it. The unexplained drop inside a hazard footprint
 * is the output this whole project argues for: another early indication of
 * where an event may be affecting people, rather than waiting for someone to
 * ring it in.
 *
 * The deviation is measured. The cause is never inferred. The six footprints
 * with no camera inside them are listed as UNWATCHED, not omitted and not
 * scored as calm.
 */

import { useMemo, useState } from 'react';
import { InfoBadge } from '../ui';
import { signedPct } from '../copy/strings';
import { useAppState } from '../state/app';
import { edgeSeriesFor } from '../week/model';
import { advisementsFrom, useFeeds } from '../week/watch';
import type { AreaSeries, RiskArea } from '../week/watch/types';
import {
  applyFilter,
  findEpisodes,
  FILTERS,
  EPISODE_THRESHOLD_PCT,
  type Episode,
  type EpisodeFilter,
} from './episodes';
import {
  barPct,
  causeOf,
  countsOf,
  durationOf,
  hazardsOf,
  hoursLabelOf,
  overlapLineOf,
  rangeLabelOf,
  sentenceOf,
  spreadLabelOf,
  stampOf,
} from './copy';
import './areas.css';

export function AreasView() {
  const bundle = useFeeds();
  const { weekHour, mode } = useAppState();
  const [filter, setFilter] = useState<EpisodeFilter>('all');

  const file = bundle?.areaRisk ?? null;
  const series: AreaSeries = edgeSeriesFor(mode);
  const advisements = useMemo(() => advisementsFrom(bundle), [bundle]);

  const episodes = useMemo(
    () =>
      file
        ? findEpisodes({
            areas: file.areas,
            series,
            cursorHour: weekHour,
            confirmedHours: file.confirmed_hours,
            weekStart: file.week_start,
            advisements,
          })
        : [],
    [file, series, weekHour, advisements],
  );

  const shown = useMemo(() => applyFilter(episodes, filter), [episodes, filter]);

  if (!file) {
    return (
      <div className="pp-areas">
        <p className="pp-t-body pp-c-secondary">Loading hazard-area movement…</p>
      </div>
    );
  }

  // Never past the confirmed horizon: after hour 96 there is no actual, so
  // there is no deviation and nothing can be flagged.
  const cursor = Math.min(weekHour, file.confirmed_hours - 1);
  const caption = `${episodes.length} alert${episodes.length === 1 ? '' : 's'} · week to ${stampOf(
    file.week_start,
    cursor,
  )} · newest first`;

  return (
    <div className="pp-areas">
      <div className="pp-areas__feed">
        <div className="pp-areas__head">
          <h2 className="pp-t-h3">Alerts inside risk areas</h2>
          <span className="pp-t-mono-sm pp-c-muted">{caption}</span>
          <InfoBadge label="What counts as an alert here" width={320}>
            <span className="pp-areas__pop">
              <span>
                An alert is a run of {EPISODE_THRESHOLD_PCT}% or more deviation from forecast,
                in the same direction, for two hours or more, inside one hazard footprint.
              </span>
              <span>
                Measured against a same-weekday same-hour forecast, out of sample. The feed
                is T+1 — the newest confirmed hour is {stampOf(file.week_start, file.confirmed_hours - 1)},
                and nothing after it can be flagged because nothing after it has been observed.
              </span>
              <span>{file.method.inference}</span>
            </span>
          </InfoBadge>
          <span className="pp-areas__spacer" />
          <div className="pp-areas__filters" role="group" aria-label="Filter alerts">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="pp-areas__filter pp-t-label"
                data-on={f.key === filter}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="pp-areas__empty pp-t-body pp-c-secondary">
            {episodes.length === 0
              ? 'No run of hours past the threshold inside any watched hazard area this week. Six of nine footprints have no camera inside them, so this is not the same as nothing having happened.'
              : 'No alert matches this filter.'}
          </p>
        ) : (
          <ul className="pp-areas__list">
            {shown.map((e) => (
              <AlertRow key={`${e.area.id}-${e.start}`} e={e} weekStart={file.week_start} />
            ))}
          </ul>
        )}
      </div>

      <Coverage
        areas={file.areas}
        series={series}
        hour={cursor}
        judged={file.n_areas_judged}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ alert */

function AlertRow({ e, weekStart }: { e: Episode; weekStart: string }) {
  const cause = causeOf(e);
  const dir = e.sign < 0 ? 'down' : 'up';
  const lo = barPct(e.min);
  const hi = barPct(e.max);

  return (
    <li className="pp-alert" data-dir={dir}>
      <div className="pp-alert__when">
        <div className="pp-t-mono-sm pp-alert__start">{stampOf(weekStart, e.start)}</div>
        <div className="pp-t-mono-sm pp-c-muted">→ {stampOf(weekStart, e.end)}</div>
        <div className="pp-t-mono-sm pp-c-muted pp-alert__dur">{durationOf(e)}</div>
        {e.ongoing && (
          <div className="pp-t-label pp-alert__state" data-dir={dir}>
            Still flagged
          </div>
        )}
      </div>

      <div className="pp-alert__body">
        <p className="pp-alert__claim">
          <span className="pp-t-metric pp-alert__peak" data-dir={dir}>
            {signedPct(e.peak)}
          </span>
          <span className="pp-t-body-lg pp-alert__zone">{e.area.class}</span>
        </p>
        <p className="pp-t-body pp-alert__sentence">{sentenceOf(e)}</p>
        <ul className="pp-alert__chips">
          {hazardsOf(e.area).map((h) => (
            <li key={h} className="pp-alert__chip pp-t-mono-sm">
              {h}
            </li>
          ))}
        </ul>
        <p className="pp-t-caption pp-c-muted">{countsOf(e)}</p>
        <p className="pp-t-caption pp-c-muted">{overlapLineOf(e)}</p>
        <p className="pp-alert__cause pp-t-body" data-unexplained={cause.unexplained}>
          {cause.text}
          {cause.handEntered && <span className="pp-alert__badge pp-t-label">hand-entered</span>}
        </p>
      </div>

      <div className="pp-alert__bar">
        <div className="pp-t-label pp-c-muted">Deviation while flagged</div>
        <div className="pp-alert__track">
          <span className="pp-alert__centre" aria-hidden="true" />
          <span
            className="pp-alert__span"
            data-dir={dir}
            style={{ left: `${lo}%`, width: `${Math.max(hi - lo, 0.6)}%` }}
          />
          <span
            className="pp-alert__marker"
            data-dir={dir}
            style={{ left: `${barPct(e.peak)}%` }}
          />
        </div>
        <div className="pp-alert__scale pp-t-mono-sm pp-c-muted">
          <span>−80%</span>
          <span>on forecast</span>
          <span>+80%</span>
        </div>
        <div className="pp-t-mono-sm pp-alert__range" data-dir={dir}>
          {rangeLabelOf(e)}
        </div>
        <div className="pp-t-mono-sm pp-c-muted">{spreadLabelOf(e)}</div>
        <div className="pp-t-mono-sm pp-c-muted">{hoursLabelOf(e)}</div>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- coverage */

/**
 * Six of nine footprints have no camera inside them. They are listed with an
 * em dash and the words "unwatched, not quiet" rather than a zero, because a
 * zero here would read as "nothing happening" — the single most dangerous
 * thing this screen could say.
 */
function Coverage({
  areas,
  series,
  hour,
  judged,
}: {
  areas: RiskArea[];
  series: AreaSeries;
  hour: number;
  judged: number;
}) {
  const rows = [...areas].sort(
    (a, b) => Number(b.judged) - Number(a.judged) || a.class_rank - b.class_rank,
  );

  return (
    <aside className="pp-areas__coverage">
      <h2 className="pp-t-h3">Area coverage</h2>
      <p className="pp-t-mono-sm pp-c-muted pp-areas__coverage-sub">
        {areas.length} hazard areas · {judged} judgeable
      </p>
      <ul className="pp-cov">
        {rows.map((a) => {
          const dev = a.judged ? (a.dev?.[series][hour] ?? null) : null;
          const state = a.sites === 0 ? 'unwatched' : a.judged ? 'watched' : 'thin';
          return (
            <li key={a.id} className="pp-cov__row" data-state={state}>
              <span className="pp-cov__dot" data-state={state} aria-hidden="true" />
              <span className="pp-cov__names">
                <span className="pp-t-body pp-cov__name">{a.class}</span>
                <span className="pp-t-mono-sm pp-c-muted">
                  {a.sites === 0
                    ? 'no camera inside — unwatched, not quiet'
                    : `${a.sites} camera${a.sites === 1 ? '' : 's'} · ${a.n_streets} street${
                        a.n_streets === 1 ? '' : 's'
                      } · ${a.name}`}
                </span>
              </span>
              <span
                className="pp-cov__dev pp-t-mono-sm"
                data-dir={dev == null ? 'none' : dev < 0 ? 'down' : 'up'}
              >
                {dev == null ? '—' : signedPct(dev)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="pp-t-caption pp-c-muted pp-areas__foot">
        Areas overlap: one movement can sit inside three footprints at once, so a single drop
        can raise three alerts. The feed does not de-duplicate them — each area is judged on
        its own exposure.
      </p>
    </aside>
  );
}
