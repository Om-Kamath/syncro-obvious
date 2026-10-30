/**
 * Viewport-fit math for fixed-position popovers.
 *
 * Fixed positioning lets a panel escape an overflow/scroll container, but the
 * viewport itself can still clip it when the anchor sits near a window edge.
 * This is a pure function so the shift math is unit-testable without a browser.
 */
export interface BoxEdges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Shift {
  dx: number;
  dy: number;
}

/**
 * How far to slide a measured box so it sits fully inside the viewport with
 * `margin` px of breathing room on every side. Per axis: no-op when in
 * bounds; otherwise shift toward the margin, clamped so the opposite edge
 * never lands past the margin (boxes wider/taller than the viewport align to
 * the top/left margin instead — the overflow there is unavoidable).
 */
export function viewportOverflowShift(box: BoxEdges, viewport: Viewport, margin = 8): Shift {
  const shiftAxis = (start: number, end: number, limit: number): number => {
    if (end > limit - margin) return Math.max(margin - start, limit - margin - end);
    if (start < margin) return margin - start;
    return 0;
  };
  return {
    dx: shiftAxis(box.left, box.right, viewport.width),
    dy: shiftAxis(box.top, box.bottom, viewport.height),
  };
}
