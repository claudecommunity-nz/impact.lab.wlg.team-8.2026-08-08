/**
 * The two ends of the day. Was RisersPanel at 2138px in a 480px rail.
 *
 * WORST — exposed waterfront and cycle lanes, which is physically coherent for
 * a 140 km/h wind and is the reason anyone should believe the rest of this.
 * Three rows, not six: past the third the list stops being a finding and starts
 * being a table, and the table is what Streets is for.
 *
 * RISERS stay, top two, with the count beside them. Aro St has to be visible
 * here — it is the detail that gets remembered — and the sensor-age correction
 * that kills the naive version of that story is one line and a link rather than
 * 949px of prose. Nothing was deleted; see ./StreetsAnnex.
 */

import { Panel } from '../ui';
import { useData } from '../data/DataProvider';
import { useSelection } from '../state/app';
import { signedPct } from '../copy/strings';
import type { LineView } from '../data/derive';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
};

const WORST_SHOWN = 3;
const RISERS_SHOWN = 2;

export function MoversPanel() {
  const { model, index } = useData();
  const { setSelected, setHovered } = useSelection();
  if (!model || model.refused) return null;

  const aroNew = model.lines.filter((l) => /^Aro St/i.test(l.name) && l.record.baseline_n === 0);
  // '2025-10-17' is three lines' worth of a two-line paragraph. '17 Oct' is
  // the same fact.
  const aroInstalled = aroNew.length ? shortDate(index?.first_seen[aroNew[0].ci]) : null;
  const risenSites = model.sites.filter((s) => (s.stats.total.deltaPct ?? 0) > 0).length;

  const Row = ({ l }: { l: LineView }) => (
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

  // The title carries the first section, so the "Worst hit" label above the
  // first list was saying it twice — and at rail width the old title wrapped to
  // two lines to do it. Only the risers need naming now.
  return (
    <Panel title="Worst-hit countlines">
      <ul className="pp-rank">
        {model.worst.slice(0, WORST_SHOWN).map((l) => (
          <Row key={l.ci} l={l} />
        ))}
      </ul>

      {/* Countlines, said so. This list ranks countlines; the map draws sites
          and the Streets table ranks sites, and the same day read "2 went up"
          here against "the best riser is −25.5%" there. No site rose. */}
      <p className="pp-t-label pp-c-secondary pp-rank__head">
        Went up: {model.risers.length} of {model.file.summary.lines_ranked}
        {model.risers.length > 0 && risenSites === 0 ? ' · no site rose' : ''}
      </p>
      <ul className="pp-rank">
        {model.risers.length === 0 && (
          <li className="pp-t-caption pp-c-secondary">
            No countline rose enough to be worth naming.
          </li>
        )}
        {model.risers.slice(0, RISERS_SHOWN).map((l) => (
          <Row key={l.ci} l={l} />
        ))}
      </ul>

      {/* The claim itself, not a link to it. This said "too new to score" and
          pointed at a tab where no Aro explanation existed. */}
      {aroNew.length > 0 && (
        <p className="pp-t-caption pp-c-secondary">
          {aroNew.length} Aro St countlines installed {aroInstalled ?? 'later'}: no baseline, so a
          naive tool calls them risers — <a href="#/streets">Streets</a>.
        </p>
      )}
    </Panel>
  );
}
