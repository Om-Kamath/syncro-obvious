import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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
  FileState: { PROCESSING: 'PROCESSING', FAILED: 'FAILED', ACTIVE: 'ACTIVE' },
}));

import { registerGenerationTools, readWavDurationSeconds } from './generationTools';
import { pcmBase64ToWavBytes } from '../../src/services/gemini';
import { MODELS } from '../../src/services/models';
import { subscribe, type LogEntry } from '../../src/services/logger';

/** A fresh server + connected in-memory MCP client per test (mediaTools pattern). */
async function connectTools(): Promise<Client> {
  const server = new McpServer({ name: 'syncro-test', version: '0.0.0' });
  registerGenerationTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

type Success = { isError?: false; payload: Record<string, unknown> };
type Failure = { isError: true; errorText: string };

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<Success | Failure> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  if (result.isError) return { isError: true, errorText: text };
  return { payload: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function snapshotLogs(): LogEntry[] {
  let captured: LogEntry[] = [];
  const unsubscribe = subscribe(entries => {
    captured = entries;
  });
  unsubscribe();
  return captured;
}

/** A real 1s WAV fixture built by the production wrapper (silence @ 24kHz). */
const wavBytes = pcmBase64ToWavBytes(Buffer.from(new Uint8Array(48_000)).toString('base64'), 24_000);

let client: Client;

beforeEach(async () => {
  vi.stubEnv('GEMINI_API_KEY', 'env-test-key');
  generateContentMock.mockReset();
  uploadMock.mockReset();
  getFileMock.mockReset();
  GoogleGenAIMock.constructions.length = 0;
  client = await connectTools();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await client.close();
});

describe('tool surface', () => {
  it('exposes the three generation tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(tool => tool.name).sort();
    expect(names).toEqual(['generate_captions', 'generate_narration', 'generate_tts']);
  });

  it('every generation tool has a title and a description', async () => {
    const { tools } = await client.listTools();
    for (const name of ['generate_narration', 'generate_tts', 'generate_captions']) {
      const tool = tools.find(t => t.name === name);
      expect(tool?.title, name).toBeTruthy();
      expect(tool?.description?.length, name).toBeGreaterThan(10);
    }
  });
});

describe('generate_narration', () => {
  const clips = [
    { name: 'opening.mp4', analysis: 'A sunrise over the harbor.', duration: 5 },
    { name: 'closing.mp4', analysis: 'Waves against the pier at dusk.', duration: 3 },
  ];

  it('returns the generated script from a mocked Gemini response', async () => {
    generateContentMock.mockResolvedValue({
      text: '  The harbor wakes slowly.  ',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
    });

    const res = await callTool(client, 'generate_narration', { clips });
    expect(res.isError).toBeFalsy();
    expect((res as Success).payload.script).toBe('The harbor wakes slowly.');
  });

  it('calls flashLite with the shared narration prompt (word-identical to the UI path)', async () => {
    generateContentMock.mockResolvedValue({ text: 'script', usageMetadata: {} });
    await callTool(client, 'generate_narration', { clips });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const call = generateContentMock.mock.calls[0][0] as { model: string; contents: string };
    expect(call.model).toBe(MODELS.flashLite);
    expect(call.contents).toContain('You are a documentary narrator.');
    expect(call.contents).toContain('Clip 1 (5.0s) — "opening.mp4"');
  });

  it('logs the call with tokens and a positive estimated cost', async () => {
    const before = snapshotLogs().length;
    generateContentMock.mockResolvedValue({
      text: 'script',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
    });
    await callTool(client, 'generate_narration', { clips });

    const entry = snapshotLogs()[0];
    expect(snapshotLogs().length).toBe(before + 1);
    expect(entry.fn).toBe('MCP Generate Narration');
    expect(entry.model).toBe(MODELS.flashLite);
    expect(entry.status).toBe('success');
    expect(entry.inputTokens).toBe(100);
    expect(entry.outputTokens).toBe(40);
    expect(entry.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('rejects empty or malformed clips with a validation error result', async () => {
    const noClips = await callTool(client, 'generate_narration', {});
    expect(noClips.isError).toBe(true);
    expect((noClips as Failure).errorText).toContain('clips');

    const badClip = await callTool(client, 'generate_narration', {
      clips: [{ name: 'a.mp4', analysis: 'ok', duration: 'five' }],
    });
    expect(badClip.isError).toBe(true);
    expect((badClip as Failure).errorText).toContain('duration');
  });
});

describe('generate_tts', () => {
  it('returns WAV bytes (RIFF header), duration, and audio/wav from a mocked PCM response', async () => {
    // 4800 bytes of 16-bit mono PCM @ 24kHz = 100ms of audio.
    const pcm = new Uint8Array(4_800);
    const pcmB64 = Buffer.from(pcm).toString('base64');
    generateContentMock.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: pcmB64, mimeType: 'audio/L16;rate=24000' } }] } }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0 },
    });

    const res = await callTool(client, 'generate_tts', { script: 'Hold on tight.' });
    expect(res.isError).toBeFalsy();
    const payload = (res as Success).payload as { audioBase64: string; mimeType: string; durationSeconds: number };

    expect(payload.mimeType).toBe('audio/wav');
    const decoded = Buffer.from(payload.audioBase64, 'base64');
    expect(decoded.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(payload.durationSeconds).toBeCloseTo(0.1, 5);
  });

  it('configures the TTS model and default voice like the UI path', async () => {
    generateContentMock.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(new Uint8Array(4800)).toString('base64'), mimeType: 'audio/L16;rate=24000' } }] } }],
      usageMetadata: {},
    });
    await callTool(client, 'generate_tts', { script: 'Hello.' });

    const call = generateContentMock.mock.calls[0][0] as {
      model: string;
      config: { responseModalities: string[]; speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } };
    };
    expect(call.model).toBe(MODELS.tts);
    expect(call.config.responseModalities).toEqual(['AUDIO']);
    expect(call.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Aoede');
  });

  it('passes a custom voice through', async () => {
    generateContentMock.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(new Uint8Array(4800)).toString('base64'), mimeType: 'audio/L16;rate=24000' } }] } }],
      usageMetadata: {},
    });
    await callTool(client, 'generate_tts', { script: 'Hello.', voice: 'Puck' });

    const call = generateContentMock.mock.calls[0][0] as {
      config: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } };
    };
    expect(call.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
  });

  it('surfaces a named error when the model returns no audio', async () => {
    generateContentMock.mockResolvedValue({ candidates: [], usageMetadata: {} });
    const res = await callTool(client, 'generate_tts', { script: 'Hello.' });
    expect(res.isError).toBe(true);
    expect((res as Failure).errorText).toBe('No audio returned from TTS');
  });

  it('rejects an empty script', async () => {
    const res = await callTool(client, 'generate_tts', { script: '   ' });
    expect(res.isError).toBe(true);
    expect((res as Failure).errorText).toContain('script');
  });
});

describe('generate_captions', () => {
  const audioB64 = Buffer.from(wavBytes).toString('base64');

  it('uploads the audio, transcribes, and estimates segment timings', async () => {
    uploadMock.mockResolvedValue({ name: 'files/voice', uri: 'https://files/voice', state: 'ACTIVE' });
    generateContentMock.mockResolvedValue({
      text: 'The harbor wakes slowly. Waves pick up.',
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 30 },
    });

    const res = await callTool(client, 'generate_captions', {
      audioBase64: audioB64,
      mimeType: 'audio/wav',
      durationSeconds: 4,
    });
    expect(res.isError).toBeFalsy();
    const payload = (res as Success).payload as {
      transcription: string;
      segments: Array<{ text: string; start: number; end: number }>;
      timingSource: string;
    };

    expect(payload.transcription).toBe('The harbor wakes slowly. Waves pick up.');
    expect(payload.segments).toHaveLength(2);
    expect(payload.segments[0].start).toBe(0);
    expect(payload.segments[1].end).toBe(4);
    expect(payload.timingSource).toBe('provided');
  });

  it('sends the Files-API URI and the shared transcription prompt at temperature 0', async () => {
    uploadMock.mockResolvedValue({ name: 'files/voice', uri: 'https://files/voice', state: 'ACTIVE' });
    generateContentMock.mockResolvedValue({ text: 'hi', usageMetadata: {} });

    await callTool(client, 'generate_captions', { audioBase64: audioB64, mimeType: 'audio/wav', durationSeconds: 1 });

    const call = generateContentMock.mock.calls[0][0] as {
      model: string;
      contents: { parts: Array<{ fileData?: { mimeType: string; fileUri: string }; text?: string }> };
      config: { temperature: number };
    };
    expect(call.model).toBe(MODELS.flashLite);
    expect(call.contents.parts[0].fileData).toEqual({ mimeType: 'audio/wav', fileUri: 'https://files/voice' });
    expect(call.contents.parts[1].text).toContain('Transcribe all spoken words');
    expect(call.config.temperature).toBe(0);
  });

  it('derives duration from a WAV header when durationSeconds is omitted', async () => {
    uploadMock.mockResolvedValue({ name: 'files/voice', uri: 'https://files/voice', state: 'ACTIVE' });
    generateContentMock.mockResolvedValue({ text: 'One sentence.', usageMetadata: {} });

    const res = await callTool(client, 'generate_captions', {
      audioBase64: audioB64,
      mimeType: 'audio/wav',
    });
    expect(res.isError).toBeFalsy();
    const payload = (res as Success).payload as { timingSource: string; durationSeconds: number };

    expect(payload.timingSource).toBe('wav-header');
    expect(payload.durationSeconds).toBeCloseTo(1, 5);
  });

  it('fails with guidance when duration is unavailable', async () => {
    const res = await callTool(client, 'generate_captions', {
      audioBase64: Buffer.from('not a wav at all').toString('base64'),
      mimeType: 'audio/mpeg',
    });
    expect(res.isError).toBe(true);
    expect((res as Failure).errorText).toContain('durationSeconds');
  });

  it('rejects base64 that decodes to zero bytes', async () => {
    const res = await callTool(client, 'generate_captions', {
      audioBase64: '====', // passes the non-empty check, decodes to 0 bytes
      mimeType: 'audio/wav',
      durationSeconds: 1,
    });
    expect(res.isError).toBe(true);
    expect((res as Failure).errorText).toContain('did not decode to any bytes');
  });

  it('logs the call with tokens and estimated cost like every server op', async () => {
    const before = snapshotLogs().length;
    uploadMock.mockResolvedValue({ name: 'files/voice', uri: 'https://files/voice', state: 'ACTIVE' });
    generateContentMock.mockResolvedValue({
      text: 'One sentence.',
      usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 10 },
    });

    await callTool(client, 'generate_captions', { audioBase64: audioB64, mimeType: 'audio/wav', durationSeconds: 1 });

    const entry = snapshotLogs()[0];
    expect(snapshotLogs().length).toBe(before + 1);
    expect(entry.fn).toBe('MCP Captions');
    expect(entry.inputTokens).toBe(150);
    expect(entry.outputTokens).toBe(10);
    expect(entry.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe('readWavDurationSeconds', () => {
  it('reads duration from the production WAV wrapper output (0.1s of PCM @ 24kHz)', () => {
    const shortWav = pcmBase64ToWavBytes(Buffer.from(new Uint8Array(4_800)).toString('base64'), 24_000);
    expect(readWavDurationSeconds(shortWav)).toBeCloseTo(0.1, 5);
  });

  it('returns null for non-WAV bytes and truncated buffers', () => {
    expect(readWavDurationSeconds(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readWavDurationSeconds(Buffer.from('this is not audio'))).toBeNull();
  });
});

describe('agent flow: narration → tts → captions end-to-end', () => {
  it('chains the three tools on mocked Gemini, all logged and costed', async () => {
    const before = snapshotLogs().length;
    // 1) narration script
    generateContentMock.mockResolvedValueOnce({
      text: 'Watch the harbor wake.',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
    });
    // 2) TTS — 0.5s of PCM
    generateContentMock.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(new Uint8Array(24_000)).toString('base64'), mimeType: 'audio/L16;rate=24000' } }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 0 },
    });
    // 3) captions transcription
    generateContentMock.mockResolvedValueOnce({
      text: 'Watch the harbor wake.',
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10 },
    });
    uploadMock.mockResolvedValue({ name: 'files/voice', uri: 'https://files/voice', state: 'ACTIVE' });

    const narration = await callTool(client, 'generate_narration', {
      clips: [{ name: 'clip.mp4', analysis: 'harbor', duration: 5 }],
    });
    const tts = await callTool(client, 'generate_tts', {
      script: (narration as Success).payload.script as string,
    });
    const captions = await callTool(client, 'generate_captions', {
      audioBase64: ((tts as Success).payload as { audioBase64: string }).audioBase64,
      mimeType: 'audio/wav',
    });

    expect((narration as Success).payload.script).toBe('Watch the harbor wake.');
    expect(((tts as Success).payload as { durationSeconds: number }).durationSeconds).toBeCloseTo(0.5, 5);
    const captionsPayload = (captions as Success).payload as { transcription: string; segments: unknown[] };
    expect(captionsPayload.transcription).toBe('Watch the harbor wake.');
    expect(captionsPayload.segments.length).toBeGreaterThan(0);

    const logs = snapshotLogs();
    expect(logs.length).toBe(before + 3);
    // The shared log is newest-first: the three chained ops are its newest entries.
    const chained = logs.slice(0, 3);
    expect(chained.map(entry => entry.fn)).toEqual([
      'MCP Captions',
      'MCP TTS',
      'MCP Generate Narration',
    ]);
    for (const entry of chained) {
      expect(entry.status).toBe('success');
      expect(typeof entry.estimatedCostUsd).toBe('number');
    }
  });
});
