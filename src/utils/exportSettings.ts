/**
 * Persisted export settings: aspect preset, recording quality, and codec
 * preference. Kept in localStorage and restored on load so a returning user's
 * export panel matches how they last exported.
 *
 * Pure logic only — storage is injectable, so load/save round-trips are unit
 * tested in node without jsdom. Codec selection and MediaRecorder fallback
 * live in `exportCodecs.ts`; this module only stores the user's preference.
 */

import { DEFAULT_EXPORT_CODEC, EXPORT_CODECS, type ExportCodecId } from './exportCodecs';
import { DEFAULT_EXPORT_PRESET, EXPORT_PRESETS, type ExportPresetId } from './exportPresets';
import {
  DEFAULT_QUALITY_PRESET,
  QUALITY_PRESETS,
  type QualityPresetId,
} from './qualityPresets';

export interface ExportSettings {
  presetId: ExportPresetId;
  /** Quality tier — the tier table and bitrate math live in qualityPresets. */
  quality: QualityPresetId;
  /** Preferred recording container; selection and fallback live in exportCodecs. */
  codec: ExportCodecId;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  presetId: DEFAULT_EXPORT_PRESET,
  quality: DEFAULT_QUALITY_PRESET,
  codec: DEFAULT_EXPORT_CODEC,
};

export const EXPORT_SETTINGS_STORAGE_KEY = 'syncro_export_settings';

/** Minimal shape of Storage the module needs — makes tests trivial. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const EXPORT_QUALITY_IDS = Object.keys(QUALITY_PRESETS) as QualityPresetId[];
const EXPORT_CODEC_IDS = Object.keys(EXPORT_CODECS) as ExportCodecId[];

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isExportPresetId(value: unknown): value is ExportPresetId {
  return typeof value === 'string' && value in EXPORT_PRESETS;
}

/**
 * Read the persisted settings, falling back per-field so one unknown value
 * (e.g. after a preset rename, or a legacy `auto` codec) never discards
 * the others.
 */
export function loadExportSettings(storage: StorageLike = localStorage): ExportSettings {
  const raw = storage.getItem(EXPORT_SETTINGS_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_EXPORT_SETTINGS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }
  const obj = parsed as Record<string, unknown>;
  return {
    presetId: isExportPresetId(obj.presetId) ? obj.presetId : DEFAULT_EXPORT_SETTINGS.presetId,
    quality: isOneOf(obj.quality, EXPORT_QUALITY_IDS) ? obj.quality : DEFAULT_EXPORT_SETTINGS.quality,
    codec: isOneOf(obj.codec, EXPORT_CODEC_IDS) ? obj.codec : DEFAULT_EXPORT_SETTINGS.codec,
  };
}

export function saveExportSettings(settings: ExportSettings, storage: StorageLike = localStorage): void {
  storage.setItem(EXPORT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
