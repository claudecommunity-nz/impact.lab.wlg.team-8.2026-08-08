/**
 * AREAS — episodes of movement deviation inside hazard footprints, and the
 * register of footprints nothing could have been detected in.
 */
export { AreasView } from './AreasView';
export {
  applyFilter,
  findEpisodes,
  FILTERS,
  EPISODE_MIN_HOURS,
  EPISODE_THRESHOLD_PCT,
  type Episode,
  type EpisodeFilter,
  type EpisodeOptions,
} from './episodes';
