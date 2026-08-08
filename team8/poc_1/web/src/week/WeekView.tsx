/**
 * Band C — three columns: what is expected, what is happening, what is off.
 *
 * A real grid, not the old float-over-the-map layout. The rails used to be
 * absolutely positioned cards ON the instrument, which works when the
 * instrument is the whole story; here the left column is a briefing document
 * and a briefing document that occludes the map is just a worse map.
 *
 * The centre cell is the map component's business. This file gives it a
 * relatively-positioned box and gets out of the way.
 */

import { useData } from '../data/DataProvider';
import { useAppState, HOURS_PER_DAY } from '../state/app';
import { MapCanvas } from '../map/MapCanvas';
import { goToRoute } from '../nav/route';
import { ForecastCard } from './ForecastCard';
import { WatchFeed } from './WatchFeed';
import { EdgeDeviationList } from './EdgeDeviationList';
import { StandingConditions } from './StandingConditions';
import { AreaRiskCard, FeedRoster, advisementsFrom, useFeeds, warningAt } from './watch';
import { edgesByDeviation, edgeSeriesFor } from './model';

/** Five, not six. Six pushed "Standing conditions" — the card that says which
 *  of these numbers you should not trust — entirely below the fold at 900px,
 *  and the rest are one click away on Streets. */
/** Four, not five. The area-risk card took the top of the right column and it
 *  is the higher-altitude read of the same signal — which zone, before which
 *  street. The rest are one click away on Streets. */
const TOP_N = 4;

export function WeekView() {
  const { week, edges } = useData();
  const { weekHour, mode } = useAppState();
  // The feed layer loads on its own so a missing or broken source cannot take
  // the instrument down with it. Everything below already handles null.
  const feeds = useFeeds();

  const day = week?.days[Math.floor(weekHour / HOURS_PER_DAY)];
  const at = day
    ? `${day.short} ${String(weekHour % HOURS_PER_DAY).padStart(2, '0')}:00`
    : '—';

  // Past the newest confirmed hour there is no actual, so the cards below have
  // nothing to deviate FROM. Both used to fall through to their in-horizon
  // empty state and invent a specific, false reason for their own silence —
  // "most streets fall under the volume floor", "no hazard area has enough
  // cameras" — on the three days of the week that have not happened yet.
  const beyondHorizon = week != null && weekHour >= week.confirmed_hours;

  const series = edgeSeriesFor(mode);
  const rows = edges ? edgesByDeviation(edges.edges, series, weekHour, TOP_N) : [];

  // The only place in the app that knows where an advisement came from. The
  // week artefact derives its own from the WCC closure layer; the feed adapters
  // add theirs. Swapping a source is one registry line in the pipeline.
  const advisements = [...(week?.advisements ?? []), ...advisementsFrom(feeds)];

  // Only a warning in force licenses reading a drop as compliance. The join
  // between the two feed kinds is made here, not inside the card, because the
  // card must not know which sources exist.
  const warning = week ? warningAt(advisements, week.week_start, weekHour) : null;

  return (
    <div className="pp-week">
      <aside className="pp-week__col pp-week__col--left">
        <ForecastCard />
        <WatchFeed
          items={advisements}
          note={feeds?.index.advisements_note ?? week?.advisements_note}
        />
        <FeedRoster
          feeds={feeds?.index.advisement_feeds ?? []}
          note="A feed that returns nothing has to say why. Silence from a connected source and a source we never connected are different facts."
        />
      </aside>

      <div className="pp-week__map">
        <MapCanvas />
      </div>

      <aside className="pp-week__col pp-week__col--right">
        {/* Above the edge list on purpose: "does this deviation matter" is a
            higher-altitude question than "which street is it on". */}
        <AreaRiskCard
          file={feeds?.areaRisk ?? null}
          series={series}
          weekHour={weekHour}
          at={at}
          warning={warning}
          beyondHorizon={beyondHorizon}
        />
        <EdgeDeviationList
          rows={rows}
          at={at}
          beyondHorizon={beyondHorizon}
          dayLabel={day?.weekday}
          onAll={() => goToRoute('streets')}
        />
        {/* Collapsed by default. It is the third card in a 524px column and at
            full height it took the edge list — the payoff for the map — off
            screen entirely. Its title and count stay visible, which is what a
            caveat card needs; the rows are one click away. */}
        <StandingConditions
          items={week?.standing_conditions ?? []}
          note="Absence of an anomaly means nothing. Most of Wellington has no sensor on it at all."
        />
      </aside>
    </div>
  );
}
