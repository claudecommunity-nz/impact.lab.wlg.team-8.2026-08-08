/**
 * The Aro Valley correction — the detail the brief calls the one that gets
 * remembered, and the only place the tool shows what a naive detector would
 * have claimed about a riser.
 *
 * This module used to also export `TypedWorstList` and `LeastAffectedList`.
 * Nothing imported any of the three: the whole file was tree-shaken out of the
 * bundle while MoversPanel linked to it and ConfidencePanel's docstring claimed
 * the ranked list had moved here. A dead export that reads as live is worse
 * than no file, so the two nothing was going to mount are gone and this one is
 * mounted in StreetsView, pinned to the Aro St rows.
 */

import { useData } from '../data/DataProvider';
import { useSelection } from '../state/app';
import { signedPct } from '../copy/strings';
import { CAVEAT_LABEL } from './evidence';
import type { LineView } from '../data/derive';

function RankRow({ l }: { l: LineView }) {
  const { setSelected, setHovered } = useSelection();
  return (
    <li>
      <button
        type="button"
        className="pp-rank__item"
        onClick={() => setSelected(l.ci)}
        onMouseEnter={() => setHovered(l.ci)}
        onMouseLeave={() => setHovered(null)}
      >
        <span className="pp-t-body pp-rank__name">{l.name}</span>
        <span
          className="pp-t-mono-sm pp-rank__delta"
          data-dir={(l.record.delta_pct ?? 0) < 0 ? 'down' : 'up'}
        >
          {l.record.delta_pct === null ? '—' : signedPct(l.record.delta_pct)}
        </span>
        <span className="pp-t-caption pp-c-secondary">n={l.record.baseline_n}</span>
      </button>
    </li>
  );
}

/**
 * Aro Valley is a sheltered gully and the tempting story is that the wind could
 * not get in, so people kept walking. It does not survive controlling for
 * sensor age: four Aro St countlines were installed on 17 Oct 2025, so the
 * first Thursday they ever reported IS 23 Oct and their baseline_n is 0. A
 * naive tool calls them risers. The Aro St sensors that DO have eleven
 * Thursdays behind them went the other way — −30%, −52%, −63%.
 */
export function AroValleyNote() {
  const { model, index } = useData();
  const { setSelected, setHovered } = useSelection();
  if (!model || model.refused) return null;

  const aro = model.lines.filter((l) => /^Aro St/i.test(l.name));
  const aroNew = aro.filter((l) => l.record.baseline_n === 0);
  const aroOld = aro.filter((l) => l.record.baseline_n > 0);
  if (aroNew.length === 0) return null;

  return (
    <div className="pp-note">
      <p className="pp-t-label pp-c-secondary">Aro Valley — what a naive tool would have said</p>
      <p className="pp-t-caption pp-c-secondary">
        Aro Valley is a sheltered gully, and the tempting story is that the wind could not get in so
        people kept walking. {aroNew.length} Aro St countlines were installed on{' '}
        {index?.first_seen[aroNew[0].ci]}, so 23 October is the first Thursday they ever reported.
        Their baseline is zero days long. A detector without a sensor-age gate reads them as risers;
        this one says it has nothing to compare them to.
      </p>
      <ul className="pp-rank">
        {aroNew.map((l) => (
          <li key={l.ci}>
            <button
              type="button"
              className="pp-rank__item pp-rank__item--wrap"
              onClick={() => setSelected(l.ci)}
              onMouseEnter={() => setHovered(l.ci)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="pp-t-body pp-rank__name">{l.name}</span>
              <span className="pp-t-mono-sm pp-rank__delta">n={l.record.baseline_n}</span>
              <span className="pp-t-caption pp-c-secondary">
                {l.record.caveats.map((c) => CAVEAT_LABEL[c] ?? c).join(' · ') || 'no history'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="pp-t-caption pp-c-secondary">
        The Aro St sensors that <em>do</em> have a baseline moved the other way:
      </p>
      <ul className="pp-rank">
        {aroOld.map((l) => (
          <RankRow key={l.ci} l={l} />
        ))}
      </ul>
    </div>
  );
}
