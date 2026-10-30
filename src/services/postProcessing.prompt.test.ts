import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test-only suite for the prompt-building and response-parsing seams of
// postProcessing.ts. Mocks the @google/genai module (the construction seam the
// module owns today) so no network call is ever made. Deliberately lives in its
// own file: a separate campaign PR modifies postProcessing.ts and its original
// test file, and this avoids colliding with either.

const { generateContentMock, getApiKeyMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  getApiKeyMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
  // Mirrors the real enum's string values closely enough for schema-shape
  // assertions (the schema is compared by these mocked literals).
  Type: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
  },
}));

vi.mock('./apiKey', () => ({
  getApiKey: getApiKeyMock,
}));

import { generateDescription, identifyKeyMoments, parseModelJson } from './postProcessing';

const transcription = 'We hiked the ridge at dawn and found an abandoned cabin.';
const segments = [
  { text: 'We hiked the ridge at dawn.', start: 0, end: 4 },
  { text: 'We found an abandoned cabin.', start: 4, end: 8 },
];
const analyses = ['A mountain ridge at sunrise', 'A weathered cabin door'];

function lastCall(): { model: string; contents: string; config: Record<string, unknown> } {
  const call = generateContentMock.mock.calls.at(-1)?.[0];
  if (!call) throw new Error('generateContent was never called');
  return call;
}

beforeEach(() => {
  generateContentMock.mockReset();
  getApiKeyMock.mockReset().mockReturnValue('test-key');
});

describe('generateDescription prompt building', () => {
  it('embeds the transcription, serialized segments, and pipe-joined analyses in the prompt', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ summary: 's', chapters: [], hashtags: [] }),
    });
    await generateDescription(transcription, segments, analyses);

    const { contents } = lastCall();
    expect(contents).toContain(transcription);
    expect(contents).toContain(JSON.stringify(segments));
    expect(contents).toContain(analyses.join(' | '));
  });

  it('requests JSON output with an OBJECT schema requiring summary, chapters, and hashtags', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ summary: 's', chapters: [], hashtags: [] }),
    });
    await generateDescription(transcription, segments, analyses);

    const { config } = lastCall();
    expect(config.responseMimeType).toBe('application/json');
    const schema = config.responseSchema as {
      type: string;
      required: string[];
      properties: Record<string, { type: string; items?: { type: string } }>;
    };
    expect(schema.type).toBe('OBJECT');
    expect(schema.required).toEqual(['summary', 'chapters', 'hashtags']);
    expect(schema.properties.summary.type).toBe('STRING');
    expect(schema.properties.chapters.type).toBe('ARRAY');
    expect(schema.properties.hashtags.type).toBe('ARRAY');
    expect(schema.properties.hashtags.items?.type).toBe('STRING');
  });

  it('shapes each chapter item as a time (NUMBER) + label (STRING) pair', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ summary: 's', chapters: [], hashtags: [] }),
    });
    await generateDescription(transcription, segments, analyses);

    const { config } = lastCall();
    const schema = config.responseSchema as {
      properties: {
        chapters: { items: { type: string; required: string[]; properties: Record<string, { type: string }> } };
      };
    };
    const chapterItem = schema.properties.chapters.items;
    expect(chapterItem.type).toBe('OBJECT');
    expect(chapterItem.required).toEqual(['time', 'label']);
    expect(chapterItem.properties.time.type).toBe('NUMBER');
    expect(chapterItem.properties.label.type).toBe('STRING');
  });

  it('pins the chapter-count and hashtag contracts in the prompt text', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ summary: 's', chapters: [], hashtags: [] }),
    });
    await generateDescription(transcription, segments, analyses);

    const { contents } = lastCall();
    expect(contents).toMatch(/3-8 chapters/i);
    expect(contents).toMatch(/8-12 relevant hashtags/i);
    // Hashtags must arrive without the # symbol so the UI can add them.
    expect(contents).toMatch(/without the # symbol/);
  });

  it('honors a non-default platform preset when one is passed', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ summary: 's', chapters: [], hashtags: [] }),
    });
    await generateDescription(transcription, segments, analyses, 'tiktok');

    const { contents } = lastCall();
    expect(contents).toMatch(/^You are generating a video description in the TikTok style\./);
    expect(contents).toMatch(/empty chapters array/i);
    expect(contents).toMatch(/4-6 trend-friendly hashtags/);
  });

  it('throws before calling Gemini when no API key is set', async () => {
    getApiKeyMock.mockReturnValue('');
    await expect(generateDescription(transcription, segments, analyses)).rejects.toThrow(
      /No Gemini API key set/
    );
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe('identifyKeyMoments prompt building', () => {
  it('embeds the transcription, serialized segments, and analyses in the prompt', async () => {
    generateContentMock.mockResolvedValue({ text: '[]' });
    await identifyKeyMoments(transcription, segments, analyses);

    const { contents } = lastCall();
    expect(contents).toContain(transcription);
    expect(contents).toContain(JSON.stringify(segments));
    expect(contents).toContain(analyses.join(' | '));
  });

  it('asks for 4-5 moments with a timestamp, short quote, and reason', async () => {
    generateContentMock.mockResolvedValue({ text: '[]' });
    await identifyKeyMoments(transcription, segments, analyses);

    const { contents } = lastCall();
    expect(contents).toMatch(/4-5/i);
    expect(contents).toMatch(/max 7 words/i);
    expect(contents).toMatch(/within the segment times/);
  });

  it('requests an ARRAY schema whose items require timestamp, quote, and reason', async () => {
    generateContentMock.mockResolvedValue({ text: '[]' });
    await identifyKeyMoments(transcription, segments, analyses);

    const { config } = lastCall();
    expect(config.responseMimeType).toBe('application/json');
    const schema = config.responseSchema as {
      type: string;
      items: {
        type: string;
        required: string[];
        properties: Record<string, { type: string }>;
      };
    };
    expect(schema.type).toBe('ARRAY');
    expect(schema.items.type).toBe('OBJECT');
    expect(schema.items.required).toEqual(['timestamp', 'quote', 'reason']);
    expect(schema.items.properties.timestamp.type).toBe('NUMBER');
    expect(schema.items.properties.quote.type).toBe('STRING');
    expect(schema.items.properties.reason.type).toBe('STRING');
  });

  it('throws before calling Gemini when no API key is set', async () => {
    getApiKeyMock.mockReturnValue('');
    await expect(identifyKeyMoments(transcription, segments, analyses)).rejects.toThrow(
      /No Gemini API key set/
    );
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe('response parsing — happy paths', () => {
  it('returns summary, chapters, and hashtags from valid (whitespace-padded) JSON', async () => {
    generateContentMock.mockResolvedValue({
      text: `  ${JSON.stringify({
        summary: 'A dawn hike leads to a forgotten cabin.',
        chapters: [
          { time: 0, label: 'The hike begins' },
          { time: 42.5, label: 'Cabin discovery' },
        ],
        hashtags: ['hiking', 'exploration', 'abandoned'],
      })}  `,
    });
    const result = await generateDescription(transcription, segments, analyses);
    expect(result).toEqual({
      summary: 'A dawn hike leads to a forgotten cabin.',
      chapters: [
        { time: 0, label: 'The hike begins' },
        { time: 42.5, label: 'Cabin discovery' },
      ],
      hashtags: ['hiking', 'exploration', 'abandoned'],
    });
  });

  it('returns the moments array with numeric timestamps from valid JSON', async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify([
        { timestamp: 3, quote: 'The cabin door creaks', reason: 'Sudden tension' },
        { timestamp: 61.25, quote: 'Sunrise over the ridge', reason: 'Visually striking' },
      ]),
    });
    const result = await identifyKeyMoments(transcription, segments, analyses);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ timestamp: 3, quote: 'The cabin door creaks', reason: 'Sudden tension' });
    expect(typeof result[1].timestamp).toBe('number');
  });
});

describe('error paths', () => {
  it('raises with the call context on malformed JSON (description)', async () => {
    generateContentMock.mockResolvedValue({ text: '}}{{ garbage' });
    await expect(generateDescription(transcription, segments, analyses)).rejects.toThrow(
      /Description generation: Gemini returned malformed JSON/i
    );
  });

  it('raises with the call context on malformed JSON (key moments)', async () => {
    generateContentMock.mockResolvedValue({ text: '{broken' });
    await expect(identifyKeyMoments(transcription, segments, analyses)).rejects.toThrow(
      /Thumbnail key-moment identification: Gemini returned malformed JSON/i
    );
  });

  it('raises on an empty or missing response text', async () => {
    generateContentMock.mockResolvedValue({ text: '' });
    await expect(generateDescription(transcription, segments, analyses)).rejects.toThrow(
      /Description generation: Gemini returned an empty response/i
    );

    generateContentMock.mockResolvedValue({ text: '   ' });
    await expect(identifyKeyMoments(transcription, segments, analyses)).rejects.toThrow(
      /Thumbnail key-moment identification: Gemini returned an empty response/i
    );

    // A blocked/safety-filtered response often has no `text` at all.
    generateContentMock.mockResolvedValue({});
    await expect(generateDescription(transcription, segments, analyses)).rejects.toThrow(
      /empty response/i
    );
  });

  it('truncates the echoed model output in the malformed-JSON error to 200 characters', () => {
    const longGarbage = 'x'.repeat(500);
    let message = '';
    try {
      parseModelJson(longGarbage, 'Ctx');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('Ctx: Gemini returned malformed JSON');
    expect(message).toContain('x'.repeat(200));
    expect(message).not.toContain('x'.repeat(201));
  });

  it('propagates Gemini call failures unwrapped', async () => {
    generateContentMock.mockRejectedValue(new Error('API error: quota exceeded'));
    await expect(generateDescription(transcription, segments, analyses)).rejects.toThrow(
      'API error: quota exceeded'
    );
    await expect(identifyKeyMoments(transcription, segments, analyses)).rejects.toThrow(
      'API error: quota exceeded'
    );
  });
});
