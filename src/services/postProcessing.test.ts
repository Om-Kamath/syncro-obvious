import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { generateContentMock, getModelSettingsMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  getModelSettingsMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
  Type: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
  },
}));

vi.mock('./apiKey', () => ({
  getApiKey: () => 'test-key',
}));

vi.mock('./modelSettings', () => ({
  getModelSettings: getModelSettingsMock,
}));

import { generateDescription, identifyKeyMoments, parseModelJson } from './postProcessing';
import { subscribe } from './logger';
import type { LogEntry } from './logger';
import { MODELS } from './models';

const noopTranscription = 'hello world';
const noopSegments = [{ text: 'hello world', start: 0, end: 2 }];
const noopAnalyses = ['a video'];

describe('parseModelJson', () => {
  it('parses valid JSON', () => {
    expect(parseModelJson<{ a: number }>('{"a":1}', 'Test')).toEqual({ a: 1 });
  });

  it('throws on malformed JSON instead of returning empty results', () => {
    expect(() => parseModelJson('not json at all', 'Test')).toThrow(/malformed JSON/i);
  });

  it('throws on an empty response', () => {
    expect(() => parseModelJson('', 'Test')).toThrow(/empty response/i);
    expect(() => parseModelJson(undefined, 'Test')).toThrow(/empty response/i);
  });
});

describe('generateDescription', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    getModelSettingsMock.mockReset().mockReturnValue({});
  });

  it('returns the parsed description on valid output', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ summary: 'A summary', chapters: [{ time: 0, label: 'Intro' }], hashtags: ['video'] }),
    });
    const result = await generateDescription(noopTranscription, noopSegments, noopAnalyses);
    expect(result.summary).toBe('A summary');
    expect(result.hashtags).toEqual(['video']);
  });

  it('raises when the model returns malformed JSON (no silent empty result)', async () => {
    generateContentMock.mockResolvedValue({ text: '}}{{ garbage' });
    await expect(
      generateDescription(noopTranscription, noopSegments, noopAnalyses)
    ).rejects.toThrow(/malformed JSON/i);
  });

  it('raises when the model returns an empty response', async () => {
    generateContentMock.mockResolvedValue({ text: '' });
    await expect(
      generateDescription(noopTranscription, noopSegments, noopAnalyses)
    ).rejects.toThrow(/empty response/i);
  });
});

describe('identifyKeyMoments', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    getModelSettingsMock.mockReset().mockReturnValue({});
  });

  it('returns the parsed moments on valid output', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify([{ timestamp: 3, quote: 'punch', reason: 'hook' }]),
    });
    const result = await identifyKeyMoments(noopTranscription, noopSegments, noopAnalyses);
    expect(result).toEqual([{ timestamp: 3, quote: 'punch', reason: 'hook' }]);
  });

  it('raises when the model returns malformed JSON (no silent empty array)', async () => {
    generateContentMock.mockResolvedValue({ text: '{broken' });
    await expect(
      identifyKeyMoments(noopTranscription, noopSegments, noopAnalyses)
    ).rejects.toThrow(/malformed JSON/i);
  });
});

describe('logging', () => {
  const collected: LogEntry[] = [];
  let unsubscribe: () => void = () => {};

  beforeEach(() => {
    generateContentMock.mockReset();
    getModelSettingsMock.mockReset().mockReturnValue({});
    collected.length = 0;
    unsubscribe = subscribe(latest => {
      collected.length = 0;
      collected.push(...latest);
    });
  });

  afterEach(() => unsubscribe());

  it('emits a pending entry at call start and finishes it with duration on success', async () => {
    let resolveCall!: (value: { text: string }) => void;
    generateContentMock.mockImplementation(
      () => new Promise(resolve => { resolveCall = resolve; })
    );

    const pending = generateDescription(noopTranscription, noopSegments, noopAnalyses);
    // startLog fires synchronously before the first await inside the service.
    expect(collected[0]).toMatchObject({
      fn: 'Generate Description',
      model: MODELS.flash,
      status: 'pending',
    });

    resolveCall({ text: JSON.stringify({ summary: 's', chapters: [], hashtags: [] }) });
    await pending;
    expect(collected[0]).toMatchObject({
      fn: 'Generate Description',
      model: MODELS.flash,
      status: 'success',
    });
    expect(typeof collected[0].durationMs).toBe('number');
  });

  it('marks the log entry as errored with the parse message when JSON is malformed', async () => {
    generateContentMock.mockResolvedValue({ text: '{broken' });
    await expect(
      identifyKeyMoments(noopTranscription, noopSegments, noopAnalyses)
    ).rejects.toThrow(/malformed JSON/i);
    expect(collected[0]).toMatchObject({ fn: 'Identify Key Moments', status: 'error' });
    expect(collected[0].error).toMatch(/malformed JSON/i);
    expect(collected[0].durationMs).toBeDefined();
  });

  it('records the API failure on the log entry when the Gemini call rejects', async () => {
    generateContentMock.mockRejectedValue(new Error('API error: quota exceeded'));
    await expect(
      generateDescription(noopTranscription, noopSegments, noopAnalyses)
    ).rejects.toThrow('API error: quota exceeded');
    expect(collected[0]).toMatchObject({ fn: 'Generate Description', status: 'error' });
    expect(collected[0].error).toBe('API error: quota exceeded');
  });
});

describe('per-op model selection', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    getModelSettingsMock.mockReset().mockReturnValue({});
  });

  it('keeps the registry baseline for description when settings are untouched', async () => {
    generateContentMock.mockResolvedValue({ text: '{"summary":"s","chapters":[],"hashtags":[]}' });
    await generateDescription(noopTranscription, noopSegments, noopAnalyses);
    expect(generateContentMock.mock.calls[0][0].model).toBe(MODELS.flash);
  });

  it('resolves the description model from settings (override wins)', async () => {
    getModelSettingsMock.mockReturnValue({ overrides: { description: 'pro' } });
    generateContentMock.mockResolvedValue({ text: '{"summary":"s","chapters":[],"hashtags":[]}' });
    await generateDescription(noopTranscription, noopSegments, noopAnalyses);
    expect(generateContentMock.mock.calls[0][0].model).toBe(MODELS.pro);
  });
});
