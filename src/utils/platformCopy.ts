/**
 * Final paste-ready copy text per platform.
 *
 * Complements the prompt-side presets in platformPresets.ts: that module shapes
 * what the model generates; this one formats the generated (or hand-edited)
 * assets — chosen title, summary, chapters, hashtags — into the string a
 * creator pastes into each platform's upload form.
 */

import type { PlatformId } from './platformPresets';
import type { Chapter, VideoDescription } from '../types';

function formatTimestamp(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Timestamp formatted for chapter lines: m:ss, or h:mm:ss past one hour. */
export function formatChapterTime(time: number): string {
  return formatTimestamp(time);
}

/** Chapters as YouTube-ready "0:00 Label" lines. */
export function formatChapterLines(chapters: Chapter[]): string {
  return chapters.map(c => `${formatChapterTime(c.time)} ${c.label}`).join('\n');
}

function hashtagLine(hashtags: string[], limit?: number): string {
  return hashtags.slice(0, limit ?? hashtags.length).map(h => `#${h}`).join(' ');
}

export interface PlatformCopyInput {
  title: string;
  description: VideoDescription | null;
}

/**
 * Platform-shaped copy built from one generated description: YouTube keeps
 * everything (long-form + chapters), Shorts appends #Shorts and caps the
 * hashtag count, TikTok drops the title, Instagram pairs the summary with
 * the full hashtag block.
 */
export function buildPlatformCopy(platform: PlatformId, input: PlatformCopyInput): string {
  const { title, description } = input;
  const summary = description?.summary ?? '';
  const chapters = description?.chapters ?? [];
  const hashtags = description?.hashtags ?? [];

  const parts: string[] = [];
  switch (platform) {
    case 'youtube':
      parts.push(title, summary);
      if (chapters.length > 0) parts.push(formatChapterLines(chapters));
      parts.push(hashtagLine(hashtags));
      break;
    case 'shorts':
      parts.push(title ? `${title} #Shorts` : '#Shorts', summary, hashtagLine(hashtags, 5));
      break;
    case 'tiktok':
      parts.push(summary, hashtagLine(hashtags, 5));
      break;
    case 'instagram':
      parts.push(summary, hashtagLine(hashtags));
      break;
  }
  return parts.filter(part => part.trim().length > 0).join('\n\n').trim();
}

/** Full YouTube-style description text: summary, chapter lines, hashtags. */
export function buildFullDescriptionText(description: VideoDescription | null): string {
  if (!description) return '';
  return [
    description.summary,
    formatChapterLines(description.chapters),
    hashtagLine(description.hashtags),
  ]
    .filter(part => part.trim().length > 0)
    .join('\n\n')
    .trim();
}

/** Everything needed to ship: the chosen title on top of the full description. */
export function buildPublishPackageText(input: PlatformCopyInput): string {
  return [input.title.trim(), buildFullDescriptionText(input.description)]
    .filter(Boolean)
    .join('\n\n');
}
