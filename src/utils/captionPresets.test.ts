import { describe, it, expect } from 'vitest';
import { CAPTION_PRESETS, CAPTION_PRESET_ORDER, applyPreset, DEFAULT_CAPTION_STYLE } from './captionPresets';
import type { CaptionMode, CaptionPresetName } from '../types';

const REQUIRED_PRESETS: CaptionPresetName[] = ['minimal', 'bold-pop', 'karaoke', 'classic'];
const MODES: CaptionMode[] = ['lower-third', 'word-highlight', 'speaker-labeled'];

describe('caption presets', () => {
  it('defines exactly the four shipped presets in UI order', () => {
    expect(CAPTION_PRESET_ORDER).toEqual(REQUIRED_PRESETS);
    expect(Object.keys(CAPTION_PRESETS)).toEqual(REQUIRED_PRESETS);
  });

  it.each(CAPTION_PRESET_ORDER)('%s carries a complete, valid style', name => {
    const { style } = CAPTION_PRESETS[name];
    expect(MODES).toContain(style.mode);
    expect(Number.isInteger(style.fontSize)).toBe(true);
    expect(style.fontSize).toBeGreaterThanOrEqual(12);
    expect(style.fontSize).toBeLessThanOrEqual(36);
    expect(style.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    // Background is either a hex color or the literal 'transparent' (no box).
    expect(style.bgColor === 'transparent' || /^#[0-9a-fA-F]{6}$/.test(style.bgColor)).toBe(true);
    expect(['bottom', 'top']).toContain(style.position);
  });

  it('presets are pairwise visually distinct', () => {
    for (let i = 0; i < CAPTION_PRESET_ORDER.length; i++) {
      for (let j = i + 1; j < CAPTION_PRESET_ORDER.length; j++) {
        const a = applyPreset(CAPTION_PRESET_ORDER[i]);
        const b = applyPreset(CAPTION_PRESET_ORDER[j]);
        expect({ ...a, preset: null }).not.toEqual({ ...b, preset: null });
      }
    }
  });

  it('applyPreset stamps the preset name onto the full style', () => {
    const karaoke = applyPreset('karaoke');
    expect(karaoke.preset).toBe('karaoke');
    expect(karaoke).toEqual({ ...CAPTION_PRESETS.karaoke.style, preset: 'karaoke' });
  });

  it('default style is the Classic preset and preserves the historical default look', () => {
    expect(DEFAULT_CAPTION_STYLE).toEqual({
      mode: 'lower-third',
      fontSize: 16,
      color: '#ffffff',
      bgColor: '#000000',
      position: 'bottom',
      preset: 'classic',
    });
  });
});
