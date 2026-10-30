/**
 * Per-platform metadata limits for publishing copy (titles, descriptions, hashtags).
 *
 * The counts here are the documented public limits for each destination, kept in
 * one table so the publishing UI and its tests agree on a single source of truth.
 */

import type { PlatformId } from './platformPresets';

export type { PlatformId };

export interface PlatformLimits {
  id: PlatformId;
  label: string;
  /** Max characters for the video title. */
  title: number;
  /** Max characters for the description/caption body. */
  description: number;
  /** Max number of hashtags before the platform truncates or ignores them. */
  hashtagCount: number;
}

export const PLATFORM_LIMITS: Record<PlatformId, PlatformLimits> = {
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    title: 100,
    description: 5000,
    hashtagCount: 15, // only the first 15 hashtags show above the title
  },
  shorts: {
    id: 'shorts',
    label: 'Shorts',
    title: 100,
    description: 5000,
    hashtagCount: 3, // hashtag-heavy captions hurt Shorts ranking; 3 is the common guidance
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    title: 2200, // caption limit covers title + hashtags
    description: 2200,
    hashtagCount: 5,
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    title: 125, // Reels cover title
    description: 2200,
    hashtagCount: 30,
  },
};

export type FieldStatus = 'ok' | 'warn' | 'over';

export interface FieldCount {
  current: number;
  limit: number;
  status: FieldStatus;
}

export interface MetadataInput {
  title: string;
  description: string;
  hashtags: string[];
}

/** Ratio of the limit at/above which a field enters the warn band. */
export const WARN_RATIO = 0.9;

/** Pure per-field evaluation: ok → warn (≥90% of limit) → over (exceeds limit). */
export function evaluateField(current: number, limit: number): FieldStatus {
  if (current > limit) return 'over';
  if (current >= Math.ceil(limit * WARN_RATIO)) return 'warn';
  return 'ok';
}

/** Evaluate all three metadata fields for a platform against its limits. */
export function evaluateMetadata(
  input: MetadataInput,
  platform: PlatformId
): Record<'title' | 'description' | 'hashtags', FieldCount> {
  const limits = PLATFORM_LIMITS[platform];
  return {
    title: { current: input.title.length, limit: limits.title, status: evaluateField(input.title.length, limits.title) },
    description: {
      current: input.description.length,
      limit: limits.description,
      status: evaluateField(input.description.length, limits.description),
    },
    hashtags: {
      current: input.hashtags.length,
      limit: limits.hashtagCount,
      status: evaluateField(input.hashtags.length, limits.hashtagCount),
    },
  };
}
