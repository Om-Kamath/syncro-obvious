/**
 * Export quality presets mapping to the MediaRecorder `videoBitsPerSecond`
 * hint, plus the size-estimate math the ExportTab surfaces before recording.
 *
 * Pure math, no DOM — same contract as exportPresets.ts.
 */

export type QualityPresetId = 'low' | 'medium' | 'high' | 'source';

export interface QualityPreset {
  id: QualityPresetId;
  label: string;
  description: string;
  /**
   * Target video bitrate in bits per second. `null` means "Source": no hint is
   * passed to MediaRecorder and the browser picks the bitrate for the canvas
   * resolution — the pre-existing export behavior.
   */
  videoBitsPerSecond: number | null;
}

export const QUALITY_PRESETS: Record<QualityPresetId, QualityPreset> = {
  low: {
    id: 'low',
    label: 'Low',
    description: 'Drafts',
    videoBitsPerSecond: 1_000_000,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    description: 'Balanced',
    videoBitsPerSecond: 2_500_000,
  },
  high: {
    id: 'high',
    label: 'High',
    description: 'Max detail',
    videoBitsPerSecond: 5_000_000,
  },
  source: {
    id: 'source',
    label: 'Source',
    description: 'Browser default',
    videoBitsPerSecond: null,
  },
};

export const DEFAULT_QUALITY_PRESET: QualityPresetId = 'medium';

/**
 * The audio track fed to the recorder (voiceover) is not covered by
 * `videoBitsPerSecond`, so assume a 128 kbps audio track when estimating
 * instead of pretending audio is free.
 */
export const AUDIO_TRACK_BITRATE_BPS = 128_000;

/**
 * Rough recorded file size in bytes: (video + audio bitrate) × duration ÷ 8.
 * SI units throughout — 1 Mbps = 1,000,000 bits/s and 1 MB = 1,000,000 bytes —
 * matching how MediaRecorder bitrate hints are quoted.
 */
export function estimateExportSizeBytes(
  videoBitsPerSecond: number,
  durationSeconds: number,
  audioBitsPerSecond: number = AUDIO_TRACK_BITRATE_BPS,
): number {
  return ((videoBitsPerSecond + audioBitsPerSecond) * durationSeconds) / 8;
}

/** Size estimate for a preset; `null` when the bitrate is browser-managed. */
export function estimatePresetSizeBytes(
  preset: QualityPreset,
  durationSeconds: number,
  audioBitsPerSecond: number = AUDIO_TRACK_BITRATE_BPS,
): number | null {
  return preset.videoBitsPerSecond === null
    ? null
    : estimateExportSizeBytes(preset.videoBitsPerSecond, durationSeconds, audioBitsPerSecond);
}

/** Human file-size string in SI units (1 MB = 10^6 bytes). */
export function formatEstimatedSize(bytes: number): string {
  if (bytes < 1_000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/** Length of audio actually recorded in the export, after trims. */
export function computeExportDuration(voiceover: {
  duration: number;
  trimStart?: number;
  trimEnd?: number;
}): number {
  return (voiceover.trimEnd ?? voiceover.duration) - (voiceover.trimStart ?? 0);
}
