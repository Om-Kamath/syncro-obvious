// Pure windowing math for the timeline's virtualized rendering — kept free of
// React so it is unit-testable in isolation (mirrors timelineZoom.ts).

/** The time range, in seconds, currently inside the timeline's scroll viewport. */
export interface VisibleTimeWindow {
  /** Earliest time (s) whose elements should render; never negative. */
  startSec: number;
  /** Latest time (s) whose elements should render (inclusive upper bound). */
  endSec: number;
}

/** Extra px rendered beyond each viewport edge so elements never pop mid-scroll. */
export const DEFAULT_OVERSCAN_PX = 96;

/** Floor for the timeline scale so the px→time math cannot divide by zero. */
export const MIN_WINDOW_PPS = 0.1;

/**
 * Convert the scroll container's pixel viewport into the time range it spans.
 * `contentOffsetPx` is the distance from the container's left content edge to
 * where time 0 begins (track-label column + gap). The window is padded by
 * `overscanPx` on each side; scale-in px overscan keeps edge elements (e.g.
 * transition badges) mounted at any zoom level.
 */
export function getVisibleTimeWindow(
  scrollLeftPx: number,
  viewportWidthPx: number,
  pixelsPerSecond: number,
  contentOffsetPx: number,
  overscanPx: number = DEFAULT_OVERSCAN_PX,
): VisibleTimeWindow {
  const pps = Math.max(pixelsPerSecond, MIN_WINDOW_PPS);
  const startPx = scrollLeftPx - contentOffsetPx;
  const endPx = startPx + Math.max(viewportWidthPx, 0);
  const overscanSec = Math.max(overscanPx, 0) / pps;
  return {
    startSec: Math.max(0, startPx / pps - overscanSec),
    endSec: endPx / pps + overscanSec,
  };
}

/**
 * True when the interval [startSec, startSec + durationSec) intersects the
 * window. Half-open: a clip ending exactly at the window's start is out, one
 * starting exactly at the window's end is out.
 */
export function intersectsWindow(startSec: number, durationSec: number, visibleWindow: VisibleTimeWindow): boolean {
  return startSec < visibleWindow.endSec && startSec + durationSec > visibleWindow.startSec;
}

/**
 * The subset of `items` whose time interval intersects the window, preserving
 * input order. Accessors keep this decoupled from the VideoClip shape.
 */
export function sliceVisibleClips<T>(
  items: readonly T[],
  visibleWindow: VisibleTimeWindow,
  getStartSec: (item: T) => number,
  getDurationSec: (item: T) => number,
): T[] {
  return items.filter(item => intersectsWindow(getStartSec(item), getDurationSec(item), visibleWindow));
}

/** Inclusive integer range [from, to] of per-second ruler ticks in the window. */
export function visibleTickRange(visibleWindow: VisibleTimeWindow): { from: number; to: number } {
  return {
    from: Math.max(0, Math.floor(visibleWindow.startSec)),
    to: Math.ceil(visibleWindow.endSec),
  };
}
