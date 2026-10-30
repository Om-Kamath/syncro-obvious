import { describe, expect, it } from 'vitest';
import { captionBoxY, captionOverlayPositionClass } from './captionPosition';

describe('captionBoxY', () => {
  it('places top captions at the margin inset', () => {
    expect(captionBoxY('top', 720, 60)).toBe(32);
    expect(captionBoxY('top', 720, 60, 48)).toBe(48);
  });

  it('places bottom captions inset by the margin from the canvas bottom edge', () => {
    expect(captionBoxY('bottom', 720, 60)).toBe(720 - 60 - 32);
    expect(captionBoxY('bottom', 720, 60, 48)).toBe(720 - 60 - 48);
  });

  it('vertically centers center captions', () => {
    expect(captionBoxY('center', 720, 60)).toBe(330);
    // Rounding: odd leftover space rounds the box down half a pixel.
    expect(captionBoxY('center', 721, 60)).toBe(Math.round((721 - 60) / 2));
  });

  it('centers a full-height box at the top edge', () => {
    expect(captionBoxY('center', 720, 720)).toBe(0);
  });

  it('keeps top/bottom mapping independent of box height beyond the offset', () => {
    // Same canvas, different box heights: the box top edge shifts by exactly
    // the height difference for bottom placement.
    expect(captionBoxY('bottom', 1080, 80) - captionBoxY('bottom', 1080, 40)).toBe(-40);
  });
});

describe('captionOverlayPositionClass', () => {
  it('maps each placement to its preview positioning class', () => {
    expect(captionOverlayPositionClass('top')).toBe('top-6');
    expect(captionOverlayPositionClass('center')).toBe('top-1/2 -translate-y-1/2');
    expect(captionOverlayPositionClass('bottom')).toBe('bottom-6');
  });
});
