import { describe, expect, it, vi } from 'vitest';
import {
  createWaveformPeaksCache,
  extractPeaks,
  peaksResolutionFor,
  PEAKS_RESOLUTIONS,
  voiceoverAssetId,
  type AudioBufferLike,
} from './waveformPeaks';

/** Deterministic in-memory buffer standing in for a real AudioBuffer. */
function fakeBuffer(opts: {
  seconds: number;
  sampleRate?: number;
  channels?: number;
  value?: (sampleIndex: number, channel: number) => number;
}): AudioBufferLike {
  const sampleRate = opts.sampleRate ?? 100;
  const channels = opts.channels ?? 1;
  const value = opts.value ?? (() => 0);
  const length = Math.round(opts.seconds * sampleRate);
  return {
    duration: opts.seconds,
    sampleRate,
    numberOfChannels: channels,
    getChannelData: (channel: number) =>
      Float32Array.from({ length }, (_, i) => value(i, channel)),
  };
}

/** Cache factory wired to spies so tests can count decodes and extractions. */
function countingDeps(buffer: AudioBufferLike) {
  const decodeAudioData = vi.fn(async () => buffer);
  const extract = vi.fn((b: AudioBufferLike, resolution: number) => extractPeaks(b, resolution));
  return { deps: { decodeAudioData, extractPeaks: extract }, decodeAudioData, extract };
}

describe('extractPeaks', () => {
  it('returns exact min/max pairs per bucket', () => {
    // 2s at 100Hz = 200 samples; first second sits at -0.5, second at 0.25.
    // At 10 buckets/second each bucket holds 10 samples of one flat value.
    const buffer = fakeBuffer({ seconds: 2, value: i => (i < 100 ? -0.5 : 0.25) });
    const channels = extractPeaks(buffer, 10);
    const peaks = channels[0];

    expect(peaks.length).toBe(40); // 20 buckets × [min, max]
    for (let b = 0; b < 10; b++) {
      expect([peaks[b * 2], peaks[b * 2 + 1]]).toEqual([-0.5, -0.5]);
    }
    for (let b = 10; b < 20; b++) {
      expect([peaks[b * 2], peaks[b * 2 + 1]]).toEqual([0.25, 0.25]);
    }
  });

  it('tracks both extremes inside a bucket', () => {
    // 0..9 alternating -1/1 within every 10-sample bucket.
    const buffer = fakeBuffer({ seconds: 1, value: i => (i % 10 < 5 ? -1 : 1) });
    const peaks = extractPeaks(buffer, 10)[0];

    for (let b = 0; b < 10; b++) {
      expect([peaks[b * 2], peaks[b * 2 + 1]]).toEqual([-1, 1]);
    }
  });

  it('extracts channels independently', () => {
    const buffer = fakeBuffer({
      seconds: 1,
      channels: 2,
      value: (i, ch) => (ch === 0 ? 0.5 : -0.25),
    });
    const channels = extractPeaks(buffer, 10);

    expect(channels).toHaveLength(2);
    expect([channels[0][0], channels[0][1]]).toEqual([0.5, 0.5]);
    expect([channels[1][0], channels[1][1]]).toEqual([-0.25, -0.25]);
  });

  it('rounds bucket counts up for partial buckets', () => {
    // 2.05s at 10 buckets/second → 21 buckets.
    const buffer = fakeBuffer({ seconds: 2.05 });
    expect(extractPeaks(buffer, 10)[0].length).toBe(42);
  });

  it('rejects non-positive resolutions', () => {
    const buffer = fakeBuffer({ seconds: 1 });
    expect(() => extractPeaks(buffer, 0)).toThrow();
    expect(() => extractPeaks(buffer, -5)).toThrow();
  });
});

describe('peaksResolutionFor', () => {
  it('picks the smallest resolution covering the zoom level', () => {
    expect(peaksResolutionFor(5)).toBe(10);
    expect(peaksResolutionFor(10)).toBe(10);
    expect(peaksResolutionFor(50)).toBe(50);
    expect(peaksResolutionFor(51)).toBe(200);
    expect(peaksResolutionFor(500)).toBe(200);
  });
});

describe('createWaveformPeaksCache', () => {
  it('decodes an asset once and serves repeat requests from cache', async () => {
    const { deps, decodeAudioData, extract } = countingDeps(fakeBuffer({ seconds: 2 }));
    const cache = createWaveformPeaksCache(deps);

    const first = await cache.get('asset', new Blob(), 50);
    const second = await cache.get('asset', new Blob(), 50);

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(second).toBe(first); // identical cached array, not a recompute
  });

  it('caches each resolution separately under its own key', async () => {
    const { deps, decodeAudioData, extract } = countingDeps(fakeBuffer({ seconds: 2 }));
    const cache = createWaveformPeaksCache(deps);

    const low = await cache.get('asset', new Blob(), 10);
    const high = await cache.get('asset', new Blob(), 200);

    // One decode shared across resolutions, one extraction per resolution.
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(low[0].length).not.toBe(high[0].length);

    // Both resolutions remain independently cached.
    expect(await cache.get('asset', new Blob(), 10)).toBe(low);
    expect(await cache.get('asset', new Blob(), 200)).toBe(high);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('keys different assets independently', async () => {
    const { deps, decodeAudioData } = countingDeps(fakeBuffer({ seconds: 1 }));
    const cache = createWaveformPeaksCache(deps);

    const a = await cache.get('asset-a', new Blob(), 50);
    const b = await cache.get('asset-b', new Blob(), 50);

    expect(decodeAudioData).toHaveBeenCalledTimes(2);
    expect(a).not.toBe(b);
  });

  it('shares one in-flight decode across concurrent resolution requests', async () => {
    const { deps, decodeAudioData, extract } = countingDeps(fakeBuffer({ seconds: 2 }));
    const cache = createWaveformPeaksCache(deps);

    const [low, high] = await Promise.all([
      cache.get('asset', new Blob(), 10),
      cache.get('asset', new Blob(), 200),
    ]);

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(low[0].length).not.toBe(high[0].length);
  });

  it('recomputes after invalidation — a re-import never serves stale peaks', async () => {
    const { deps, decodeAudioData, extract } = countingDeps(fakeBuffer({ seconds: 2 }));
    const cache = createWaveformPeaksCache(deps);

    const before = await cache.get('asset', new Blob(), 50);
    await cache.get('asset', new Blob(), 50); // cache hit
    cache.invalidate('asset');
    const after = await cache.get('asset', new Blob(), 50);

    expect(decodeAudioData).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(after).not.toBe(before);
  });

  it('retries after a failed decode instead of caching the failure', async () => {
    const decodeAudioData = vi.fn()
      .mockRejectedValueOnce(new Error('corrupt audio'))
      .mockResolvedValueOnce(fakeBuffer({ seconds: 1 }));
    const cache = createWaveformPeaksCache({ decodeAudioData });

    await expect(cache.get('asset', new Blob(), 50)).rejects.toThrow('corrupt audio');
    const peaks = await cache.get('asset', new Blob(), 50);

    expect(decodeAudioData).toHaveBeenCalledTimes(2);
    expect(peaks[0].length).toBe(100); // 1s at 50 buckets/second → 50 [min, max] pairs
  });

  it('drops the decoded buffer once every standard resolution is cached', async () => {
    const { deps, decodeAudioData } = countingDeps(fakeBuffer({ seconds: 1 }));
    const cache = createWaveformPeaksCache(deps);

    for (const resolution of PEAKS_RESOLUTIONS) {
      await cache.get('asset', new Blob(), resolution);
    }
    expect(decodeAudioData).toHaveBeenCalledTimes(1);

    // An off-registry resolution must still work — by re-decoding, proving
    // the large decoded buffer was released after the tiers were cached.
    await cache.get('asset', new Blob(), 7);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });
});

describe('asset ids', () => {
  it('keys file-backed voiceovers by name and size', () => {
    const file = new File([new Uint8Array(4)], 'take.wav');
    expect(voiceoverAssetId({ file, url: 'blob:x' })).toBe('take.wav::4');
  });

  it('keys TTS voiceovers by their blob URL', () => {
    expect(voiceoverAssetId({ url: 'blob:tts-1' })).toBe('url::blob:tts-1');
  });
});
