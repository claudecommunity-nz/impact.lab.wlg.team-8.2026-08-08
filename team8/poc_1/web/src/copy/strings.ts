/**
 * Every user-facing string. Centralised so the honesty statements cannot drift,
 * get softened in a hurry, or go missing from one panel.
 *
 * The organisers asked for limitations to be visible. These are load-bearing.
 */

import type { ColorToken } from '../theme/palettes';
import { DiagnosisCode, type Mode } from '../data/types';

/**
 * U+2212 minus, never a hyphen.
 *
 * Capped at ±300%. Past that the percentage is arithmetic about a tiny
 * denominator, not a finding — rendering "+8280%" invites a reader to believe
 * a number the baseline cannot support.
 */
export const PCT_DISPLAY_CAP = 300;

export const signedPct = (v: number, digits = 0): string => {
  const sign = v < 0 ? '−' : '+';
  if (Math.abs(v) > PCT_DISPLAY_CAP) return `>${sign}${PCT_DISPLAY_CAP}%`;
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
};

export const honesty = {
  emergency: 'These are hazard-planning and after-action layers, not live emergency information. In an emergency, call 111.',
  latency: 'The feed is T+1. The newest movement data available is always yesterday. Nothing here is live detection.',
  coverage:
    'Coverage is sparse: 128 camera sites across the whole city. The absence of an anomaly means nothing.',
  manualWarning: 'Hand-entered from public reporting, not an automated feed. MetService publishes no warnings archive.',
  deadZone: 'Changes under 8% are not shown as change.',
  inference:
    'Inferred from the ratio of per-mode change alone. These are hypotheses to investigate, not confirmed causes — nothing here is checked against a closure or incident record.',
  /** The same claim at card-subtitle length. It sits BESIDE the chips, never
   *  behind a disclosure: "inferred" has to be readable at a glance or the
   *  chips read as verdicts. The full sentence stays in the explainer. */
  inferenceShort: 'inferred, not confirmed causes',
  /** The footer has one line at 1512 and the manifest's not_live is three
   *  sentences. Truncating a limitation with an ellipsis is worse than saying
   *  it shorter, so this is the footer's wording; the full text is in the
   *  explainer behind "Full limitations & attribution". */
  notLiveShort: 'Not live: the movement feed is T+1, so the newest thing it can know is yesterday.',
  refusalTitle: 'We could not see, so we are not calling it.',
  attribution: 'Movement data: Wellington City Council / VivaCity via Pōneke Travel Insights. GIS layers belong to their publishers (WCC, Greater Wellington, GNS Science, NIWA, Wellington Water, MBIE, NZTA, MetService); licences vary per dataset. Basemap © OpenStreetMap, © CARTO.',
} as const;

/**
 * The landing explainer. Layered on purpose: a duty officer gets one sentence
 * and three lines; anyone who wants the method opens the details.
 */
export const landing = {
  eyebrow: 'Wellington City Council · Emergency Management',
  // "…it shows up here first" claimed a primacy a T+1 feed cannot have — a duty
  // officer's phone is first, and this is the next morning. The image survives;
  // the claim does not.
  title: 'When a city stops moving, the next morning’s data shows it.',
  /** Pinned beside the CTA, not inside a collapsed disclosure. The first screen
   *  anyone sees is also the most shareable screenshot, and both required
   *  statements were below the fold on it. */
  footerNote: 'Not live — the feed is T+1. In an emergency, call 111.',
  // The week, not a single day. The product is a briefing artefact for the
  // seven days around you: four measured, three forecast, one horizon between
  // them. The old lede sold a one-day storm replay, which is now a side tab.
  lede: 'Pōneke Pulse forecasts how Wellington should move this week, hour by hour, and measures what actually turned up. Where the two diverge, something happened — or is about to.',

  forOfficer: {
    heading: 'If you are on duty',
    points: [
      'The map draws streets, not sites. Line WEIGHT is how much is moving; line COLOUR is how far that is from the forecast for this hour — oxblood short, teal over.',
      'Pedestrians and vehicles are read separately, and the per-mode signature says what kind of event it is. People gone but traffic holding is an exposure hazard; traffic gone but people walking is a road closure; both gone is loss of access.',
      'A drop under a warning you already issued is evidence the message landed. A drop with nothing scheduled against it is the one worth your time — and a RISE tells you where people are, which is where risk concentrates.',
      'The three days ahead are forecast. What is already scheduled — closures, events, berths — is what should move those numbers, so the week reads as a briefing rather than an alarm.',
    ],
  },

  howItWorks: {
    heading: 'How it works',
    body: 'For every sensor, direction, mode, weekday and hour we take the median of the trailing same-weekday-same-hours, and the spread around it. Public holidays and days when the feed failed are excluded from that baseline, so Christmas does not become the definition of normal. A street is only scored when it has enough history to be worth scoring — everything else renders as “cannot see”, never as calm.',
    // Only the keys that still do something on the week. The old line advertised
    // "1–5 jump between replay days" and "G toggles the expected overlay",
    // neither of which is a week control — a stale key hint reads as a broken
    // feature the moment someone presses it in front of a room.
    controls: 'Press play to run the week. Space plays and pauses, ← and → step an hour, 1–7 jump to a day, W and S switch between Week and Streets, Esc clears the selection, and P hides the side columns for presenting.',
  },

  limits: {
    heading: 'What it cannot do',
    points: [
      'This is not live. The feed arrives a day late, so the earliest this can tell you anything is the following morning.',
      'There are 128 camera sites across the whole city, carrying 398 countlines between them. Most streets have none. A quiet map is not a quiet city.',
      'Weather warnings shown here were typed in by hand from public reporting. MetService publishes no archive we could connect to.',
      'The diagnosis is inferred from the ratio of per-mode change alone. It is a hypothesis to investigate, never a confirmed cause.',
      // Was ContextPanel's footnote. It survived the declutter by moving here,
      // not by being deleted: "we kept no record" is itself a limitation.
      'No road-closure record was retained for the replay dates. An absence in the corroboration list is an absence of record, not evidence that nothing was closed.',
    ],
  },

  // The button now does exactly what it says. It used to read "Show me 23
  // October 2025" and dispatch a 2025 date that the week route's reconcile
  // effect immediately overwrote — so the one hero action on the first screen
  // of the demo landed you back where you started.
  cta: 'Show me this week',
  ctaNote: 'Four days measured, three forecast, and the hour the feed runs out marked on the chart.',
  dismiss: 'Explore on my own',
} as const;

export interface DiagnosisMeta {
  readonly code: DiagnosisCode;
  readonly label: string;
  readonly short: string;
  readonly token: ColorToken;
  /** The twin-dot glyph: does the mode hold up, collapse, or is it not viable? */
  readonly glyph: { pedestrian: DotState; vehicle: DotState };
}

/** filled = mode held up · hollow = mode collapsed · struck = not viable here */
export type DotState = 'filled' | 'hollow' | 'struck';

export const DIAGNOSIS: Record<DiagnosisCode, DiagnosisMeta> = {
  [DiagnosisCode.EXPOSURE]: {
    code: DiagnosisCode.EXPOSURE,
    label: 'Consistent with an exposure hazard — pedestrians fell first',
    short: 'Exposure hazard',
    token: 'dx-exposure',
    glyph: { pedestrian: 'hollow', vehicle: 'filled' },
  },
  [DiagnosisCode.ROAD_CLOSURE]: {
    code: DiagnosisCode.ROAD_CLOSURE,
    label: 'Consistent with a road closure — street still walkable',
    short: 'Road closure',
    token: 'dx-road-closure',
    glyph: { pedestrian: 'filled', vehicle: 'hollow' },
  },
  [DiagnosisCode.LOSS_OF_ACCESS]: {
    code: DiagnosisCode.LOSS_OF_ACCESS,
    label: 'Access reduced — both modes down together',
    short: 'Both modes down',
    token: 'dx-loss-of-access',
    glyph: { pedestrian: 'hollow', vehicle: 'hollow' },
  },
  [DiagnosisCode.PEOPLE_NOT_TRAFFIC]: {
    code: DiagnosisCode.PEOPLE_NOT_TRAFFIC,
    label: 'Consistent with closure to traffic, still open to people',
    short: 'Open to people',
    token: 'dx-people-not-traffic',
    glyph: { pedestrian: 'filled', vehicle: 'hollow' },
  },
  [DiagnosisCode.CANNOT_TYPE]: {
    code: DiagnosisCode.CANNOT_TYPE,
    label: 'Cannot type — insufficient multi-mode coverage',
    short: 'Cannot type',
    token: 'dx-cannot-type',
    glyph: { pedestrian: 'struck', vehicle: 'struck' },
  },
  [DiagnosisCode.ELEVATED]: {
    code: DiagnosisCode.ELEVATED,
    label: 'Elevated — more movement than expected',
    short: 'Elevated',
    token: 'sem-surplus',
    glyph: { pedestrian: 'filled', vehicle: 'filled' },
  },
  [DiagnosisCode.NORMAL]: {
    code: DiagnosisCode.NORMAL,
    label: 'Normal — moving as expected',
    short: 'Normal',
    token: 'sem-pulse-healthy',
    glyph: { pedestrian: 'filled', vehicle: 'filled' },
  },
  [DiagnosisCode.NO_BASELINE]: {
    code: DiagnosisCode.NO_BASELINE,
    label: 'No baseline — nothing to compare this sensor against',
    short: 'No baseline',
    token: 'sem-unknown',
    glyph: { pedestrian: 'struck', vehicle: 'struck' },
  },
  [DiagnosisCode.NOT_OBSERVED]: {
    code: DiagnosisCode.NOT_OBSERVED,
    label: 'Not observed — the day was not assessed',
    short: 'Not observed',
    token: 'sem-suppressed',
    glyph: { pedestrian: 'struck', vehicle: 'struck' },
  },
};

export const MODE_LABEL: Record<Mode, string> = {
  pedestrian: 'Pedestrian',
  cyclist: 'Cyclist',
  car: 'Car',
  bus: 'Bus',
  lgv: 'Light goods',
};

export const MODE_TOKEN: Record<Mode, ColorToken> = {
  pedestrian: 'mode-pedestrian',
  cyclist: 'mode-cyclist',
  car: 'mode-car',
  bus: 'mode-bus',
  lgv: 'mode-lgv',
};

export const CONFIDENCE_LABEL = ['no confidence', 'low confidence', 'confident'] as const;
