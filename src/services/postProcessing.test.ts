import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  generateDescription,
  generateTitleVariants,
  identifyKeyMoments,
  parseModelJson,
  TITLE_ANGLES,
  validateTitleVariants,
} from './postProcessing';
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

describe('logging', () => {
  const collected: LogEntry[] = [];
  let unsubscribe: () => void = () => {};

  beforeEach(() => {
    generateContentMock.mockReset();
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

describe('generateTitleVariants', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  const validVariants = [
    { angle: 'how-to', title: 'How to Edit Videos Faster' },
    { angle: 'listicle', title: '5 Editing Tricks Pros Swear By' },
    { angle: 'question', title: 'Why Do Your Edits Feel Slow?' },
    { angle: 'bold-claim', title: 'This Workflow Doubles Your Output' },
    { angle: 'curiosity', title: 'The Edit Nobody Notices' },
  ];

  it('returns 5 distinct non-empty titles from a valid model response', async () => {
    generateContentMock.mockResolvedValue({ text: JSON.stringify(validVariants) });

    const result = await generateTitleVariants(noopTranscription, noopSegments, noopAnalyses);

    expect(result).toHaveLength(5);
    const titles = result.map(v => v.title);
    expect(titles.every(t => t.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(5);
    expect(new Set(result.map(v => v.angle)).size).toBe(5);
    expect(result).toEqual(validVariants);
  });

  it('trims title whitespace and parses whitespace-padded JSON', async () => {
    generateContentMock.mockResolvedValue({
      text: `  ${JSON.stringify(validVariants.map(v => ({ ...v, title: `  ${v.title}  ` })))}  `,
    });

    const result = await generateTitleVariants(noopTranscription, noopSegments, noopAnalyses);

    expect(result.map(v => v.title)).toEqual([
      'How to Edit Videos Faster',
      '5 Editing Tricks Pros Swear By',
      'Why Do Your Edits Feel Slow?',
      'This Workflow Doubles Your Output',
      'The Edit Nobody Notices',
    ]);
  });

  it('raises with call context on malformed JSON', async () => {
    generateContentMock.mockResolvedValue({ text: 'not an array' });
    await expect(generateTitleVariants(noopTranscription, noopSegments, noopAnalyses)).rejects.toThrow(
      /Title variant generation: Gemini returned malformed JSON/i
    );
  });

  it('raises on an empty response', async () => {
    generateContentMock.mockResolvedValue({ text: '' });
    await expect(generateTitleVariants(noopTranscription, noopSegments, noopAnalyses)).rejects.toThrow(
      /Title variant generation: Gemini returned an empty response/i
    );
  });

  it('propagates Gemini call failures unwrapped', async () => {
    generateContentMock.mockRejectedValue(new Error('API error: quota exceeded'));
    await expect(generateTitleVariants(noopTranscription, noopSegments, noopAnalyses)).rejects.toThrow(
      'API error: quota exceeded'
    );
  });
});

describe('validateTitleVariants', () => {
  const validVariants = [
    { angle: 'how-to', title: 'A' },
    { angle: 'listicle', title: 'B' },
    { angle: 'question', title: 'C' },
    { angle: 'bold-claim', title: 'D' },
    { angle: 'curiosity', title: 'E' },
  ];

  it('accepts the five distinct angles and returns trimmed copies', () => {
    const result = validateTitleVariants(validVariants.map(v => ({ ...v, title: `  ${v.title} ` })));
    expect(result.map(v => v.title)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('rejects the wrong number of variants', () => {
    expect(() => validateTitleVariants(validVariants.slice(0, 4))).toThrow(/expected exactly 5/);
    expect(() => validateTitleVariants([...validVariants, { angle: 'how-to', title: 'F' }])).toThrow(
      /expected exactly 5/
    );
    expect(() => validateTitleVariants('nope')).toThrow(/expected exactly 5.*non-array/);
  });

  it('rejects an unknown angle', () => {
    const bad = validVariants.map(v => ({ ...v }));
    bad[2] = { angle: 'clickbait', title: 'C' };
    expect(() => validateTitleVariants(bad)).toThrow(/unknown angle "clickbait"/);
  });

  it('rejects a repeated angle', () => {
    const bad = validVariants.map(v => ({ ...v }));
    bad[1] = { angle: 'how-to', title: 'B' };
    expect(() => validateTitleVariants(bad)).toThrow(/angle "how-to" appears more than once/);
  });

  it('rejects an empty or missing title', () => {
    const bad = validVariants.map(v => ({ ...v }));
    bad[3] = { angle: 'bold-claim', title: '   ' };
    expect(() => validateTitleVariants(bad)).toThrow(/missing a non-empty title/);
    const missing = validVariants.map(v => ({ angle: v.angle, title: undefined }));
    expect(() => validateTitleVariants(missing)).toThrow(/missing a non-empty title/);
  });

  it('rejects duplicate title text across angles (case-insensitive)', () => {
    const bad = validVariants.map(v => ({ ...v }));
    bad[1] = { angle: 'listicle', title: 'a' };
    expect(() => validateTitleVariants(bad)).toThrow(/duplicate title/);
  });

  it('exposes exactly the five canonical angles', () => {
    expect([...TITLE_ANGLES]).toEqual(['how-to', 'listicle', 'question', 'bold-claim', 'curiosity']);
  });
});
