/**
 * Band B — the control row. Everything here used to be a card in a rail:
 * ReplayPicker (702px), LayerPanel (661px) and CoveragePanel's toggle (89px).
 * That is 1452px of rail reclaimed, and the controls are now where the eye
 * already is rather than three scroll positions apart.
 *
 * One vocabulary: chips. The tabs above use an underline precisely so the two
 * rows do not rhyme.
 */

import { LayerPills } from './LayerPills';
import { ModePills } from './ModePills';
import { ReplayPills } from './ReplayPills';

export function ControlBar() {
  return (
    <div className="pp-controls">
      <ReplayPills />
      <span className="pp-controls__rule" aria-hidden="true" />
      <ModePills />
      <span className="pp-controls__rule" aria-hidden="true" />
      <LayerPills />
      <span className="pp-controls__spacer" />
    </div>
  );
}
