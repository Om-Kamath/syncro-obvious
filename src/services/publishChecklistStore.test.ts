import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  EMPTY_CHECKLIST_STATE,
  checklistFromJSON,
  checklistToJSON,
  choosePlatform,
  loadChecklistState,
  saveChecklistState,
  setPlatformChoices,
  tryLoadChecklistState,
  type PublishChecklistState,
} from './publishChecklistStore';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    clear: () => map.clear(),
    key: index => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const fullState: PublishChecklistState = {
  activePlatform: 'tiktok',
  platforms: {
    youtube: { title: 'Long-form deep dive', copy: 'YouTube copy text', thumbnailId: 'thumb-0' },
    shorts: { title: 'Hook in one line' },
    tiktok: { copy: 'Scroll-stopping caption', thumbnailId: 'thumb-1' },
    instagram: {},
  },
};

describe('checklist serialize/parse round-trip', () => {
  it('preserves the fully-populated state through serialize → parse', () => {
    expect(checklistFromJSON(checklistToJSON(fullState))).toEqual(fullState);
  });

  it('preserves the empty state through the same round-trip', () => {
    expect(checklistFromJSON(checklistToJSON(EMPTY_CHECKLIST_STATE))).toEqual(EMPTY_CHECKLIST_STATE);
  });

  it('survives a save → load cycle through injected storage', () => {
    const storage = fakeStorage();
    saveChecklistState(fullState, storage);
    expect(loadChecklistState(storage)).toEqual(fullState);
  });
});

describe('checklistFromJSON validation', () => {
  it('throws on syntactically invalid JSON', () => {
    expect(() => checklistFromJSON('{not parseable')).toThrow('not parseable JSON');
  });

  it('throws when the payload is not an object', () => {
    expect(() => checklistFromJSON('"just a string"')).toThrow('expected an object');
    expect(() => checklistFromJSON('42')).toThrow('expected an object');
  });

  it('throws when activePlatform is missing or unknown', () => {
    expect(() => checklistFromJSON('{"platforms":{}}')).toThrow('activePlatform');
    expect(() =>
      checklistFromJSON('{"activePlatform":"vimeo","platforms":{}}')
    ).toThrow('activePlatform');
  });

  it('throws when platforms is not an object', () => {
    expect(() =>
      checklistFromJSON('{"activePlatform":"youtube","platforms":[]}')
    ).toThrow('platforms must be an object');
  });

  it('throws when a known choices field has the wrong type', () => {
    expect(() =>
      checklistFromJSON('{"activePlatform":"youtube","platforms":{"youtube":{"title":42}}}')
    ).toThrow('title must be a string');
    expect(() =>
      checklistFromJSON('{"activePlatform":"youtube","platforms":{"youtube":{"thumbnailId":7}}}')
    ).toThrow('thumbnailId must be a string');
  });

  it('throws when a platform entry is not an object', () => {
    expect(() =>
      checklistFromJSON('{"activePlatform":"youtube","platforms":{"youtube":"nonsense"}}')
    ).toThrow('platform choices must be an object');
  });

  it('drops unknown platform keys but keeps the known ones', () => {
    const json = JSON.stringify({
      activePlatform: 'youtube',
      platforms: {
        vimeo: { title: 'from a newer build' },
        youtube: { title: 'kept' },
      },
    });
    expect(checklistFromJSON(json)).toEqual({
      activePlatform: 'youtube',
      platforms: { youtube: { title: 'kept' } },
    });
  });

  it('drops unknown fields on a platform entry', () => {
    const json = JSON.stringify({
      activePlatform: 'youtube',
      platforms: { youtube: { title: 'kept', legacyField: 'dropped' } },
    });
    expect(checklistFromJSON(json)).toEqual({
      activePlatform: 'youtube',
      platforms: { youtube: { title: 'kept' } },
    });
  });
});

describe('pure state updates', () => {
  it('choosePlatform switches the active platform without mutating the original', () => {
    const next = choosePlatform(fullState, 'instagram');
    expect(next.activePlatform).toBe('instagram');
    expect(fullState.activePlatform).toBe('tiktok');
  });

  it('choosePlatform rejects unknown platform ids', () => {
    expect(() => choosePlatform(EMPTY_CHECKLIST_STATE, 'vimeo' as never)).toThrow('Unknown platform');
  });

  it('setPlatformChoices merges into the platform entry without mutating the original', () => {
    const next = setPlatformChoices(fullState, 'shorts', { thumbnailId: 'thumb-2' });
    expect(next.platforms.shorts).toEqual({ title: 'Hook in one line', thumbnailId: 'thumb-2' });
    expect(fullState.platforms.shorts).toEqual({ title: 'Hook in one line' });
  });

  it('setPlatformChoices creates the entry when the platform had none', () => {
    const next = setPlatformChoices(EMPTY_CHECKLIST_STATE, 'tiktok', { title: 'First choice' });
    expect(next.platforms.tiktok).toEqual({ title: 'First choice' });
    expect(EMPTY_CHECKLIST_STATE.platforms.tiktok).toBeUndefined();
  });
});

describe('localStorage edge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the empty state when nothing is saved', () => {
    expect(loadChecklistState(fakeStorage())).toEqual(EMPTY_CHECKLIST_STATE);
  });

  it('loadChecklistState throws on corrupted payloads; tryLoadChecklistState recovers', () => {
    const storage = fakeStorage({ syncro_publish_checklist: '{corrupted' });
    expect(() => loadChecklistState(storage)).toThrow();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tryLoadChecklistState(storage)).toEqual(EMPTY_CHECKLIST_STATE);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
