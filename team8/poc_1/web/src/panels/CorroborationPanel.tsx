/**
 * Was ContextPanel, 981px. One row per item now: what it was, and when.
 *
 * Provenance stays attached per item rather than as a page footnote — and the
 * RED warning's `hand-entered` sits INLINE on its chip, never behind the
 * disclosure. That row is the one that has to survive a screenshot: MetService
 * publishes no warnings archive, this entry was typed by hand from public
 * reporting, and a reader must not be able to see the warning without also
 * seeing that. Everything else's caveat is one click away.
 *
 * The earthquake row stays. Ruling something out is a finding.
 * `road_closures_note` moved into the landing modal's limits.
 */

import { Panel } from '../ui';
import { useData } from '../data/DataProvider';

export function CorroborationPanel() {
  const { context } = useData();
  if (!context) return null;

  const nothing =
    context.warnings.length === 0 && context.transport.length === 0 && context.council.length === 0;

  const supporting =
    context.transport.length + context.council.length + (context.quakes_verdict === 'ruled_out' ? 1 : 0);

  return (
    <Panel title="What else was happening">
      {nothing && (
        <p className="pp-t-caption pp-c-secondary">
          No warning, transport disruption or council action is on record for this date. That is an
          absence of record, not evidence that nothing happened.
        </p>
      )}

      {context.warnings.map((w) => (
        <div className="pp-ctx" key={w.headline} data-level={w.level}>
          <span className="pp-t-label pp-ctx__kind" data-level={w.level}>
            {w.level} {w.type} warning
            <span className="pp-ctx__hand" title={w.caveat}>
              hand-entered
            </span>
          </span>
          <p className="pp-t-caption">{w.headline}</p>
          <p className="pp-t-caption pp-c-secondary">
            {w.region} · {w.valid_from.slice(11, 16)}–{w.valid_until.slice(11, 16)}
          </p>
        </div>
      ))}

      {supporting > 0 && (
        <details className="pp-disclose">
          <summary className="pp-t-label">Transport, council, ruled out ({supporting})</summary>

          {context.transport.map((t) => (
            <div className="pp-ctx" key={t.detail}>
              <span className="pp-t-label pp-ctx__kind">{t.kind}</span>
              <p className="pp-t-caption">{t.detail}</p>
            </div>
          ))}

          {context.council.map((c) => (
            <div className="pp-ctx" key={c.detail}>
              <span className="pp-t-label pp-ctx__kind">{c.kind.replace(/_/g, ' ')}</span>
              <p className="pp-t-caption">{c.detail}</p>
            </div>
          ))}

          {/* Ruling something out is a finding, so it is listed, not omitted. */}
          {context.quakes_verdict === 'ruled_out' && (
            <div className="pp-ctx" data-ruled-out="true">
              <span className="pp-t-label pp-ctx__kind">earthquake — ruled out</span>
              <p className="pp-t-caption pp-c-secondary">{context.quakes_note}</p>
            </div>
          )}

          <p className="pp-t-caption pp-ctx__prov">
            Every entry above is hand-entered from public reporting, not an automated feed.
          </p>
        </details>
      )}
    </Panel>
  );
}
