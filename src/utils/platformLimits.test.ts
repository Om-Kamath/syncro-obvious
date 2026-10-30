import { describe, it, expect } from 'vitest';
import {
  PLATFORM_LIMITS,
  evaluateField,
  evaluateMetadata,
  WARN_RATIO,
  type PlatformId,
} from './platformLimits';

const PLATFORM_IDS = Object.keys(PLATFORM_LIMITS) as PlatformId[];

describe('PLATFORM_LIMITS table', () => {
  it('covers all supported platforms', () => {
    expect(PLATFORM_IDS.sort()).toEqual(['instagram', 'shorts', 'tiktok', 'youtube']);
  });

  it('has positive, finite limits for every platform and field', () => {
    for (const id of PLATFORM_IDS) {
      const limits = PLATFORM_LIMITS[id];
      expect(limits.id).toBe(id);
      expect(limits.label).toBeTruthy();
      for (const field of ['title', 'description', 'hashtagCount'] as const) {
        expect(Number.isFinite(limits[field]), `${id}.${field}`).toBe(true);
        expect(limits[field], `${id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it('pins known platform limits', () => {
    expect(PLATFORM_LIMITS.youtube).toMatchObject({ title: 100, description: 5000, hashtagCount: 15 });
    expect(PLATFORM_LIMITS.tiktok).toMatchObject({ title: 2200, description: 2200, hashtagCount: 5 });
    expect(PLATFORM_LIMITS.instagram).toMatchObject({ title: 125, description: 2200, hashtagCount: 30 });
  });
});

describe('evaluateField warn states', () => {
  it('is ok below the warn band', () => {
    expect(evaluateField(0, 100)).toBe('ok');
    expect(evaluateField(89, 100)).toBe('ok');
  });

  it('is warn at or above the warn ratio of the limit', () => {
    const warnAt = Math.ceil(100 * WARN_RATIO);
    expect(evaluateField(warnAt - 1, 100)).toBe('ok');
    expect(evaluateField(warnAt, 100)).toBe('warn');
    expect(evaluateField(100, 100)).toBe('warn'); // exactly at limit is warn, not over
  });

  it('is over past the limit', () => {
    expect(evaluateField(101, 100)).toBe('over');
  });

  it('rounds the warn threshold up for odd limits', () => {
    // 90% of 15 = 13.5 → warn starts at 14
    expect(evaluateField(13, 15)).toBe('ok');
    expect(evaluateField(14, 15)).toBe('warn');
    expect(evaluateField(15, 15)).toBe('warn');
    expect(evaluateField(16, 15)).toBe('over');
  });
});

describe('evaluateMetadata', () => {
  const input = (titleLen: number, descriptionLen: number, hashtagCount: number): {
    title: string;
    description: string;
    hashtags: string[];
  } => ({
    title: 'x'.repeat(titleLen),
    description: 'y'.repeat(descriptionLen),
    hashtags: Array.from({ length: hashtagCount }, (_, i) => `tag${i}`),
  });

  it('reports ok counts on short metadata for every platform', () => {
    const result = evaluateMetadata(input(10, 200, 3), 'youtube');
    expect(result.title).toMatchObject({ current: 10, limit: 100, status: 'ok' });
    expect(result.description).toMatchObject({ current: 200, limit: 5000, status: 'ok' });
    expect(result.hashtags).toMatchObject({ current: 3, limit: 15, status: 'ok' });
  });

  it('flags hashtags as warn then over per the platform table', () => {
    // YouTube allows 15 hashtags
    expect(evaluateMetadata(input(0, 0, 14), 'youtube').hashtags.status).toBe('warn');
    expect(evaluateMetadata(input(0, 0, 15), 'youtube').hashtags.status).toBe('warn');
    expect(evaluateMetadata(input(0, 0, 16), 'youtube').hashtags.status).toBe('over');
    // Instagram allows 30 — the same set is still ok there
    expect(evaluateMetadata(input(0, 0, 16), 'instagram').hashtags.status).toBe('ok');
  });

  it('warns on description lengths approaching each platform limit', () => {
    expect(evaluateMetadata(input(0, 4600, 0), 'youtube').description.status).toBe('warn');
    expect(evaluateMetadata(input(0, 5001, 0), 'youtube').description.status).toBe('over');
    // 2100 chars is fine for YouTube, in the warn band for TikTok
    expect(evaluateMetadata(input(0, 2100, 0), 'youtube').description.status).toBe('ok');
    expect(evaluateMetadata(input(0, 2100, 0), 'tiktok').description.status).toBe('warn');
    expect(evaluateMetadata(input(0, 2201, 0), 'tiktok').description.status).toBe('over');
  });

  it('evaluates the title against the per-platform title limit', () => {
    expect(evaluateMetadata(input(100, 0, 0), 'youtube').title.status).toBe('warn');
    expect(evaluateMetadata(input(101, 0, 0), 'youtube').title.status).toBe('over');
    // 101 chars still fits TikTok's 2200-char caption-style title
    expect(evaluateMetadata(input(101, 0, 0), 'tiktok').title.status).toBe('ok');
  });
});
