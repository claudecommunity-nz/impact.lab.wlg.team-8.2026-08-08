/**
 * The modular feed layer: advisement feeds, risk-area feeds, and the join.
 * WeekView is the only file allowed to know these exist — swapping a source is
 * an edit to the pipeline registry and nothing else.
 */
import './watch.css';

export { AreaRiskCard, type AreaRiskCardProps } from './AreaRiskCard';
export { FeedRoster, type FeedRosterProps } from './FeedRoster';
export { useFeeds } from './useFeeds';
export {
  advisementsFrom,
  coverageNote,
  leadArea,
  rankAreas,
  statementFor,
  warningAt,
  AREA_DEADBAND_PCT,
  type RankedArea,
  type AreaStatement,
} from './model';
export type {
  AdvisementFeed,
  AreaRiskFile,
  AreaSeries,
  FeedBundle,
  FeedIndex,
  RiskArea,
} from './types';
