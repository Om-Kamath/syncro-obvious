import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateContentMock, getApiKeyMock, GoogleGenAIMock } = vi.hoisted(() => {
  const generateContentRef = vi.fn();
  class GoogleGenAIMock {
    static constructions: Array<{ apiKey: string }> = [];
    models = { generateContent: generateContentRef };
    constructor(options: { apiKey: string }) {
      GoogleGenAIMock.constructions.push(options);
    }
  }
  const getApiKeyRef = vi.fn();
  return { generateContentMock: generateContentRef, getApiKeyMock: getApiKeyRef, GoogleGenAIMock };
});

vi.mock('@google/genai', () => ({ GoogleGenAI: GoogleGenAIMock }));

vi.mock('./apiKey', () => ({
  getApiKey: getApiKeyMock,
}));

import { getAI, generateContent, extractTokenUsage, extractFailureCost, normalizeErrorMessage } from './geminiClient';
import { startLog, finishLog, subscribe, type LogEntry } from './logger';
import type { GenerateContentResponse } from '@google/genai';

const RESPONSE = { text: 'ok', candidates: [] };

// The logger is module-level shared state; snapshot its entry count via
// subscribe's immediate callback so tests can assert nothing new was logged.
function logEntryCount(): number {
  let count = -1;
  const unsubscribe = subscribe(entries => {
    count = entries.length;
  });
  unsubscribe();
  return count;
}

beforeEach(() => {
  generateContentMock.mockReset().mockResolvedValue(RESPONSE);
  getApiKeyMock.mockReset().mockReturnValue('test-key');
  GoogleGenAIMock.constructions.length = 0;
});

describe('getAI', () => {
  it('constructs the client from the stored API key', () => {
    getAI();
    expect(GoogleGenAIMock.constructions).toEqual([{ apiKey: 'test-key' }]);
  });

  it('throws the header-hint error when no API key is set', () => {
    getApiKeyMock.mockReturnValue('');
    expect(() => getAI()).toThrow(
      'No Gemini API key set. Click the key icon in the header to add one.'
    );
  });
});

describe('generateContent wrapper', () => {
  it('passes params through verbatim and returns the response untouched', async () => {
    const params = {
      model: 'gemini-test',
      contents: 'hello',
    } as Parameters<typeof generateContent>[0];
    const result = await generateContent(params);

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock).toHaveBeenCalledWith(params);
    expect(result).toBe(RESPONSE);
  });

  it('finishes the log entry as success when a log entry is passed', async () => {
    const log = startLog('Test Op', 'gemini-test', 'detail');
    await generateContent({ model: 'gemini-test', contents: 'hello' }, log);

    expect(log.status).toBe('success');
    expect(log.error).toBeUndefined();
    expect(typeof log.durationMs).toBe('number');
  });

  it('does not touch the shared log when no entry is passed', async () => {
    const before = logEntryCount();
    await generateContent({ model: 'gemini-test', contents: 'hello' });
    expect(logEntryCount()).toBe(before);
  });

  it('finishes the log entry as error and rethrows the original error', async () => {
    generateContentMock.mockRejectedValue(new Error('boom'));
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await expect(
      generateContent({ model: 'gemini-test', contents: 'hello' }, log)
    ).rejects.toThrow('boom');
    expect(log.status).toBe('error');
    expect(log.error).toBe('boom');
  });

  it('normalizes non-Error rejections (plain string) for the log but rethrows the original', async () => {
    generateContentMock.mockRejectedValue('plain string failure');
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await expect(
      generateContent({ model: 'gemini-test', contents: 'hello' }, log)
    ).rejects.toBe('plain string failure');
    expect(log.status).toBe('error');
    expect(log.error).toBe('plain string failure');
  });

  it('serializes object rejections so the log never shows [object Object]', async () => {
    generateContentMock.mockRejectedValue({ code: 429, message: 'quota exceeded' });
    const log: LogEntry = startLog('Test Op', 'gemini-test', 'detail');

    await expect(
      generateContent({ model: 'gemini-test', contents: 'hello' }, log)
    ).rejects.toEqual({ code: 429, message: 'quota exceeded' });
    expect(log.error).toBe(JSON.stringify({ code: 429, message: 'quota exceeded' }));
  });
});

describe('failed-call cost accounting', () => {
  it('logs a failed call with 0 tokens / not billed when the error carries no usage', async () => {
    generateContentMock.mockRejectedValue(new Error('boom'));
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await expect(
      generateContent({ model: 'gemini-test', contents: 'hello' }, log)
    ).rejects.toThrow('boom');

    expect(log.status).toBe('error');
    expect(typeof log.durationMs).toBe('number');
    expect(log.tokensConsumed).toBe(0);
    expect(log.billed).toBe(false);
  });

  it('captures tokens and billed=true when the error carries usageMetadata', async () => {
    const err = Object.assign(new Error('failed after processing'), {
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 37 },
    });
    generateContentMock.mockRejectedValue(err);
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await expect(
      generateContent({ model: 'gemini-test', contents: 'hello' }, log)
    ).rejects.toThrow('failed after processing');

    expect(log.status).toBe('error');
    expect(log.tokensConsumed).toBe(137);
    expect(log.billed).toBe(true);
  });

  it('reads usage nested under err.error (SDK ApiError shape)', async () => {
    const err = Object.assign(new Error('API error'), {
      error: { usageMetadata: { totalTokenCount: 512 } },
    });
    generateContentMock.mockRejectedValue(err);
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await expect(
      generateContent({ model: 'gemini-test', contents: 'hello' }, log)
    ).rejects.toThrow();

    expect(log.tokensConsumed).toBe(512);
    expect(log.billed).toBe(true);
  });

  it('still logs cost state when the wrapper fails before any API call (missing key)', async () => {
    getApiKeyMock.mockReturnValue('');
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await expect(
      generateContent({ model: 'gemini-test', contents: 'hello' }, log)
    ).rejects.toThrow('No Gemini API key set');

    expect(log.status).toBe('error');
    expect(log.tokensConsumed).toBe(0);
    expect(log.billed).toBe(false);
  });

  it('leaves cost fields unset on successful calls', async () => {
    const log = startLog('Test Op', 'gemini-test', 'detail');
    await generateContent({ model: 'gemini-test', contents: 'hello' }, log);

    expect(log.status).toBe('success');
    expect(log.tokensConsumed).toBeUndefined();
    expect(log.billed).toBeUndefined();
  });

  it('keeps wrapper-captured cost state when a caller re-finishes the entry (gemini.ts outer catch)', async () => {
    const err = Object.assign(new Error('late failure'), {
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
    });
    generateContentMock.mockRejectedValue(err);
    const log = startLog('Test Op', 'gemini-test', 'detail');

    try {
      await generateContent({ model: 'gemini-test', contents: 'hello' }, log);
    } catch {
      finishLog(log, err.message); // the caller-side catch pattern in gemini.ts
    }

    expect(log.error).toBe('late failure');
    expect(log.tokensConsumed).toBe(25);
    expect(log.billed).toBe(true);
  });
});

describe('extractFailureCost', () => {
  it('reports 0 tokens / not billed when nothing about consumption is observable', () => {
    expect(extractFailureCost(new Error('network down'))).toEqual({ tokensConsumed: 0, billed: false });
    expect(extractFailureCost('plain string')).toEqual({ tokensConsumed: 0, billed: false });
    expect(extractFailureCost({ code: 429, message: 'quota exceeded' })).toEqual({ tokensConsumed: 0, billed: false });
    expect(extractFailureCost(undefined)).toEqual({ tokensConsumed: 0, billed: false });
    expect(extractFailureCost(null)).toEqual({ tokensConsumed: 0, billed: false });
  });

  it('prefers totalTokenCount when present', () => {
    expect(
      extractFailureCost({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } })
    ).toEqual({ tokensConsumed: 15, billed: true });
  });

  it('sums prompt + candidates when totalTokenCount is absent', () => {
    expect(
      extractFailureCost({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })
    ).toEqual({ tokensConsumed: 15, billed: true });
  });

  it('reports not billed when usage is present but all token counts are 0', () => {
    expect(
      extractFailureCost({ usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } })
    ).toEqual({ tokensConsumed: 0, billed: false });
  });

  it('ignores usage objects without numeric token fields', () => {
    expect(extractFailureCost({ usageMetadata: { message: 'no counts here' } })).toEqual({ tokensConsumed: 0, billed: false });
  });

  it('reads usage from the response carrier', () => {
    expect(extractFailureCost({ response: { usageMetadata: { totalTokenCount: 7 } } }))
      .toEqual({ tokensConsumed: 7, billed: true });
  });
});

describe('normalizeErrorMessage', () => {
  it('keeps Error messages', () => {
    expect(normalizeErrorMessage(new Error('the message'))).toBe('the message');
  });

  it('passes plain strings through', () => {
    expect(normalizeErrorMessage('just a string')).toBe('just a string');
  });

  it('serializes arbitrary objects', () => {
    expect(normalizeErrorMessage({ status: 500 })).toBe('{"status":500}');
  });
});

describe('token capture in the generateContent wrapper', () => {
  it('attaches usageMetadata counts to the log entry on success', async () => {
    generateContentMock.mockResolvedValue({
      ...RESPONSE,
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45, totalTokenCount: 165 },
    });
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await generateContent({ model: 'gemini-test', contents: 'hello' }, log);

    expect(log.status).toBe('success');
    expect(log.inputTokens).toBe(120);
    expect(log.outputTokens).toBe(45);
    expect(log.totalTokens).toBe(165);
  });

  it('leaves token fields unset when the response carries no usageMetadata', async () => {
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await generateContent({ model: 'gemini-test', contents: 'hello' }, log);

    expect(log.status).toBe('success');
    expect(log.inputTokens).toBeUndefined();
    expect(log.outputTokens).toBeUndefined();
    expect(log.totalTokens).toBeUndefined();
  });

  it('sets no token fields on a failed call', async () => {
    generateContentMock.mockRejectedValue(new Error('boom'));
    const log = startLog('Test Op', 'gemini-test', 'detail');

    await expect(
      generateContent({ model: 'gemini-test', contents: 'hello' }, log)
    ).rejects.toThrow('boom');
    expect(log.inputTokens).toBeUndefined();
    expect(log.outputTokens).toBeUndefined();
    expect(log.totalTokens).toBeUndefined();
  });
});

describe('extractTokenUsage', () => {
  it('maps the SDK usageMetadata ids to LogEntry token fields', () => {
    expect(
      extractTokenUsage({
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
      } as unknown as GenerateContentResponse)
    ).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  });

  it('returns undefined when the response has no usageMetadata', () => {
    expect(extractTokenUsage({} as unknown as GenerateContentResponse)).toBeUndefined();
  });

  it('passes partial counts through as undefined rather than zero', () => {
    expect(
      extractTokenUsage({
        usageMetadata: { promptTokenCount: 7 },
      } as unknown as GenerateContentResponse)
    ).toEqual({ inputTokens: 7, outputTokens: undefined, totalTokens: undefined });
  });
});
