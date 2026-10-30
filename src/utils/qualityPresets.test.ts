import { describe, expect, it } from 'vitest';
import {
  AUDIO_TRACK_BITRATE_BPS,
  DEFAULT_QUALITY_PRESET,
  QUALITY_PRESETS,
  computeExportDuration,
  estimateExportSizeBytes,
  estimatePresetSizeBytes,
  formatEstimatedSize,
  type QualityPresetId,
} from './qualityPresets';

const bitrateOf = (id: QualityPresetId): number => {
  const bps = QUALITY_PRESETS[id].videoBitsPerSecond;
  if (bps === null) throw new Error(`${id} has no bitrate`);
  return bps;
};

describe('QUALITY_PRESETS', () => {
  it('offers low, medium, high, and source with the documented bitrate hints', () => {
    expect(bitrateOf('low')).toBe(1_000_000);
    expect(bitrateOf('medium')).toBe(2_500_000);
    expect(bitrateOf('high')).toBe(5_000_000);
    // Source intentionally passes no bitrate hint — the browser decides.
    expect(QUALITY_PRESETS.source.videoBitsPerSecond).toBeNull();
  });

  it('defaults to medium', () => {
    expect(DEFAULT_QUALITY_PRESET).toBe('medium');
  });

  it('ramps the bitrate strictly upward from low to high', () => {
    expect(bitrateOf('low')).toBeLessThan(bitrateOf('medium'));
    expect(bitrateOf('medium')).toBeLessThan(bitrateOf('high'));
  });

  it('covers exactly the four campaign quality levels', () => {
    expect(Object.keys(QUALITY_PRESETS).sort()).toEqual(['high', 'low', 'medium', 'source']);
  });
});

describe('estimateExportSizeBytes', () => {
  it('sizes (video + audio bitrate) × duration ÷ 8 in SI units', () => {
    // 1 Mbps video + 128 kbps audio for 10s = 1_128_000 bits/s × 10 ÷ 8
    expect(estimateExportSizeBytes(1_000_000, 10)).toBe(1_410_000);
    // 2.5 Mbps video for 60s = 2_628_000 × 60 ÷ 8 = 19_710_000
    expect(estimateExportSizeBytes(2_500_000, 60)).toBe(19_710_000);
  });

  it('honors a custom audio bitrate', () => {
    expect(estimateExportSizeBytes(2_000_000, 5, 0)).toBe(1_250_000);
    expect(estimateExportSizeBytes(2_000_000, 5, 64_000)).toBe(1_290_000);
  });

  it('returns zero bytes for a zero-length recording', () => {
    expect(estimateExportSizeBytes(5_000_000, 0)).toBe(0);
  });

  it('scales linearly with duration', () => {
    const perSecond = estimateExportSizeBytes(2_500_000, 1);
    expect(estimateExportSizeBytes(2_500_000, 30)).toBeCloseTo(perSecond * 30, 6);
  });
});

describe('estimatePresetSizeBytes', () => {
  it('estimates every fixed-bitrate preset from duration', () => {
    expect(estimatePresetSizeBytes(QUALITY_PRESETS.low, 30)).toBe(4_230_000);
    expect(estimatePresetSizeBytes(QUALITY_PRESETS.medium, 30)).toBe(9_855_000);
    expect(estimatePresetSizeBytes(QUALITY_PRESETS.high, 30)).toBe(19_230_000);
  });

  it('gives no numeric estimate for the browser-managed source preset', () => {
    expect(estimatePresetSizeBytes(QUALITY_PRESETS.source, 30)).toBeNull();
  });

  it('produces strictly larger estimates at higher quality for a fixed duration', () => {
    const sizeOf = (id: QualityPresetId) => estimatePresetSizeBytes(QUALITY_PRESETS[id], 45);
    expect(sizeOf('low')!).toBeLessThan(sizeOf('medium')!);
    expect(sizeOf('medium')!).toBeLessThan(sizeOf('high')!);
  });
});

describe('formatEstimatedSize', () => {
  it('formats sub-KB sizes in bytes', () => {
    expect(formatEstimatedSize(0)).toBe('0 B');
    expect(formatEstimatedSize(512)).toBe('512 B');
  });

  it('formats KB and MB with one decimal', () => {
    expect(formatEstimatedSize(4_230_000)).toBe('4.2 MB');
    expect(formatEstimatedSize(19_710_000)).toBe('19.7 MB');
  });

  it('formats GB with two decimals', () => {
    expect(formatEstimatedSize(1_500_000_000)).toBe('1.50 GB');
  });
});

describe('computeExportDuration', () => {
  it('uses the full duration when untrimmed', () => {
    expect(computeExportDuration({ duration: 42.5 })).toBe(42.5);
  });

  it('subtracts the trim start', () => {
    expect(computeExportDuration({ duration: 42.5, trimStart: 2.5 })).toBe(40);
  });

  it('records exactly the trimmed span when both trims are set', () => {
    expect(computeExportDuration({ duration: 42.5, trimStart: 2.5, trimEnd: 30 })).toBe(27.5);
  });
});

describe('audio bitrate constant', () => {
  it('assumes a 128 kbps audio track in the default estimate', () => {
    expect(AUDIO_TRACK_BITRATE_BPS).toBe(128_000);
  });
});
