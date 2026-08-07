/**
 * Was DetailPanel. The right rail is selection-exclusive: when something is
 * selected this card renders alone and Confidence/Corroboration unmount, which
 * is what stops two cards becoming three in a 480px rail.
 *
 * All six evidence rows stay — observed/expected, Δ, robust z, baseline days,
 * hours reported, reporting rate. "Every anomaly surfaces its evidence" is a
 * requirement, not a layout preference, so this is the one card the declutter
 * pass was not allowed to shorten. What it gained instead is the site: the
 * sibling countlines on the same camera, behind a disclosure, because 386
 * countlines sit on ~123 places and the neighbours are usually the context.
 */

import { DiagnosisChip, Panel, VitalsTrace } from '../ui';
import { useAppState, useSelection } from '../state/app';
import { useData } from '../data/DataProvider';
import { HOURS } from '../data/derive';
import { MODE_LABEL, signedPct } from '../copy/strings';
import { MODES } from '../data/types';
import { CAVEAT_LABEL } from './evidence';

export function SelectionPanel() {
  const { selected, setSelected } = useSelection();
  const { hour } = useAppState();
  const { model, index } = useData();
  if (!model || !index) return null;

  const line = selected == null ? null : model.byCi.get(selected);
  if (!line) {
    return (
      <Panel title="Nothing selected">
        <p className="pp-t-caption pp-c-secondary">
          Click a site on the map, or a row in Streets.
        </p>
      </Panel>
    );
  }

  const base = line.i * HOURS;
  const actual = Array.from(model.actual.slice(base, base + HOURS));
  const expected = Array.from(model.expected.slice(base, base + HOURS));
  const gaps: Array<[number, number]> = [];
  for (let h = 0; h < HOURS; h++) if (!model.reported[base + h]) gaps.push([h, h + 1]);

  const site = model.bySiteId.get(line.siteId);
  const siblings = site?.members.filter((m) => m.ci !== line.ci) ?? [];

  const viable = MODES.filter((m) => {
    const s = line.record.modes[m];
    return s.viable && s.delta_pct !== null;
  });
  const unviable = MODES.filter((m) => !viable.includes(m));

  return (
    <Panel
      title={line.name}
      subtitle={`#${line.id} · since ${index.first_seen[line.ci]}`}
      actions={
        <button type="button" className="pp-btn pp-btn--chip" onClick={() => setSelected(null)}>
          clear
        </button>
      }
      footnote={line.record.diagnosis_reason}
    >
      {/* Compact: the chip's long label and the reason footnote below were two
          statements of the same finding, and the label wrapped to three lines to
          make it. The glyph and the confidence bars are unchanged, and the
          footnote still carries the full inferred reason with its numbers. */}
      <DiagnosisChip code={line.code} confidence={line.confidence} compact />
      <VitalsTrace
        actual={actual}
        expected={expected}
        gaps={gaps}
        cursor={hour}
        height={56}
        ariaSummary={`24-hour trace for ${line.name}. ${line.record.diagnosis_reason}`}
      />
      {/* Two pairs to a row, so the labels have to be short enough not to wrap —
          a wrapped label costs the same height as the row it saved. All six
          figures are still here; only their captions got terser. */}
      <dl className="pp-kv pp-t-mono-sm">
        <dt>obs / exp</dt>
        <dd>
          {line.record.obs.toLocaleString('en-NZ')} / {line.record.exp.toLocaleString('en-NZ')}
        </dd>
        <dt>change</dt>
        <dd>{line.record.delta_pct === null ? 'no baseline' : signedPct(line.record.delta_pct, 1)}</dd>
        <dt>robust z</dt>
        <dd>{line.record.z.toFixed(1)}</dd>
        <dt>baseline</dt>
        <dd>{line.record.baseline_n} days</dd>
        <dt>hours</dt>
        <dd>{line.record.hours_reported} of 24</dd>
        <dt>rate</dt>
        <dd>{Math.round(line.record.reporting_rate * 100)}%</dd>
      </dl>

      {/* Most lines carry one or two usable modes and three that were never
          measurable here, and five rows of "not viable here" pushed the
          evidence list off the rail. The unusable ones keep their names and
          keep the exact phrase — they are counted in the summary and listed
          behind it, never dropped and never shown as a zero. */}
      <ul className="pp-modes">
        {viable.map((m) => (
          <li key={m} className="pp-modes__row" data-viable="true">
            <span className="pp-modes__dot" data-mode={m} />
            <span className="pp-t-body">{MODE_LABEL[m]}</span>
            <span className="pp-t-mono-sm">
              {signedPct(line.record.modes[m].delta_pct as number, 1)}
            </span>
          </li>
        ))}
      </ul>

      {unviable.length > 0 && (
        <details className="pp-disclose pp-disclose--tight">
          <summary className="pp-t-label">{unviable.length} modes not viable here</summary>
          <ul className="pp-modes">
            {unviable.map((m) => (
              <li key={m} className="pp-modes__row" data-viable="false">
                <span className="pp-modes__dot" data-mode={m} />
                <span className="pp-t-body">{MODE_LABEL[m]}</span>
                <span className="pp-t-mono-sm">not viable here</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {line.record.caveats.length > 0 && (
        <ul className="pp-caveats pp-t-caption pp-c-secondary">
          {line.record.caveats.map((c) => (
            <li key={c}>{CAVEAT_LABEL[c] ?? c}</li>
          ))}
        </ul>
      )}

      {siblings.length > 0 && (
        <details className="pp-disclose">
          <summary className="pp-t-label">
            {siblings.length} more countline{siblings.length === 1 ? '' : 's'} on this camera
          </summary>
          <ul className="pp-rank">
            {siblings.map((m) => (
              <li key={m.ci}>
                <button
                  type="button"
                  className="pp-rank__item"
                  onClick={() => setSelected(m.ci)}
                >
                  <span className="pp-t-body pp-rank__name">{m.name}</span>
                  <span
                    className="pp-t-mono-sm pp-rank__delta"
                    data-dir={(m.record.delta_pct ?? 0) < 0 ? 'down' : 'up'}
                  >
                    {m.record.delta_pct === null ? '—' : signedPct(m.record.delta_pct)}
                  </span>
                  <span className="pp-t-caption pp-c-secondary">n={m.record.baseline_n}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
