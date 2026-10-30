import { describe, it, expect } from 'vitest';
import {
  PLATFORM_PRESETS,
  DEFAULT_PLATFORM_PRESET,
  buildDescriptionPrompt,
  supportsChapters,
  type PlatformId,
} from './platformPresets';

const PLATFORM_IDS: PlatformId[] = ['youtube', 'shorts', 'tiktok', 'instagram'];

const transcription = 'We hiked the ridge at dawn and found an abandoned cabin.';
const segments = [
  { text: 'We hiked the ridge at dawn.', start: 0, end: 4 },
  { text: 'We found an abandoned cabin.', start: 4, end: 8 },
];
const analyses = ['A mountain ridge at sunrise', 'A weathered cabin door'];

const promptFor = (id: PlatformId) =>
  buildDescriptionPrompt(PLATFORM_PRESETS[id], transcription, segments, analyses);

describe('platform preset table', () => {
  it('defines exactly the four campaign platforms', () => {
    expect(Object.keys(PLATFORM_PRESETS)).toEqual(PLATFORM_IDS);
  });

  it('defaults to youtube', () => {
    expect(PLATFORM_IDS).toContain(DEFAULT_PLATFORM_PRESET);
    expect(PLATFORM_PRESETS[DEFAULT_PLATFORM_PRESET].id).toBe('youtube');
  });

  it('gives every preset a label, selector description, and non-empty guidance', () => {
    for (const id of PLATFORM_IDS) {
      const preset = PLATFORM_PRESETS[id];
      expect(preset.id).toBe(id);
      expect(preset.label.trim()).not.toBe('');
      expect(preset.description.trim()).not.toBe('');
      expect(preset.summaryGuidance.trim()).not.toBe('');
      expect(preset.hashtagGuidance.trim()).not.toBe('');
    }
  });

  it('asks for bare hashtags in every preset — the UI adds the # prefix', () => {
    for (const id of PLATFORM_IDS) {
      expect(promptFor(id)).toMatch(/without the # symbol/);
    }
  });

  it('supports chapters only on youtube', () => {
    expect(supportsChapters(PLATFORM_PRESETS.youtube)).toBe(true);
    for (const id of ['shorts', 'tiktok', 'instagram'] as const) {
      expect(supportsChapters(PLATFORM_PRESETS[id])).toBe(false);
    }
  });
});

describe('buildDescriptionPrompt fixtures', () => {
  it('embeds the transcription, serialized segments, and pipe-joined analyses for every platform', () => {
    for (const id of PLATFORM_IDS) {
      const prompt = promptFor(id);
      expect(prompt).toContain(transcription);
      expect(prompt).toContain(JSON.stringify(segments));
      expect(prompt).toContain(analyses.join(' | '));
    }
  });

  it('youtube: long-form summary, 3-8 chapters, 8-12 hashtags', () => {
    const prompt = promptFor('youtube');
    expect(prompt).toMatch(/^You are generating a video description in the YouTube style\./);
    expect(prompt).toContain(PLATFORM_PRESETS.youtube.summaryGuidance);
    expect(prompt).toContain(PLATFORM_PRESETS.youtube.chaptersGuidance);
    expect(prompt).toMatch(/3-8 chapters/i);
    expect(prompt).toMatch(/8-12 relevant hashtags/i);
  });

  it('shorts: hook summary, no chapters, 3-5 hashtags', () => {
    const prompt = promptFor('shorts');
    expect(prompt).toMatch(/^You are generating a video description in the YouTube Shorts style\./);
    expect(prompt).toContain(PLATFORM_PRESETS.shorts.summaryGuidance);
    expect(prompt).toMatch(/empty chapters array/i);
    expect(prompt).toMatch(/3-5 concise discovery hashtags/);
    expect(prompt).not.toMatch(/3-8 chapters/i);
  });

  it('tiktok: hook caption under 150 characters, no chapters, 4-6 hashtags', () => {
    const prompt = promptFor('tiktok');
    expect(prompt).toMatch(/^You are generating a video description in the TikTok style\./);
    expect(prompt).toMatch(/under 150 characters/);
    expect(prompt).toMatch(/empty chapters array/i);
    expect(prompt).toMatch(/4-6 trend-friendly hashtags/);
  });

  it('instagram: caption with a call to action, no chapters, 8-15 hashtags', () => {
    const prompt = promptFor('instagram');
    expect(prompt).toMatch(/^You are generating a video description in the Instagram style\./);
    expect(prompt).toMatch(/clear call to action/);
    expect(prompt).toMatch(/empty chapters array/i);
    expect(prompt).toMatch(/8-15 relevant hashtags/);
  });

  it('builds a different prompt per platform', () => {
    const prompts = PLATFORM_IDS.map(promptFor);
    expect(new Set(prompts).size).toBe(PLATFORM_IDS.length);
  });
});
