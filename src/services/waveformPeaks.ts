import type { Voiceover } from '../types';
import { LruCache } from '../utils/lruCache';

/**
 * Waveform peaks cache.
 *
 * Audio decoding — not rendering — is the expensive part of waveform display:
 * the timeline's WaveSurfer instance is remounted whenever the voiceover
 * object identity changes (every drag frame, trim, or segment update), and
 * each remount used to re-fetch and re-decode the whole asset.
 *
 * This module decodes each audio asset once, extracts per-channel min/max
 * peak pairs at several zoom resolutions, and caches them keyed by
 * `assetId :: resolution`. Peaks are invalidated whenever an asset id is
 * re-imported or its voiceover replaced, so changed bytes under the same
 * key can never serve stale waveform data.
 *
 * Peak format matches WaveSurfer v7's `peaks` option: one Float32Array per
 * channel holding alternating `[min, max]` pairs, two numbers per bucket.
 */

/** Structural subset of AudioBuffer the cache needs — keeps the module testable without WebAudio. */
export interface AudioBufferLike {
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** One channel's peaks: alternating [min, max] pairs, two numbers per bucket. */
export type ChannelPeaks = Float32Array;

/**
 * Cached zoom resolutions, in peak buckets per second. The timeline maps its
 * pixels-per-second zoom to the smallest resolution that still renders at
 * least one peak bucket per pixel column.
 */
export const PEAKS_RESOLUTIONS = [10, 50, 200] as const;

/** Smallest cached resolution covering the given zoom (pixels per second). */
export function peaksResolutionFor(pixelsPerSecond: number): number {
  for (const resolution of PEAKS_RESOLUTIONS) {
    if (resolution >= pixelsPerSecond) return resolution;
  }
  return PEAKS_RESOLUTIONS[PEAKS_RESOLUTIONS.length - 1];
}

/**
 * Extract per-channel min/max peak pairs from a decoded buffer at the
 * requested resolution. Pure — safe to call repeatedly on any buffer.
 */
export function extractPeaks(buffer: AudioBufferLike, bucketsPerSecond: number): ChannelPeaks[] {
  if (!(bucketsPerSecond > 0)) throw new Error('extractPeaks: bucketsPerSecond must be > 0');

  const channels: ChannelPeaks[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    const bucketCount = Math.max(1, Math.ceil((data.length / buffer.sampleRate) * bucketsPerSecond));
    const samplesPerBucket = data.length / bucketCount;
    const peaks = new Float32Array(bucketCount * 2);
    for (let b = 0; b < bucketCount; b++) {
      const start = Math.floor(b * samplesPerBucket);
      const end = Math.min(data.length, Math.floor((b + 1) * samplesPerBucket));
      let min = data[start] ?? 0;
      let max = min;
      for (let i = start + 1; i < end; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }
      peaks[b * 2] = min;
      peaks[b * 2 + 1] = max;
    }
    channels.push(peaks);
  }
  return channels;
}

/** Stable cache key for an uploaded file — mirrors gemini.ts's Files-API key (`name::size`). */
export function fileAssetId(file: { name: string; size: number }): string {
  return `${file.name}::${file.size}`;
}

/** Cache key for a Syncro voiceover: file-backed assets key on the file, TTS audio on its blob URL. */
export function voiceoverAssetId(voiceover: Pick<Voiceover, 'file' | 'url'>): string {
  return voiceover.file ? fileAssetId(voiceover.file) : `url::${voiceover.url}`;
}

interface AssetEntry {
  buffer: AudioBufferLike | null;
  /** Peaks per resolution key (buckets per second). */
  peaks: Map<number, ChannelPeaks[]>;
  /** In-flight decode shared by concurrent resolutions. */
  decoding: Promise<AudioBufferLike> | null;
}

export interface WaveformPeaksDeps {
  /** Decode an audio blob into a buffer. Defaults to a shared WebAudio context. */
  decodeAudioData?: (blob: Blob) => Promise<AudioBufferLike>;
  /** Peak extraction. Defaults to {@link extractPeaks} — injectable for tests. */
  extractPeaks?: typeof extractPeaks;
}

export interface WaveformPeaksCache {
  /**
   * Returns the asset's peaks at the requested resolution, decoding and
   * extracting on a miss. Concurrent callers share one in-flight decode.
   */
  get(assetId: string, blob: Blob, bucketsPerSecond: number): Promise<ChannelPeaks[]>;
  /** Drops every cached resolution for the asset — re-imports and removals. */
  invalidate(assetId: string): void;
}

let sharedAudioContext: AudioContext | null = null;

async function decodeWithWebAudio(blob: Blob): Promise<AudioBufferLike> {
  sharedAudioContext ??= new AudioContext();
  return sharedAudioContext.decodeAudioData(await blob.arrayBuffer());
}

// A session holds a handful of audio assets; evicted entries simply
// re-decode on next use, same tradeoff as gemini.ts's Files-API cache.
const MAX_CACHED_ASSETS = 8;

export function createWaveformPeaksCache(deps: WaveformPeaksDeps = {}): WaveformPeaksCache {
  const decodeAudioData = deps.decodeAudioData ?? decodeWithWebAudio;
  const extract = deps.extractPeaks ?? extractPeaks;
  const assets = new LruCache<string, AssetEntry>(MAX_CACHED_ASSETS);

  return {
    async get(assetId: string, blob: Blob, bucketsPerSecond: number): Promise<ChannelPeaks[]> {
      let entry = assets.get(assetId);
      if (!entry) {
        entry = { buffer: null, peaks: new Map(), decoding: null };
        assets.set(assetId, entry);
      }
      const e = entry;

      const cached = e.peaks.get(bucketsPerSecond);
      if (cached) return cached;

      if (!e.buffer) {
        e.decoding ??= decodeAudioData(blob)
          .then(buffer => {
            e.buffer = buffer;
            e.decoding = null;
            return buffer;
          })
          .catch(error => {
            // A failed decode must not poison the entry: drop it so the
            // next call retries from scratch instead of caching the error.
            e.decoding = null;
            if (assets.get(assetId) === e) assets.delete(assetId);
            throw error;
          });
        await e.decoding;
      }
      const buffer = e.buffer;
      if (!buffer) throw new Error(`Waveform decode produced no buffer for "${assetId}"`);

      const peaks = extract(buffer, bucketsPerSecond);
      e.peaks.set(bucketsPerSecond, peaks);

      // Once every standard resolution is materialized the decoded buffer —
      // by far the largest object here (hundreds of MB for long audio) — is
      // no longer needed. Off-registry resolutions simply re-decode.
      if (PEAKS_RESOLUTIONS.every(resolution => e.peaks.has(resolution))) e.buffer = null;

      return peaks;
    },

    invalidate(assetId: string): void {
      assets.delete(assetId);
    },
  };
}

const sharedCache = createWaveformPeaksCache();

/** Cache-backed waveform peaks for one asset at one resolution. */
export const getWaveformPeaks = (assetId: string, blob: Blob, bucketsPerSecond: number): Promise<ChannelPeaks[]> =>
  sharedCache.get(assetId, blob, bucketsPerSecond);

/** Drops every cached resolution for an asset — call when it is re-imported or removed. */
export const invalidateWaveformPeaks = (assetId: string): void => sharedCache.invalidate(assetId);
