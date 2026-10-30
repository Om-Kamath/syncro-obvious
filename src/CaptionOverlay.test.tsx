// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CaptionOverlay } from './App';
import type { CaptionSegment, CaptionStyle } from './types';

afterEach(cleanup);

const baseStyle: CaptionStyle = {
  mode: 'word-highlight',
  fontSize: 16,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
};

// jsdom serializes hex colors to rgb(); var() references are stored verbatim.
const USER_COLOR = 'rgb(255, 255, 255)';
const HIGHLIGHT = 'var(--color-caption-highlight)';

// Spans [10, 14]; four words get 1s each via the even-split fallback.
const segment: CaptionSegment = { text: 'alpha beta gamma delta', start: 10, end: 14 };

describe('CaptionOverlay word-highlight mode', () => {
  it('highlights the active word with the caption-highlight token', () => {
    const { getByText } = render(
      <CaptionOverlay segments={[segment]} currentTime={10.5} style={baseStyle} />
    );
    const active = getByText('alpha');
    expect(active.style.color).toBe(HIGHLIGHT);
    expect(active.style.fontWeight).toBe('700');
    expect(getByText('beta').style.color).toBe(USER_COLOR);
    expect(getByText('beta').style.fontWeight).toBe('500');
  });

  it('moves the highlight as currentTime advances', () => {
    const { getByText, rerender } = render(
      <CaptionOverlay segments={[segment]} currentTime={10.5} style={baseStyle} />
    );
    rerender(
      <CaptionOverlay segments={[segment]} currentTime={11.5} style={baseStyle} />
    );
    expect(getByText('beta').style.color).toBe(HIGHLIGHT);
    expect(getByText('alpha').style.color).toBe(USER_COLOR);
  });
});

describe('CaptionOverlay speaker-labeled mode', () => {
  it('colors the speaker label with the caption-highlight token', () => {
    const { getByText } = render(
      <CaptionOverlay
        segments={[segment]}
        currentTime={10.5}
        style={{ ...baseStyle, mode: 'speaker-labeled' }}
      />
    );
    expect(getByText('Speaker:').style.color).toBe(HIGHLIGHT);
    expect(getByText(segment.text).style.color).toBe(USER_COLOR);
  });
});

describe('CaptionOverlay lower-third mode', () => {
  it('uses only style colors', () => {
    const { getByText } = render(
      <CaptionOverlay
        segments={[segment]}
        currentTime={10.5}
        style={{ ...baseStyle, mode: 'lower-third' }}
      />
    );
    expect(getByText(segment.text).style.color).toBe(USER_COLOR);
  });
});
