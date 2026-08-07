/**
 * DiagnosisPanel (2896px) and CoveragePanel (1150px) merged into one 480px
 * card. Both were answering the same question — what can this thing actually
 * see, and how much of what it says should you believe — from two rails apart.
 *
 * The counts list stays first and `cannot_type` stays at the top of it. That is
 * the admission-before-finding order: most of the city cannot be typed at all,
 * and you should read that before you read a diagnosis. It is not negotiable
 * and it is not behind a disclosure.
 *
 * The census counts SITES. It counted countlines, sitting beside a map that
 * draws sites, and published a different census from the Streets tab's: the
 * same day read "exposure hazard 46, 12%" here and "43" there, with no unit on
 * either, so exposure hazard was 12% of the city or 36% of it depending on
 * which tab you screenshotted. A panel's numbers have to describe the marks
 * next to it. The countline census survives one line down, labelled, because
 * the two are genuinely different quantities.
 *
 * CoveragePanel's Callout was deleted, not moved: its text is `sparse_coverage`
 * from the manifest, which is already in the provenance footer on both tabs and
 * in the landing modal's limits — verified before deleting, not after.
 */

import { useMemo } from 'react';
import { DiagnosisChip, Legend, Panel } from '../ui';
import { useAppState } from '../state/app';
import { useData } from '../data/DataProvider';
import { coverageAtHour } from '../data/derive';
import { DIAGNOSIS, honesty, MODE_LABEL } from '../copy/strings';
import { thresholds } from '../theme/foundations';
import {
  CODE_FOR_KEY,
  DIAGNOSIS_KEYS,
  MODES,
  type DiagnosisCode,
  type DiagnosisKey,
} from '../data/types';

const HONEST_KEYS: DiagnosisKey[] = ['cannot_type', 'no_baseline', 'not_observed'];

export function ConfidencePanel() {
  const { hour } = useAppState();
  const { model } = useData();
  const siteCounts = useMemo(() => {
    const n = new Map<DiagnosisCode, number>();
    for (const site of model?.sites ?? []) n.set(site.code, (n.get(site.code) ?? 0) + 1);
    return n;
  }, [model]);
  if (!model) return null;

  const lineCounts = model.file.summary.diagnosis_counts;
  const total = model.nSites;
  const cov = coverageAtHour(model, hour);
  const s = model.file.summary;

  const Count = ({ k, confident }: { k: DiagnosisKey; confident: boolean }) => {
    const n = siteCounts.get(CODE_FOR_KEY[k]) ?? 0;
    if (n === 0) return null;
    return (
      <li className="pp-dxlist__count">
        <DiagnosisChip code={CODE_FOR_KEY[k]} confidence={confident ? 2 : 0} compact />
        <span className="pp-t-mono-sm pp-dxlist__n">{n}</span>
        <span className="pp-t-caption pp-c-secondary">{Math.round((n / total) * 100)}%</span>
      </li>
    );
  };

  return (
    <Panel
      title="What we can see"
      // The unit rides the subtitle rather than a line of its own: the rails
      // are on a fixed height budget and a census without a unit was the defect.
      subtitle={`${total} camera sites · ${honesty.inferenceShort.toLowerCase()}`}
      tone={model.refused ? 'blind' : 'default'}
    >
      <ul className="pp-dxlist pp-dxlist--counts">
        {HONEST_KEYS.map((k) => (
          <Count key={k} k={k} confident={false} />
        ))}
        {DIAGNOSIS_KEYS.filter((k) => !HONEST_KEYS.includes(k)).map((k) => (
          <Count key={k} k={k} confident />
        ))}
      </ul>

      {/* Absorbed from SituationPanel, where these were the third and fourth
          tile on a card whose job is one number. */}
      {/* Caption, not mono: mono is wide enough that this wrapped to two lines
          and cost the rail its last 17px. */}
      <p className="pp-t-caption pp-c-secondary">
        {cov.reported}/{model.n} countlines at {String(hour).padStart(2, '0')}:00 ·{' '}
        {s.lines_unscorable} unjudgeable
      </p>

      <details className="pp-disclose">
        <summary className="pp-t-label">How to read the map</summary>
        <Legend
          title="Change against expected"
          scale={{ kind: 'gradient', from: -100, to: 50 }}
          note={`Changes under ${thresholds.deadZonePct}% are not shown as change. Above +50% the ramp clamps, so one outlier cannot hijack the scale. Below ~${thresholds.minExpectedPerHour} expected trips an hour a percentage is arithmetic about a handful of people; those marks keep their height and lose their colour.`}
        />
        <Legend
          title="What the map can and cannot see"
          scale={{
            kind: 'categorical',
            items: [
              {
                label: 'Sensor offline',
                token: 'sem-offline',
                note: 'no row delivered — missing data, not missing people',
                pattern: 'hatch',
              },
              {
                label: 'A genuine zero',
                token: 'sem-zero-observed',
                note: 'the sensor reported, and nothing moved',
              },
              {
                label: 'Cannot judge',
                token: 'sem-unknown',
                note: 'reported, but the baseline is too thin to score',
              },
              {
                label: 'Expected',
                token: 'sem-ghost',
                note: 'the ghost: the city as it should have been',
              },
            ],
          }}
        />
        <p className="pp-t-label pp-c-secondary">Lines with a usable baseline, per mode</p>
        <ul className="pp-cov">
          {MODES.map((m) => (
            <li key={m} className="pp-cov__row">
              <span className="pp-t-body">{MODE_LABEL[m]}</span>
              <span className="pp-cov__bar">
                <span
                  className="pp-cov__fill"
                  data-mode={m}
                  style={{ width: `${(model.viableCount[m] / model.n) * 100}%` }}
                />
              </span>
              <span className="pp-t-mono-sm">
                {model.viableCount[m]}/{model.n}
              </span>
            </li>
          ))}
        </ul>
        {/* The other census, labelled. A site is typed from its own summed
            counts, not voted from its members, so the two disagree — 46 sites
            against 46 countlines is a coincidence, not a check. */}
        <p className="pp-t-caption pp-c-secondary">
          Counted per countline instead, the same day reads:{' '}
          {DIAGNOSIS_KEYS.filter((k) => lineCounts[k] > 0)
            .map((k) => `${DIAGNOSIS[CODE_FOR_KEY[k]].short} ${lineCounts[k]}`)
            .join(' · ')}{' '}
          — of {model.n} countlines, which the map groups into {total} camera sites.
        </p>
        <p className="pp-t-caption pp-c-secondary">
          {model.file.coverage.note} A line needs both a pedestrian and a car baseline before it can
          be typed at all. Most do not have one.
        </p>
      </details>
    </Panel>
  );
}
