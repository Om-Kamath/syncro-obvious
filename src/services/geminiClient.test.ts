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

import { getAI, generateContent, normalizeErrorMessage } from './geminiClient';
import { startLog, subscribe, type LogEntry } from './logger';

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
