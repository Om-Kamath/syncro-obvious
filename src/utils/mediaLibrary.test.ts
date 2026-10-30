import { describe, it, expect } from 'vitest';
import { countAssetUsage, clipFromAsset } from './mediaLibrary';
import type { MediaAsset, VideoClip } from '../types';

const asset = (id: string, duration = 5): MediaAsset => ({
  id,
  file: new File([], `${id}.mp4`, { type: 'video/mp4' }),
  url: `blob:${id}`,
  duration,
  name: `${id}.mp4`,
});

const clip = (id: string, assetId: string | undefined, extra: Partial<VideoClip> = {}): VideoClip => ({
  id,
  file: new File([], `${id}.mp4`),
  url: `blob:${id}`,
  duration: 5,
  startTime: 0,
  name: `${id}.mp4`,
  ...(assetId ? { assetId } : {}),
  ...extra,
});

describe('countAssetUsage', () => {
  it('returns an empty map when there are no clips', () => {
    expect(countAssetUsage([])).toEqual({});
  });

  it('counts clips per asset id', () => {
    const counts = countAssetUsage([clip('c1', 'a1'), clip('c2', 'a1'), clip('c3', 'a2')]);
    expect(counts).toEqual({ a1: 2, a2: 1 });
  });

  it('ignores clips without an assetId (legacy imports)', () => {
    const counts = countAssetUsage([clip('c1', undefined), clip('c2', 'a1')]);
    expect(counts).toEqual({ a1: 1 });
  });
});

describe('clipFromAsset', () => {
  it('copies the asset media onto a fresh clip', () => {
    const a = asset('a1', 7.5);
    const c = clipFromAsset(a, 'c9');
    expect(c.id).toBe('c9');
    expect(c.file).toBe(a.file);
    expect(c.url).toBe(a.url);
    expect(c.duration).toBe(7.5);
    expect(c.name).toBe('a1.mp4');
    expect(c.assetId).toBe('a1');
  });

  it('starts timeline-specific state clean', () => {
    const c = clipFromAsset(asset('a1'), 'c9');
    expect(c.startTime).toBe(0);
    expect(c.trimStart).toBeUndefined();
    expect(c.trimmedDuration).toBeUndefined();
    expect(c.textOverlay).toBeUndefined();
    expect(c.track).toBeUndefined();
    expect(c.transitionIn).toBeUndefined();
    expect(c.alternatives).toBeUndefined();
    expect(c.analysis).toBeUndefined();
  });
});
