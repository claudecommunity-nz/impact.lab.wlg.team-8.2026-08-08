import { cssColor } from '../theme/color';
import { CONFIDENCE_LABEL, DIAGNOSIS } from '../copy/strings';
import type { Confidence, DiagnosisCode } from '../data/types';
import { TwinDotGlyph, glyphAlt } from './TwinDotGlyph';

export interface DiagnosisChipProps {
  code: DiagnosisCode;
  confidence: Confidence;
  compact?: boolean;
  onClick?: () => void;
}

/**
 * A typed cause, not a severity. Diagnosis lives in chips, glyphs and a 1px
 * map casing — never in the line's fill colour, which the percent ramp owns.
 */
export function DiagnosisChip({ code, confidence, compact, onClick }: DiagnosisChipProps) {
  const meta = DIAGNOSIS[code];
  const label = compact ? meta.short : meta.label;
  const content = (
    <>
      <TwinDotGlyph
        pedestrian={meta.glyph.pedestrian}
        vehicle={meta.glyph.vehicle}
        title={glyphAlt(meta.glyph.pedestrian, meta.glyph.vehicle)}
      />
      <span>{label}</span>
      <span className="pp-dx__conf" title={CONFIDENCE_LABEL[confidence]}>
        {'▮'.repeat(confidence) || '·'}
      </span>
    </>
  );
  const style = { borderColor: cssColor(meta.token, 0.55) };

  return onClick ? (
    <button type="button" className="pp-dx" style={style} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className="pp-dx" style={style}>
      {content}
    </span>
  );
}
