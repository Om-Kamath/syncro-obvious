import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_PRESET, EXPORT_PRESETS } from './exportPresets';
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_SETTINGS_STORAGE_KEY,
  loadExportSettings,
  saveExportSettings,
  type ExportSettings,
} from './exportSettings';

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('loadExportSettings / saveExportSettings round-trip', () => {
  it('persists settings and restores them exactly', () => {
    const storage = memoryStorage();
    const settings: ExportSettings = { presetId: 'vertical', quality: 'source', codec: 'webm' };

    saveExportSettings(settings, storage);

    expect(storage.getItem(EXPORT_SETTINGS_STORAGE_KEY)).toBeTypeOf('string');
    expect(loadExportSettings(storage)).toEqual(settings);
  });

  it('returns defaults when nothing has been saved yet', () => {
    expect(loadExportSettings(memoryStorage())).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('does not alias the defaults object when returning it', () => {
    const settings = loadExportSettings(memoryStorage());
    settings.quality = 'source';
    expect(DEFAULT_EXPORT_SETTINGS.quality).toBe('medium');
  });
});

describe('loadExportSettings validation', () => {
  it('falls back to defaults on malformed JSON', () => {
    const storage = memoryStorage({ [EXPORT_SETTINGS_STORAGE_KEY]: '{not valid json' });
    expect(loadExportSettings(storage)).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('falls back to defaults when the stored value is not an object', () => {
    for (const raw of ['42', '"webm"', 'null', '[1,2]']) {
      const storage = memoryStorage({ [EXPORT_SETTINGS_STORAGE_KEY]: raw });
      expect(loadExportSettings(storage)).toEqual(DEFAULT_EXPORT_SETTINGS);
    }
  });

  it('falls back per field, keeping valid fields when one is unknown', () => {
    const storage = memoryStorage({
      [EXPORT_SETTINGS_STORAGE_KEY]: JSON.stringify({
        presetId: 'square',
        quality: 'ultra',
        codec: 'mp4',
      }),
    });
    expect(loadExportSettings(storage)).toEqual({
      presetId: 'square',
      quality: DEFAULT_EXPORT_SETTINGS.quality,
      codec: 'mp4',
    });
  });

  it('falls back to the default codec for values upstream no longer supports (legacy `auto`)', () => {
    const storage = memoryStorage({
      [EXPORT_SETTINGS_STORAGE_KEY]: JSON.stringify({ presetId: 'vertical', quality: 'high', codec: 'auto' }),
    });
    const settings = loadExportSettings(storage);
    expect(settings.codec).toBe(DEFAULT_EXPORT_SETTINGS.codec);
    expect(settings.quality).toBe('high');
    expect(settings.presetId).toBe('vertical');
  });

  it('falls back to the default preset when the stored preset no longer exists', () => {
    const storage = memoryStorage({
      [EXPORT_SETTINGS_STORAGE_KEY]: JSON.stringify({ presetId: 'cinemascope' }),
    });
    const settings = loadExportSettings(storage);
    expect(settings.presetId).toBe(DEFAULT_EXPORT_PRESET);
    expect(settings.presetId).toBe('wide');
  });
});

describe('EXPORT_PRESETS integration', () => {
  it('stores preset ids that round-trip back into the preset table', () => {
    for (const id of Object.keys(EXPORT_PRESETS)) {
      const storage = memoryStorage({
        [EXPORT_SETTINGS_STORAGE_KEY]: JSON.stringify({ presetId: id }),
      });
      expect(loadExportSettings(storage).presetId).toBe(id);
    }
  });
});
