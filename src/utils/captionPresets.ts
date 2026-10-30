import { CaptionPresetName, CaptionStyle } from '../types';

export interface CaptionPreset {
  name: CaptionPresetName;
  label: string;
  description: string;
  style: Omit<CaptionStyle, 'preset'>;
}

// Full-look presets: applying one replaces every style dimension (mode, size,
// colors, position). The preview overlay renders straight from these values,
// so a switch is visible in the video preview immediately.
export const CAPTION_PRESETS: Record<CaptionPresetName, CaptionPreset> = {
  minimal: {
    name: 'minimal',
    label: 'Minimal',
    description: 'Clean text, no background',
    style: { mode: 'lower-third', fontSize: 18, color: '#ffffff', bgColor: 'transparent', position: 'bottom' },
  },
  'bold-pop': {
    name: 'bold-pop',
    label: 'Bold Pop',
    description: 'Big text on brand violet',
    style: { mode: 'lower-third', fontSize: 28, color: '#ffffff', bgColor: '#7c3aed', position: 'bottom' },
  },
  karaoke: {
    name: 'karaoke',
    label: 'Karaoke',
    description: 'Per-word fill as spoken',
    style: { mode: 'word-highlight', fontSize: 24, color: '#ffffff', bgColor: '#111827', position: 'bottom' },
  },
  classic: {
    name: 'classic',
    label: 'Classic',
    description: 'Subtitle bar on black',
    style: { mode: 'lower-third', fontSize: 16, color: '#ffffff', bgColor: '#000000', position: 'bottom' },
  },
};

// UI ordering for the preset picker.
export const CAPTION_PRESET_ORDER: CaptionPresetName[] = ['minimal', 'bold-pop', 'karaoke', 'classic'];

// Applying a preset is a full-look switch: every style dimension comes from
// the preset, stamped with its name so the picker can show what is active.
export function applyPreset(name: CaptionPresetName): CaptionStyle {
  return { ...CAPTION_PRESETS[name].style, preset: name };
}

// The app's historical default look, now named as the Classic preset.
export const DEFAULT_CAPTION_STYLE: CaptionStyle = applyPreset('classic');
