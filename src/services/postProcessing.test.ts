import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }));

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

import { generateDescription, identifyKeyMoments, parseModelJson } from './postProcessing';

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
