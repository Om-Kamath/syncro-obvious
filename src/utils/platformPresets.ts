/**
 * Per-platform description/hashtag presets and the description prompt they
 * compose into.
 *
 * Pure data + string building — no DOM, no Gemini. postProcessing consumes
 * buildDescriptionPrompt at call time, DescriptionTab consumes the preset table
 * for its platform selector, and the unit tests pin each platform's fixture.
 */

export type PlatformId = 'youtube' | 'shorts' | 'tiktok' | 'instagram';

export interface PlatformPreset {
  id: PlatformId;
  /** Selector label, e.g. "YouTube". */
  label: string;
  /** One-line UI hint for the selector card. */
  description: string;
  /** Prompt fragment describing the summary/caption style. */
  summaryGuidance: string;
  /**
   * Prompt fragment for chapter expectations, or null when the platform has no
   * chapter feature (the prompt then asks for an empty chapters array, keeping
   * one stable response schema across platforms).
   */
  chaptersGuidance: string | null;
  /** Prompt fragment describing hashtag count and style (tags stored without '#'). */
  hashtagGuidance: string;
}

/**
 * Hashtag guidance must always state "without the # symbol": tags are stored
 * bare and the UI adds the prefix when rendering or copying.
 */
export const PLATFORM_PRESETS: Record<PlatformId, PlatformPreset> = {
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    description: 'Long-form · chapters · 8-12 hashtags',
    summaryGuidance: 'A compelling 2-3 sentence summary of the video content',
    chaptersGuidance:
      'Chapter timestamps (3-8 chapters) derived from topic shifts in the transcript. Each chapter needs a timestamp (in seconds from the start) and a short descriptive label (2-5 words)',
    hashtagGuidance: '8-12 relevant hashtags for YouTube/social media (without the # symbol)',
  },
  shorts: {
    id: 'shorts',
    label: 'YouTube Shorts',
    description: 'Short-form · hook summary · 3-5 hashtags',
    summaryGuidance:
      'A punchy 1-2 sentence hook for a vertical short — viewers decide in under a second whether to keep watching',
    chaptersGuidance: null,
    hashtagGuidance: '3-5 concise discovery hashtags tuned for Shorts feeds (without the # symbol)',
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    description: 'Hook-first caption · no chapters · 4-6 hashtags',
    summaryGuidance:
      'A scroll-stopping hook caption under 150 characters, written the way creators talk on TikTok',
    chaptersGuidance: null,
    hashtagGuidance: '4-6 trend-friendly hashtags mixing broad and niche tags (without the # symbol)',
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    description: 'Reels caption · no chapters · 8-15 hashtags',
    summaryGuidance: 'A 1-3 sentence Instagram caption with a clear call to action for a Reel audience',
    chaptersGuidance: null,
    hashtagGuidance: '8-15 relevant hashtags mixing broad-reach and niche community tags (without the # symbol)',
  },
};

export const DEFAULT_PLATFORM_PRESET: PlatformId = 'youtube';

/** Whether the platform's description carries YouTube-style chapter timestamps. */
export function supportsChapters(preset: PlatformPreset): boolean {
  return preset.chaptersGuidance !== null;
}

/** Compose the description prompt for a platform preset. */
export function buildDescriptionPrompt(
  preset: PlatformPreset,
  transcription: string,
  segments: ReadonlyArray<{ text: string; start: number; end: number }>,
  analyses: ReadonlyArray<string>
): string {
  const chapterLine =
    preset.chaptersGuidance ?? 'This platform does not use chapters — return an empty chapters array.';
  return `You are generating a video description in the ${preset.label} style.

Voiceover transcription:
"${transcription}"

Timed transcript segments: ${JSON.stringify(segments)}

Video content descriptions: ${analyses.join(' | ')}

Generate:
1. ${preset.summaryGuidance}
2. ${chapterLine}
3. ${preset.hashtagGuidance}`;
}
