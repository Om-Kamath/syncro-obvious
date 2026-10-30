import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { generateContentMock, uploadMock, getFileMock, GoogleGenAIMock } = vi.hoisted(() => {
  const generateContentRef = vi.fn();
  const uploadRef = vi.fn();
  const getRef = vi.fn();
  class GoogleGenAIMock {
    static constructions: Array<{ apiKey: string }> = [];
    models = { generateContent: generateContentRef };
    files = { upload: uploadRef, get: getRef };
    constructor(options: { apiKey: string }) {
      GoogleGenAIMock.constructions.push(options);
    }
  }
  return {
    generateContentMock: generateContentRef,
    uploadMock: uploadRef,
    getFileMock: getRef,
    GoogleGenAIMock,
  };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: GoogleGenAIMock,
  // geminiClient imports FileState to poll uploads.
  FileState: { PROCESSING: 'PROCESSING', FAILED: 'FAILED', ACTIVE: 'ACTIVE' },
}));

import { getServerAI, generateContent, uploadAudioBytes } from './geminiClient';
import { MODELS } from '../../src/services/models';
import { startLog, subscribe, type LogEntry } from '../../src/services/logger';

function snapshotLogs(): LogEntry[] {
  let captured: LogEntry[] = [];
  const unsubscribe = subscribe(entries => {
    captured = entries;
  });
  unsubscribe();
  return captured;
}

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'env-test-key');
  generateContentMock.mockReset();
  uploadMock.mockReset();
  getFileMock.mockReset();
  GoogleGenAIMock.constructions.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getServerAI', () => {
  it('constructs the client from GEMINI_API_KEY', () => {
    getServerAI();
    expect(GoogleGenAIMock.constructions).toEqual([{ apiKey: 'env-test-key' }]);
  });

  it('throws a server-specific error when the env var is unset', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(() => getServerAI()).toThrow(
      'GEMINI_API_KEY is not set. Export it before starting the Syncro MCP server.'
    );
  });
});

describe('generateContent wrapper (logged + costed)', () => {
  it('returns the response untouched and captures usage onto the log entry', async () => {
    generateContentMock.mockResolvedValue({
      text: 'ok',
      usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 500, totalTokenCount: 1_500 },
    });
    const log = startLog('Test Op', MODELS.flashLite, 'detail');

    const response = await generateContent({ model: MODELS.flashLite, contents: 'hello' }, log);

    expect(response.text).toBe('ok');
    expect(log.status).toBe('success');
    expect(log.inputTokens).toBe(1_000);
    expect(log.outputTokens).toBe(500);
    // 1000 in @ $0.10/1M + 500 out @ $0.40/1M
    expect(log.estimatedCostUsd).toBeCloseTo(0.0003, 9);
  });

  it('finishes the log with a normalized error and rethrows', async () => {
    generateContentMock.mockRejectedValue(new Error('quota exceeded'));
    const log = startLog('Test Op', MODELS.flashLite, 'detail');

    await expect(generateContent({ model: MODELS.flashLite, contents: 'hello' }, log)).rejects.toThrow(
      'quota exceeded'
    );
    expect(log.status).toBe('error');
    expect(log.error).toBe('quota exceeded');
    expect(log.estimatedCostUsd).toBeUndefined();
  });

  it('logs every call through the shared logger (visible to subscribers)', async () => {
    const before = snapshotLogs().length;
    generateContentMock.mockResolvedValue({ text: 'ok', usageMetadata: undefined });
    const log = startLog('Test Op', MODELS.flashLite, 'detail');
    await generateContent({ model: MODELS.flashLite, contents: 'hello' }, log);

    const logs = snapshotLogs();
    expect(logs.length).toBe(before + 1);
    expect(logs[0].fn).toBe('Test Op');
  });
});

describe('uploadAudioBytes', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  it('uploads and returns the URI of an immediately-ACTIVE file', async () => {
    uploadMock.mockResolvedValue({ name: 'files/x', uri: 'https://files/x', state: 'ACTIVE' });

    const uri = await uploadAudioBytes(bytes, 'audio/wav', 'voice.wav');

    expect(uri).toBe('https://files/x');
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(getFileMock).not.toHaveBeenCalled();
  });

  it('polls while PROCESSING and rejects FAILED uploads', async () => {
    uploadMock.mockResolvedValue({ name: 'files/y', state: 'PROCESSING' });
    getFileMock
      .mockResolvedValueOnce({ name: 'files/y', state: 'PROCESSING' })
      .mockResolvedValueOnce({ name: 'files/y', uri: 'https://files/y', state: 'ACTIVE' });

    vi.useFakeTimers();
    try {
      const pending = uploadAudioBytes(bytes, 'audio/wav', 'poll.wav');
      await vi.advanceTimersByTimeAsync(3_000);
      const uri = await pending;
      expect(uri).toBe('https://files/y');
      expect(getFileMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when the upload ends in FAILED state', async () => {
    uploadMock.mockResolvedValue({ name: 'files/z', state: 'FAILED', error: { message: 'bad bytes' } });
    await expect(uploadAudioBytes(bytes, 'audio/wav', 'bad.wav')).rejects.toThrow(
      'File upload failed for "bad.wav": bad bytes'
    );
  });

  it('reuses the cached URI for the same name and size', async () => {
    uploadMock.mockResolvedValue({ name: 'files/cached', uri: 'https://files/cached', state: 'ACTIVE' });
    await uploadAudioBytes(bytes, 'audio/wav', 'cached.wav'); // primes the cache
    const uri = await uploadAudioBytes(bytes, 'audio/wav', 'cached.wav');

    expect(uri).toBe('https://files/cached');
    expect(uploadMock).toHaveBeenCalledTimes(1); // only the priming call
  });
});
