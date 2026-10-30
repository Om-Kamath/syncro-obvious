// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import { CaptionsTab } from './PostProcessingPanel';
import { CAPTION_PRESETS, CAPTION_PRESET_ORDER, applyPreset, DEFAULT_CAPTION_STYLE } from '../utils/captionPresets';
import type { CaptionStyle, Voiceover } from '../types';

const VOICEOVER: Voiceover = {
  url: 'blob:test-voiceover',
  duration: 8,
  transcription: 'Welcome to the demo. Second segment here.',
  segments: [
    { text: 'Welcome to the demo', start: 0, end: 4 },
    { text: 'Second segment here', start: 4, end: 8 },
  ],
};

// Stateful harness so preset application flows back into captionStyle the way
// App.tsx wires setCaptionStyle in production.
function PresetHarness({ onStyleChange }: { onStyleChange: (s: CaptionStyle) => void }) {
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  return (
    <CaptionsTab
      voiceover={VOICEOVER}
      captionStyle={style}
      captionsEnabled
      onStyleChange={s => { setStyle(s); onStyleChange(s); }}
      onEnabledChange={() => {}}
      onImportCaptions={() => {}}
    />
  );
}

describe('CaptionsTab preset picker', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const presetsGrid = () => within(screen.getByText('Presets').nextElementSibling as HTMLElement);

  it('lists the four shipped presets', () => {
    render(<PresetHarness onStyleChange={() => {}} />);
    for (const name of CAPTION_PRESET_ORDER) {
      expect(presetsGrid().getByRole('button', { name: new RegExp(CAPTION_PRESETS[name].label) })).toBeDefined();
    }
  });

  it('applies the full preset style on click', () => {
    const onStyleChange = vi.fn();
    render(<PresetHarness onStyleChange={onStyleChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Bold Pop/ }));
    expect(onStyleChange).toHaveBeenCalledTimes(1);
    expect(onStyleChange).toHaveBeenCalledWith({ ...CAPTION_PRESETS['bold-pop'].style, preset: 'bold-pop' });
  });

  it('marks the applied preset as active', () => {
    render(<PresetHarness onStyleChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Karaoke/ }));
    const karaokeBtn = presetsGrid().getByRole('button', { name: /Karaoke/ });
    expect(karaokeBtn.getAttribute('aria-pressed')).toBe('true');
    const minimalBtn = presetsGrid().getByRole('button', { name: /Minimal/ });
    expect(minimalBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('manual tweaks clear the preset stamp', () => {
    const onStyleChange = vi.fn();
    render(<PresetHarness onStyleChange={onStyleChange} />);
    // Apply a preset, then tweak the text color by hand.
    fireEvent.click(screen.getByRole('button', { name: /Bold Pop/ }));
    fireEvent.change(screen.getByDisplayValue('#ffffff'), { target: { value: '#ff0000' } });

    expect(onStyleChange).toHaveBeenCalledTimes(2);
    const last = onStyleChange.mock.calls[1][0] as CaptionStyle;
    expect(last.color).toBe('#ff0000');
    expect(last.preset).toBeUndefined();
    // The rest of the preset look is untouched by the manual tweak.
    expect(last.bgColor).toBe(CAPTION_PRESETS['bold-pop'].style.bgColor);
    expect(last.fontSize).toBe(CAPTION_PRESETS['bold-pop'].style.fontSize);
  });

  it('preview starts on the Classic preset by default', () => {
    render(<PresetHarness onStyleChange={() => {}} />);
    const classicBtn = presetsGrid().getByRole('button', { name: /Classic/ });
    expect(classicBtn.getAttribute('aria-pressed')).toBe('true');
    expect(DEFAULT_CAPTION_STYLE).toEqual(applyPreset('classic'));
  });
});
