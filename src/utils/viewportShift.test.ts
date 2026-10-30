import { describe, expect, it } from 'vitest';
import { viewportOverflowShift } from './viewportShift';

const VP = { width: 1440, height: 900 };

describe('viewportOverflowShift', () => {
  it('returns zero shift for a box already fully inside the viewport', () => {
    const box = { left: 400, top: 300, right: 544, bottom: 443.5 };
    expect(viewportOverflowShift(box, VP)).toEqual({ dx: 0, dy: 0 });
  });

  it('shifts a right-overflowing box back to the right margin', () => {
    // Reproduction geometry: transition picker 50px past the window edge.
    const box = { left: 1346, top: 614, right: 1490, bottom: 757.5 };
    expect(viewportOverflowShift(box, VP)).toEqual({ dx: -58, dy: 0 });
  });

  it('shifts a left-overflowing box to the left margin', () => {
    const box = { left: -40, top: 100, right: 104, bottom: 243.5 };
    expect(viewportOverflowShift(box, VP)).toEqual({ dx: 48, dy: 0 });
  });

  it('shifts a bottom-overflowing box back inside on short viewports', () => {
    const box = { left: 400, top: 614, right: 544, bottom: 757.5 };
    expect(viewportOverflowShift(box, { width: 1440, height: 600 })).toEqual({ dx: 0, dy: -165.5 });
  });

  it('prefers the top/left margin when the box is bigger than the viewport', () => {
    const box = { left: -100, top: 0, right: 1900, bottom: 500 };
    const { dx } = viewportOverflowShift(box, VP);
    expect(box.left + dx).toBe(8); // left edge pinned to the margin, not centered
  });

  it('applies both axes independently', () => {
    const box = { left: -40, top: 614, right: 1490, bottom: 940 };
    expect(viewportOverflowShift(box, VP)).toEqual({ dx: 48, dy: -48 });
  });
});
