import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, FEATURE_MODELS, modelFor } from './models';

describe('MODELS registry', () => {
  it('exposes exactly the expected registry keys', () => {
    expect(Object.keys(MODELS).sort()).toEqual(['flash', 'flashLite', 'tts']);
  });

  it('pins the current GA model ids', () => {
    expect(MODELS.tts).toBe('gemini-3.8-flash-tts');
    expect(MODELS.flashLite).toBe('gemini-3.5-flash-lite');
    expect(MODELS.flash).toBe('gemini-3.8-flash');
  });

  it('uses well-formed, unique model ids', () => {
    const values = Object.values(MODELS);
    expect(values.every(id => /^gemini-[a-z0-9.-]+$/.test(id))).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it('no longer references the shutting-down 2.5 preview TTS, 2.5 flash-lite, or the 3 preview flash', () => {
    const values = Object.values(MODELS).join(' ');
    expect(values).not.toContain('gemini-2.5-flash-preview-tts');
    expect(values).not.toContain('gemini-2.5-flash-lite');
    expect(values).not.toContain('gemini-3-flash-preview');
  });
});

describe('FEATURE_MODELS', () => {
  it('covers every app feature with a valid registry key', () => {
    expect(Object.keys(FEATURE_MODELS).sort()).toEqual([
      'clipAlignment',
      'description',
      'narration',
      'thumbnails',
      'transcription',
      'tts',
      'videoAnalysis',
    ]);
    for (const key of Object.values(FEATURE_MODELS)) {
      expect(MODELS[key]).toBeTruthy();
    }
  });

  it('resolves each feature to its pinned model id', () => {
    expect(modelFor('tts')).toBe(MODELS.tts);
    expect(modelFor('narration')).toBe(MODELS.flashLite);
    expect(modelFor('transcription')).toBe(MODELS.flashLite);
    expect(modelFor('videoAnalysis')).toBe(MODELS.flashLite);
    expect(modelFor('clipAlignment')).toBe(MODELS.flashLite);
    expect(modelFor('description')).toBe(MODELS.flash);
    expect(modelFor('thumbnails')).toBe(MODELS.flash);
  });
});

describe('model id locality', () => {
  // Walk src/ and assert no non-test source file contains a model id literal.
  // Tests are exempt: they cite ids in assertions to pin behavior.
  const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

  function listSourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return listSourceFiles(p);
      return /\.tsx?$/.test(name) ? [p] : [];
    });
  }

  it('keeps every model id string inside models.ts', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_DIR)) {
      if (file.endsWith('models.ts') || /\.test\.tsx?$/.test(file)) continue;
      const matches = readFileSync(file, 'utf8').match(/gemini-[a-z0-9._-]+/g);
      if (matches?.length) offenders.push(`${file}: ${matches.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
