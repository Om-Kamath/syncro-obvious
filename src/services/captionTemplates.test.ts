import { describe, it, expect } from 'vitest';
import {
  templateToJSON,
  templateFromJSON,
  applyTemplate,
  upsertTemplate,
  removeTemplate,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  loadTemplatesResult,
} from './captionTemplates';
import { CaptionStyle, CaptionTemplate } from '../types';

const style: CaptionStyle = {
  mode: 'word-highlight',
  fontSize: 24,
  color: '#fbbf24',
  bgColor: '#111827',
  position: 'top',
};

const template: CaptionTemplate = { id: 'tpl1', name: 'Bold Pop', style, createdAt: 1_730_000_000_000 };

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

describe('template serialize/apply round-trip', () => {
  it('preserves the full style through serialize → parse → apply', () => {
    const restored = templateFromJSON(templateToJSON(template));
    expect(applyTemplate(restored)).toEqual(style);
  });

  it('restores id, name, and createdAt through the same round-trip', () => {
    const restored = templateFromJSON(templateToJSON(template));
    expect(restored).toEqual(template);
  });

  it('apply returns a defensive copy — mutating it leaves the template intact', () => {
    const applied = applyTemplate(template);
    applied.fontSize = 99;
    applied.color = '#000000';
    expect(template.style.fontSize).toBe(24);
    expect(template.style.color).toBe('#fbbf24');
  });
});

describe('templateFromJSON validation', () => {
  it('throws on syntactically invalid JSON', () => {
    expect(() => templateFromJSON('{not json')).toThrow('not parseable JSON');
  });

  it('throws on non-object payloads', () => {
    expect(() => templateFromJSON('42')).toThrow('expected an object');
  });

  it('throws on a missing or invalid style block', () => {
    const missing = JSON.stringify({ id: 'x', name: 'T', createdAt: 1 });
    expect(() => templateFromJSON(missing)).toThrow('missing style');
  });

  it('throws on an unknown caption mode', () => {
    const bad = JSON.stringify({ ...template, style: { ...style, mode: 'cinematic' } });
    expect(() => templateFromJSON(bad)).toThrow('unknown mode');
  });

  it('throws on a non-numeric fontSize', () => {
    const bad = JSON.stringify({ ...template, style: { ...style, fontSize: 'big' } });
    expect(() => templateFromJSON(bad)).toThrow('fontSize');
  });

  it('throws on an unknown position', () => {
    const bad = JSON.stringify({ ...template, style: { ...style, position: 'middle' } });
    expect(() => templateFromJSON(bad)).toThrow('unknown position');
  });

  it('throws when id or name are missing', () => {
    const noId = JSON.stringify({ name: 'T', createdAt: 1, style });
    const noName = JSON.stringify({ id: 'x', createdAt: 1, style });
    expect(() => templateFromJSON(noId)).toThrow('missing id');
    expect(() => templateFromJSON(noName)).toThrow('missing name');
  });
});

describe('upsertTemplate', () => {
  it('appends a new template with the given id and savedAt', () => {
    const next = upsertTemplate([], 'Bold Pop', style, 'tpl1', 5);
    expect(next).toEqual([{ id: 'tpl1', name: 'Bold Pop', style, createdAt: 5 }]);
  });

  it('overwrites an existing template of the same name, keeping its id', () => {
    const other: CaptionStyle = { ...style, fontSize: 12, mode: 'lower-third' };
    const next = upsertTemplate([template], 'Bold Pop', other, 'ignored', 9);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('tpl1');
    expect(next[0].style).toEqual(other);
    expect(next[0].createdAt).toBe(9);
  });

  it('trims whitespace around the name and rejects a blank one', () => {
    expect(upsertTemplate([], '  Padded  ', style, 't', 1)[0].name).toBe('Padded');
    expect(() => upsertTemplate([], '   ', style, 't', 1)).toThrow('name is required');
  });
});

describe('removeTemplate', () => {
  it('drops only the template with the matching id', () => {
    const second: CaptionTemplate = { ...template, id: 'tpl2', name: 'Minimal' };
    const next = removeTemplate([template, second], 'tpl1');
    expect(next).toEqual([second]);
  });
});

describe('storage wrappers', () => {
  it('listTemplates returns an empty list when nothing is stored', () => {
    expect(listTemplates(fakeStorage())).toEqual([]);
  });

  it('save → list restores the full template including style', () => {
    const storage = fakeStorage();
    saveTemplate('Bold Pop', style, storage);
    const listed = listTemplates(storage);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Bold Pop');
    expect(applyTemplate(listed[0])).toEqual(style);
  });

  it('save with an existing name updates the stored template in place', () => {
    const storage = fakeStorage();
    saveTemplate('Bold Pop', style, storage);
    saveTemplate('Bold Pop', { ...style, fontSize: 30 }, storage);
    const listed = listTemplates(storage);
    expect(listed).toHaveLength(1);
    expect(listed[0].style.fontSize).toBe(30);
  });

  it('delete removes the template from storage', () => {
    const storage = fakeStorage();
    saveTemplate('Bold Pop', style, storage);
    const [saved] = listTemplates(storage);
    deleteTemplate(saved.id, storage);
    expect(listTemplates(storage)).toEqual([]);
  });

  it('listTemplates surfaces corrupted storage instead of silently emptying', () => {
    expect(() => listTemplates(fakeStorage({ syncro_caption_templates: '{oops' }))).toThrow('corrupted');
  });

  it('loadTemplatesResult returns templates on success', () => {
    const storage = fakeStorage();
    saveTemplate('Bold Pop', style, storage);
    const result = loadTemplatesResult(storage);
    expect(result.error).toBeNull();
    expect(result.templates).toHaveLength(1);
    expect(applyTemplate(result.templates[0])).toEqual(style);
  });

  it('loadTemplatesResult returns an empty list plus the error message on corruption', () => {
    const result = loadTemplatesResult(fakeStorage({ syncro_caption_templates: '{oops' }));
    expect(result.templates).toEqual([]);
    expect(result.error).toMatch(/corrupted/);
  });
});
