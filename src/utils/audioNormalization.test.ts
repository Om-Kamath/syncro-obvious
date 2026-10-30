import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGET_DBFS,
  MAX_NORMALIZATION_GAIN_DB,
  amplitudeToDbfs,
  computeNormalizationGain,
  dbfsToAmplitude,
  scanPeak,
  trimWindowChannels,
  type AudioBufferLike,
} from './audioNormalization';

/** Synthetic buffer with an explicit loudest sample at the given amplitude. */
const channel = (values: number[]): Float32Array => Float32Array.from(values);

describe('dbfs conversions', () => {
  it('converts dBFS to linear amplitude and back', () => {
    expect(dbfsToAmplitude(-1)).toBeCloseTo(0.89125, 5);
    expect(amplitudeToDbfs(1)).toBeCloseTo(0, 5);
    expect(amplitudeToDbfs(dbfsToAmplitude(-6))).toBeCloseTo(-6, 5);
  });

  it('maps silence to null rather than -Infinity', () => {
    expect(amplitudeToDbfs(0)).toBeNull();
  });
});

describe('scanPeak', () => {
  it('finds the loudest sample across channels, ignoring sign', () => {
    expect(scanPeak([channel([0.1, -0.7, 0.3]), channel([0.2, -0.5, 0.9])])).toBeCloseTo(0.9, 6);
  });

  it('returns 0 for silence', () => {
    expect(scanPeak([new Float32Array(64)])).toBe(0);
  });
});

describe('computeNormalizationGain — synthetic buffers', () => {
  it('silence: gain is 1 (never amplifies the noise floor)', () => {
    const silence = [new Float32Array(1000), new Float32Array(1000)];
    expect(computeNormalizationGain(silence)).toBe(1);
  });

  it('clipping peak: scales 1.0 down to the −1.0 dBFS ceiling', () => {
    const clipping = [channel([1, -1, 1, -1, 1, -1])];
    const gain = computeNormalizationGain(clipping);
    expect(gain).toBeCloseTo(dbfsToAmplitude(DEFAULT_TARGET_DBFS), 5);
    // Applied to the buffer, the result lands on the target ceiling.
    expect(amplitudeToDbfs(scanPeak(clipping) * gain)).toBeCloseTo(DEFAULT_TARGET_DBFS, 5);
  });

  it('normal speech-level peak: scales up to the target without clipping', () => {
    const speech = [channel([0.05, 0.25, -0.2, 0.1])];
    const gain = computeNormalizationGain(speech);
    expect(gain).toBeCloseTo(dbfsToAmplitude(DEFAULT_TARGET_DBFS) / 0.25, 5);
    expect(gain).toBeLessThan(dbfsToAmplitude(MAX_NORMALIZATION_GAIN_DB));
    expect(amplitudeToDbfs(scanPeak(speech) * gain)).toBeCloseTo(DEFAULT_TARGET_DBFS, 5);
  });

  it('near-silence: gain is capped at the max-gain guard', () => {
    const faint = [channel([0.01, -0.005, 0.002])];
    const gain = computeNormalizationGain(faint);
    expect(gain).toBeCloseTo(dbfsToAmplitude(MAX_NORMALIZATION_GAIN_DB), 5);
  });

  it('honors a custom target and picks the peak across channels', () => {
    const twoChannel = [channel([0.1, 0.2]), channel([0.5, -0.4])];
    const gain = computeNormalizationGain(twoChannel, -3);
    expect(gain).toBeCloseTo(dbfsToAmplitude(-3) / 0.5, 5);
    expect(amplitudeToDbfs(scanPeak(twoChannel) * gain)).toBeCloseTo(-3, 5);
  });

  it('treats a target above 0 dBFS as full scale', () => {
    const hot = [channel([0.5, -0.5])];
    const gain = computeNormalizationGain(hot, 2);
    expect(scanPeak(hot) * gain).toBeCloseTo(1, 5);
  });
});

describe('trimWindowChannels', () => {
  // 20 samples at 10 Hz = 2.0 s of audio; sample i covers second i/10.
  const fakeBuffer = (data: number[], sampleRate = 10): AudioBufferLike => ({
    numberOfChannels: 1,
    sampleRate,
    length: data.length,
    getChannelData: () => Float32Array.from(data),
  });

  it('slices exactly the seconds window that the export records', () => {
    const decoded = fakeBuffer([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const window = trimWindowChannels(decoded, 0.2, 0.7);
    expect(Array.from(window[0])).toEqual([2, 3, 4, 5, 6]);
  });

  it('clamps the window to the buffer bounds', () => {
    const decoded = fakeBuffer([1, 2, 3, 4, 5]);
    expect(Array.from(trimWindowChannels(decoded, -1, 99)[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns empty channels for an inverted or empty window (gain 1 path)', () => {
    const decoded = fakeBuffer([1, 2, 3, 4, 5]);
    const window = trimWindowChannels(decoded, 0.7, 0.2);
    expect(window[0].length).toBe(0);
    expect(computeNormalizationGain(window)).toBe(1);
  });

  it('slices every channel plane independently', () => {
    const twoChannel: AudioBufferLike = {
      numberOfChannels: 2,
      sampleRate: 10,
      length: 10,
      getChannelData: (ch: number) =>
        ch === 0 ? Float32Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) : Float32Array.from([0, 0, 5, 0, 0, 0, 0, 0, 0, 0]),
    };
    const window = trimWindowChannels(twoChannel, 0, 1);
    expect(window).toHaveLength(2);
    expect(scanPeak(window)).toBe(9);
  });
});
