// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CaptionOverlay } from './CaptionOverlay';
import { CAPTION_PRESET_ORDER, applyPreset } from '../utils/captionPresets';

const SEGMENTS = [
  { text: 'Welcome to the demo', start: 0, end: 4 },
  { text: 'Second segment here', start: 4, end: 8 },
];

// currentTime=2 lands mid-segment 0; with 4 words at 1s each it highlights word 1.
const CURRENT_TIME = 2;

describe('CaptionOverlay presets', () => {
  const renderPreset = (name: (typeof CAPTION_PRESET_ORDER)[number]) =>
    render(<CaptionOverlay segments={SEGMENTS} currentTime={CURRENT_TIME} style={applyPreset(name)} />);

  // container > baseContainer > style box
  const boxOf = (container: HTMLElement) =>
    (container.firstChild as HTMLElement).firstElementChild as HTMLElement;

  it.each(CAPTION_PRESET_ORDER)('%s renders the expected preview overlay (snapshot)', name => {
    const { container } = renderPreset(name);
    expect(container.firstChild).toMatchSnapshot();
    cleanup();
  });

  it('preset switch visibly changes the preview overlay', () => {
    const htmls = CAPTION_PRESET_ORDER.map(name => {
      const { container } = renderPreset(name);
      const html = container.innerHTML;
      cleanup();
      return html;
    });
    expect(new Set(htmls).size).toBe(CAPTION_PRESET_ORDER.length);
  });

  it('minimal renders text without a background box', () => {
    const { container } = renderPreset('minimal');
    const box = boxOf(container);
    expect(box.style.backgroundColor).toBe('transparent');
    expect(box.textContent).toBe('Welcome to the demo');
  });

  it('karaoke fills the word spoken at currentTime', () => {
    const { container } = renderPreset('karaoke');
    const words = Array.from(boxOf(container).children) as HTMLElement[];
    expect(words.map(w => w.textContent)).toEqual(['Welcome', 'to', 'the', 'demo']);
    // #7c3aed violet marks the active word: wordDur = 4s / 4 words = 1s,
    // so floor(2 / 1) = index 2.
    const activeIdx = words.findIndex(w => w.style.color === 'rgb(124, 58, 237)');
    expect(activeIdx).toBe(2);
    expect(words[activeIdx].textContent).toBe('the');
  });

  it('karaoke box uses the preset background', () => {
    const { container } = renderPreset('karaoke');
    expect(boxOf(container).style.backgroundColor).toBe('rgb(17, 24, 39)'); // #111827
  });

  it('bold pop uses the brand violet background', () => {
    const { container } = renderPreset('bold-pop');
    expect(boxOf(container).style.backgroundColor).toBe('rgb(124, 58, 237)'); // #7c3aed
  });
});
