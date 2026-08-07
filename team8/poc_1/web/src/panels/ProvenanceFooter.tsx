/**
 * One always-visible line. The required statements — hazard-planning only,
 * call 111, T+1, sparse coverage — are drawn from the manifest so the copy
 * cannot drift from what the pipeline actually built.
 *
 * It used to render five paragraphs plus attribution. In the portal layout that
 * is 300px of the viewport spent on text nobody reads twice, and it pushed the
 * instrument off the screen. The statements still have to survive a screenshot,
 * so they are condensed here rather than hidden, with the full text one click
 * away in the explainer.
 */

import { useData } from '../data/DataProvider';
import { honesty } from '../copy/strings';

export function ProvenanceFooter({ onOpenExplainer }: { onOpenExplainer?: () => void }) {
  const { manifest, model } = useData();
  const d = manifest?.disclaimers;
  const network = manifest?.network.camera_sites;

  return (
    <footer className="pp-prov">
      <strong className="pp-prov__emergency">{d?.emergency ?? 'In an emergency, call 111.'}</strong>
      <span title={d?.not_live}>{honesty.notLiveShort}</span>
      <span className="pp-prov__sep" aria-hidden="true">
        ·
      </span>
      {/* Camera sites, not countlines: 398 countlines sound like 398 watched
          places, and they stack a median of 3 to a camera. Both numbers, in one
          string. The legend beside the map showed the per-day figure and this
          row showed the network figure, both labelled "camera sites", and a
          sceptic reads two numbers for one noun as a tool that does not know
          its own coverage. Counted by the pipeline, never typed here. */}
      <span>
        {model ? `${model.nSites} of ` : ''}
        {network ?? '—'} camera sites reporting; absence of an anomaly means nothing.
      </span>
      {/* "MetService warning hand-entered." came out of this line so it fits on
          ONE row at 1512. It survives twice over: inline on the warning chip in
          the Corroboration card, and in landing.limits behind the link below. */}
      {onOpenExplainer && (
        <button type="button" className="pp-prov__more" onClick={onOpenExplainer}>
          Full limitations &amp; attribution
        </button>
      )}
      <a className="pp-prov__gallery" href="#/gallery">
        gallery
      </a>
    </footer>
  );
}
