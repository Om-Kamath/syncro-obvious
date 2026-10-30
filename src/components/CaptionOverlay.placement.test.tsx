// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CaptionOverlay } from '../App';
import type { CaptionStyle } from '../types';

const segments = [{ text: 'hello world', start: 0, end: 4 }];

const baseStyle: CaptionStyle = {
  mode: 'lower-third',
  fontSize: 16,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
};

function renderAt(style: CaptionStyle) {
  return render(
    <CaptionOverlay segments={segments} currentTime={1} style={style} />
  );
}

describe('CaptionOverlay placement', () => {
  afterEach(cleanup);

  it.each([
    ['bottom', 'bottom-6'],
    ['top', 'top-6'],
    ['center', 'top-1/2 -translate-y-1/2'],
  ] as const)('applies the %s positioning class to the overlay container', (position, expected) => {
    renderAt({ ...baseStyle, position });
    expect(screen.getByText('hello world').closest('div.absolute')?.className).toContain(expected);
  });

  it('renders the active segment text', () => {
    renderAt(baseStyle);
    expect(screen.getByText('hello world')).toBeDefined();
  });
});
