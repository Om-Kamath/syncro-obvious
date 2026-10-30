// Shared placement geometry for captions — one source of truth for the
// preview overlay (CSS) and the export burn-in (canvas).

export type CaptionPosition = 'bottom' | 'center' | 'top';

/**
 * Canvas Y coordinate of the caption box's top edge for a placement preset.
 * `margin` is the inset from the canvas edge for top/bottom placements;
 * center placement vertically centers the box and ignores the margin.
 */
export function captionBoxY(
  position: CaptionPosition,
  canvasHeight: number,
  boxHeight: number,
  margin: number = 32
): number {
  switch (position) {
    case 'top':
      return margin;
    case 'center':
      return Math.round((canvasHeight - boxHeight) / 2);
    case 'bottom':
      return canvasHeight - boxHeight - margin;
  }
}

/** Preview overlay positioning classes for a placement preset. */
export function captionOverlayPositionClass(position: CaptionPosition): string {
  switch (position) {
    case 'top':
      return 'top-6';
    case 'center':
      return 'top-1/2 -translate-y-1/2';
    case 'bottom':
      return 'bottom-6';
  }
}
