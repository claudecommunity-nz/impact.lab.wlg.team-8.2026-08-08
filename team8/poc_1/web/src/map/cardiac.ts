/**
 * ease-cardiac — design system §5.2. Not a sine: a sine reads as a loading
 * spinner. The asymmetry, and the third of every cycle spent still, is what
 * reads as alive rather than as a throb.
 *
 *   0    → 0.09  systolic upstroke, peaks at 1.00
 *   0.09 → 0.17  rapid ejection decay to 0.52
 *   0.17 → 0.27  dicrotic notch to 0.44, rebound to 0.63
 *   0.27 → 0.64  diastolic exponential decay to 0.02
 *   0.64 → 1.00  diastasis: flat 0.02
 */
export function easeCardiac(t: number): number {
  const x = t - Math.floor(t);
  if (x < 0.09) {
    const u = x / 0.09;
    return 1 - (1 - u) ** 3;
  }
  if (x < 0.17) {
    const u = (x - 0.09) / 0.08;
    return 1.0 + (0.52 - 1.0) * smooth(u);
  }
  if (x < 0.22) {
    const u = (x - 0.17) / 0.05;
    return 0.52 + (0.44 - 0.52) * smooth(u);
  }
  if (x < 0.27) {
    const u = (x - 0.22) / 0.05;
    return 0.44 + (0.63 - 0.44) * smooth(u);
  }
  if (x < 0.64) {
    return 0.63 * Math.exp((-3.4 * (x - 0.27)) / 0.37);
  }
  return 0.02;
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** The frozen value used under prefers-reduced-motion: legible mid-amplitude. */
export const REDUCED_MOTION_BEAT = easeCardiac(0.2);

/** Suppression freezes at diastole. A still map is the strongest statement. */
export const SUPPRESSED_BEAT = easeCardiac(0.64);

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
