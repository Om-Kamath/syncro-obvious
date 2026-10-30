/**
 * Export aspect presets and the canvas draw geometry for each.
 *
 * Pure math, no DOM — the ExportTab canvas exporter consumes this at draw time,
 * and the unit tests pin the geometry per preset.
 */

export type ExportPresetId = 'wide' | 'vertical' | 'square';

/** contain = letterbox (full frame visible); cover = smart crop (fill canvas, center-crop overflow). */
export type ExportFitMode = 'contain' | 'cover';

export interface ExportPreset {
  id: ExportPresetId;
  label: string;
  description: string;
  width: number;
  height: number;
  fit: ExportFitMode;
}

/**
 * 16:9 keeps the historical contain/letterbox behavior. 9:16 and 1:1 default to
 * smart crop because 16:9 source footage letterboxed into a tall/square canvas
 * leaves bars wider than the picture — the crop reads as intentional framing instead.
 */
export const EXPORT_PRESETS: Record<ExportPresetId, ExportPreset> = {
  wide: {
    id: 'wide',
    label: '16:9',
    description: 'YouTube landscape',
    width: 1280,
    height: 720,
    fit: 'contain',
  },
  vertical: {
    id: 'vertical',
    label: '9:16',
    description: 'Shorts · TikTok · Reels',
    width: 1080,
    height: 1920,
    fit: 'cover',
  },
  square: {
    id: 'square',
    label: '1:1',
    description: 'Instagram feed',
    width: 1080,
    height: 1080,
    fit: 'cover',
  },
};

export const DEFAULT_EXPORT_PRESET: ExportPresetId = 'wide';

export interface DrawGeometry {
  dx: number;
  dy: number;
  dWidth: number;
  dHeight: number;
}

/** Scale the frame to fit entirely inside the canvas, centered (letterbox bars where the aspect differs). */
export function computeContainGeometry(
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number
): DrawGeometry {
  const scale = Math.min(canvasWidth / videoWidth, canvasHeight / videoHeight);
  const dWidth = videoWidth * scale;
  const dHeight = videoHeight * scale;
  return {
    dx: (canvasWidth - dWidth) / 2,
    dy: (canvasHeight - dHeight) / 2,
    dWidth,
    dHeight,
  };
}

/** Scale the frame to fill the canvas completely, centered so the crop is symmetric (smart crop). */
export function computeCoverGeometry(
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number
): DrawGeometry {
  const scale = Math.max(canvasWidth / videoWidth, canvasHeight / videoHeight);
  const dWidth = videoWidth * scale;
  const dHeight = videoHeight * scale;
  return {
    dx: (canvasWidth - dWidth) / 2,
    dy: (canvasHeight - dHeight) / 2,
    dWidth,
    dHeight,
  };
}

/**
 * Draw geometry for a source frame on the preset's canvas. When the video
 * dimensions are unknown (metadata not loaded), fall back to stretching the
 * frame across the full canvas — the exporter's historical behavior.
 */
export function computeDrawGeometry(preset: ExportPreset, videoWidth: number, videoHeight: number): DrawGeometry {
  if (!videoWidth || !videoHeight) {
    return { dx: 0, dy: 0, dWidth: preset.width, dHeight: preset.height };
  }
  return preset.fit === 'contain'
    ? computeContainGeometry(videoWidth, videoHeight, preset.width, preset.height)
    : computeCoverGeometry(videoWidth, videoHeight, preset.width, preset.height);
}
