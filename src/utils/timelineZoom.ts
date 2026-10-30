// Pure timeline zoom math — kept free of React so it is unit-testable in isolation.

export const MIN_PPS = 10;
export const MAX_PPS = 200;
export const DEFAULT_PPS = 50;

/** Multiplicative step per zoom click; sqrt(2) means two clicks ≈ 2× or ÷2. */
export const ZOOM_STEP_FACTOR = Math.SQRT2;

/** Horizontal breathing room (seconds) kept on the right when fitting to window. */
export const FIT_PADDING_SECONDS = 5;

export function clampPixelsPerSecond(pps: number): number {
  return Math.max(MIN_PPS, Math.min(MAX_PPS, pps));
}

/**
 * Zoom in/out by a multiplicative factor so every click feels the same
 * regardless of current zoom level. direction: 1 = in, -1 = out.
 */
export function stepPixelsPerSecond(pps: number, direction: 1 | -1, factor: number = ZOOM_STEP_FACTOR): number {
  return clampPixelsPerSecond(pps * factor ** direction);
}

/**
 * Scale (px/s) that fits `contentSeconds` of timeline into `availableWidth` px,
 * leaving FIT_PADDING_SECONDS of trailing headroom. Falls back to DEFAULT_PPS
 * when there is nothing to fit (no clips/voiceover) or no measurable width.
 */
export function fitPixelsPerSecond(contentSeconds: number, availableWidth: number): number {
  const usable = contentSeconds > 0 ? availableWidth : 0;
  if (usable <= 0) return DEFAULT_PPS;
  const fitSeconds = contentSeconds + FIT_PADDING_SECONDS;
  return clampPixelsPerSecond(usable / fitSeconds);
}
