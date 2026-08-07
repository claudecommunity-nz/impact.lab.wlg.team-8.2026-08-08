/**
 * Two numbers, each carrying its own basis. On a refused day both render an
 * em-dash: we never fabricate a zero to fill a slot.
 *
 * Was 834px of card in a 480px rail. The three-line subtitle repeated the
 * headline verbatim and went; the long date went because the identity bar
 * already carries it; the two coverage tiles moved to the Confidence card,
 * which is where the rest of the "what can we see" numbers live. The neighbour
 * cross-check is 152px of prose answering a question only a sceptic asks, so it
 * is behind a disclosure — reachable, because it is the thing that names the
 * contaminated peer, and hiding that would be the dishonest cut.
 */

import { Panel, StatTile } from '../ui';
import { useAppState } from '../state/app';
import { useData } from '../data/DataProvider';
import { signedPct } from '../copy/strings';

/**
 * Show the per-peer figures, not just their mean.
 *
 * 16 October's later same-weekday neighbour IS 23 October, the storm day, so
 * the two-peer mean on the control day is +32.8% — a nonsense number on the one
 * screen whose job is to establish what normal looks like. The pipeline already
 * ships `peer_deltas_pct`; this renders them and names the contaminated peer
 * instead of averaging the event into the baseline silently.
 */
const CONTAMINATED_PEER_PCT = 20;

function neighbourFootnote(s: {
  citywide_delta_pct: number | null;
  neighbour_check: {
    peers: string[];
    peer_deltas_pct: (number | null)[];
    delta_pct: number | null;
  };
}): string {
  const robust = `Robust baseline says ${signedPct(s.citywide_delta_pct ?? 0, 1)}.`;
  const { peers, peer_deltas_pct: deltas, delta_pct } = s.neighbour_check;

  if (!peers.length || peers.length !== deltas.length) {
    return `${robust} No eligible same-weekday neighbour to cross-check against.`;
  }

  const parts = peers.map((p, i) =>
    deltas[i] === null ? `n/a (${p})` : `${signedPct(deltas[i] as number, 1)} (${p})`,
  );
  const suspect = peers.filter(
    (_, i) => deltas[i] !== null && Math.abs(deltas[i] as number) > CONTAMINATED_PEER_PCT,
  );
  const raw = `A raw check against the nearest same-weekday days either side gives ${parts.join(
    ' and ',
  )}`;
  const caveat = suspect.length
    ? ` — ${suspect.join(', ')} is itself an anomalous day, so the mean of the two is not meaningful.`
    : `, mean ${signedPct(delta_pct ?? 0, 1)}.`;

  return `${robust} ${raw}${caveat} Both are shipped; neither is hidden.`;
}

export function SituationPanel() {
  const { hour } = useAppState();
  const { model } = useData();
  if (!model) return null;

  const s = model.file.summary;
  const refused = model.refused;
  const obs = model.cityObs[hour];
  const exp = model.cityExp[hour];
  const hourDelta = exp > 0 ? ((obs - exp) / exp) * 100 : null;

  const dayDelta = s.citywide_delta_pct;

  return (
    <Panel
      title={refused || dayDelta === null ? 'Not assessed' : `Citywide ${signedPct(dayDelta)} on the day`}
      tone={refused ? 'blind' : 'default'}
    >
      <StatTile
        label={`At ${String(hour).padStart(2, '0')}:00, observed`}
        value={Math.round(obs)}
        state={refused ? 'suppressed' : 'ok'}
        delta={
          hourDelta === null || refused
            ? undefined
            : { value: hourDelta, direction: hourDelta < 0 ? 'down' : 'up' }
        }
        basis={`all modes · expected ${Math.round(exp).toLocaleString('en-NZ')}`}
        emphasis="hero"
      />

      {/* The day figure is a line, not a second tile: two metric-xl numerals in
          a 340px card make the one that changes during playback stop reading as
          the live one. */}
      {!refused && (
        <p className="pp-t-mono-sm pp-c-secondary pp-situ__day">
          Day {s.citywide_obs.toLocaleString('en-NZ')} · {s.lines_assessed} lines · vs{' '}
          {model.file.baseline.n_days} {model.file.baseline.weekday.slice(0, 3)}
        </p>
      )}

      {!refused && (
        <details className="pp-disclose">
          <summary className="pp-t-label">Cross-check the baseline</summary>
          <p className="pp-t-caption pp-c-secondary">{neighbourFootnote(s)}</p>
        </details>
      )}
    </Panel>
  );
}
