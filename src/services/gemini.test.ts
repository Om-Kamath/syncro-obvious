import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { generateContentMock, getModelSettingsMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  getModelSettingsMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
    files = {
      upload: vi.fn(),
      get: vi.fn(),
    };
  },
  Type: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
  },
  FileState: {
    PROCESSING: 'PROCESSING',
    FAILED: 'FAILED',
    ACTIVE: 'ACTIVE',
  },
}));

vi.mock('./apiKey', () => ({
  getApiKey: () => 'test-key',
}));

vi.mock('./modelSettings', () => ({
  getModelSettings: getModelSettingsMock,
}));

import { generateAudioFromScript, generateNarrationFromVideos, inlineAudioToWavBytes, pcmBase64ToWavBytes, estimateSegments } from './gemini';

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

function audioPart(inlineData: { data: string; mimeType?: string } | undefined) {
  return {
    candidates: [{ content: { parts: [{ inlineData }] } }],
  };
}

// The module measures duration with `new Audio(url)`; stub a metadata load.
vi.stubGlobal('Audio', class {
  duration = 1.5;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    setTimeout(() => this.onloadedmetadata?.(), 0);
  }
});

let capturedBlob: Blob | null = null;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  generateContentMock.mockReset();
  getModelSettingsMock.mockReset().mockReturnValue({});
  capturedBlob = null;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    capturedBlob = blob;
    return 'blob:mock-url';
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('pcmBase64ToWavBytes', () => {
  it('wraps raw PCM in a 44-byte WAV header', () => {
    const pcm = Uint8Array.from([10, 20, 30, 40]);
    const wav = pcmBase64ToWavBytes(toB64(pcm));

    expect(wav.length).toBe(44 + pcm.length);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    // little-endian data-size field at offset 40
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(pcm.length);
    expect([...wav.slice(44)]).toEqual([...pcm]);
  });
});

describe('inlineAudioToWavBytes', () => {
  it('passes WAV responses through untouched (no double header)', () => {
    const wavBytes = Uint8Array.from([1, 2, 3, 4]);
    const out = inlineAudioToWavBytes(toB64(wavBytes), 'audio/wav');
    expect([...out]).toEqual([...wavBytes]);
  });

  it('routes mimeType case-insensitively', () => {
    const wavBytes = Uint8Array.from([1, 2, 3, 4]);
    const out = inlineAudioToWavBytes(toB64(wavBytes), 'AUDIO/WAV');
    expect([...out]).toEqual([...wavBytes]);
  });

  it('wraps raw PCM responses (legacy audio/L16) in a WAV header', () => {
    const pcm = Uint8Array.from([10, 20, 30]);
    const out = inlineAudioToWavBytes(toB64(pcm), 'audio/L16;codec=pcm;rate=24000');

    expect(out.length).toBe(44 + pcm.length);
    expect(String.fromCharCode(...out.slice(0, 4))).toBe('RIFF');
    expect([...out.slice(44)]).toEqual([...pcm]);
  });

  it('treats a missing mimeType as raw PCM (2.5 preview behavior)', () => {
    const pcm = Uint8Array.from([7, 8]);
    const out = inlineAudioToWavBytes(toB64(pcm), undefined);
    expect(out.length).toBe(44 + pcm.length);
    expect(String.fromCharCode(...out.slice(0, 4))).toBe('RIFF');
  });
});

describe('generateAudioFromScript', () => {
  it('calls the GA TTS model with the documented request shape', async () => {
    generateContentMock.mockResolvedValue(
      audioPart({ data: toB64(Uint8Array.from([1, 2, 3])), mimeType: 'audio/wav' })
    );

    await generateAudioFromScript('Hello world', 'Kore');

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const call = generateContentMock.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.8-flash-tts');
    expect(call.config.responseModalities).toEqual(['AUDIO']);
    expect(call.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });

  it('creates the audio blob from WAV responses without re-wrapping', async () => {
    const wavBytes = Uint8Array.from([1, 2, 3, 4]);
    generateContentMock.mockResolvedValue(
      audioPart({ data: toB64(wavBytes), mimeType: 'audio/wav' })
    );

    const result = await generateAudioFromScript('Hello world');

    expect(result.url).toBe('blob:mock-url');
    expect(result.transcription).toBe('Hello world');
    expect(result.duration).toBe(1.5);
    expect(capturedBlob?.type).toBe('audio/wav');
    expect([...new Uint8Array(await capturedBlob!.arrayBuffer())]).toEqual([...wavBytes]);
  });

  it('wraps legacy raw PCM responses in a WAV header', async () => {
    const pcm = Uint8Array.from([10, 20, 30]);
    generateContentMock.mockResolvedValue(
      audioPart({ data: toB64(pcm), mimeType: 'audio/L16;codec=pcm;rate=24000' })
    );

    await generateAudioFromScript('Hello world');

    const bytes = [...new Uint8Array(await capturedBlob!.arrayBuffer())];
    expect(bytes.length).toBe(44 + pcm.length);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(bytes.slice(44)).toEqual([...pcm]);
  });

  it('throws (and logs) when no audio is returned', async () => {
    generateContentMock.mockResolvedValue({ candidates: [] });
    await expect(generateAudioFromScript('Hello world')).rejects.toThrow(/No audio returned/i);
  });

  it('propagates SDK errors with their original message', async () => {
    generateContentMock.mockRejectedValue(new Error('404: model not found'));
    await expect(generateAudioFromScript('Hello world')).rejects.toThrow('404: model not found');
  });
});

describe('generateNarrationFromVideos', () => {
  it('writes the script with flash-lite, then speaks it with the TTS model', async () => {
    generateContentMock
      .mockResolvedValueOnce({ text: 'A narration script.' })
      .mockResolvedValueOnce(audioPart({ data: toB64(Uint8Array.from([1, 2, 3])), mimeType: 'audio/wav' }));

    const result = await generateNarrationFromVideos([
      { name: 'clip.mp4', analysis: 'a beach', duration: 10 },
    ]);

    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(generateContentMock.mock.calls[0][0].model).toBe('gemini-3.5-flash-lite');
    expect(generateContentMock.mock.calls[1][0].model).toBe('gemini-3.8-flash-tts');
    expect(result.transcription).toBe('A narration script.');
  });
});

describe('per-op model selection', () => {
  it('keeps registry baselines when settings are untouched', async () => {
    generateContentMock
      .mockResolvedValueOnce({ text: 'A narration script.' })
      .mockResolvedValueOnce(audioPart({ data: toB64(Uint8Array.from([1, 2, 3])), mimeType: 'audio/wav' }));

    await generateNarrationFromVideos([{ name: 'clip.mp4', analysis: 'a beach', duration: 10 }]);

    expect(generateContentMock.mock.calls[0][0].model).toBe('gemini-3.5-flash-lite');
  });

  it('threads the settings default and per-op override through to generateContent (TTS stays pinned)', async () => {
    getModelSettingsMock.mockReturnValue({ defaultTier: 'flash', overrides: { narration: 'pro' } });
    generateContentMock
      .mockResolvedValueOnce({ text: 'A narration script.' })
      .mockResolvedValueOnce(audioPart({ data: toB64(Uint8Array.from([1, 2, 3])), mimeType: 'audio/wav' }));

    await generateNarrationFromVideos([{ name: 'clip.mp4', analysis: 'a beach', duration: 10 }]);

    expect(generateContentMock.mock.calls[0][0].model).toBe('gemini-4-argon');
    expect(generateContentMock.mock.calls[1][0].model).toBe('gemini-3.8-flash-tts');
  });
});

describe('fromB64 round-trip (test helper)', () => {
  it('decodes what toB64 encodes', () => {
    const bytes = Uint8Array.from([0, 1, 254, 255]);
    expect([...fromB64(toB64(bytes))]).toEqual([...bytes]);
  });
});

// Regex-driven regression tests for the sentence split + char-proportional
// duration distribution. These guard the fallback caption-timing math —
// the test fails if the char-proportional ratio or contiguity regresses.

describe('estimateSegments', () => {
  it('splits sentences and distributes duration proportionally by character count', () => {
    // "aa." (3 chars) and "bbbbbbbbbb." (11 chars) → 14 total chars over 28s
    const segments = estimateSegments('aa. bbbbbbbbbb.', 28);
    expect(segments).toEqual([
      { text: 'aa.', start: 0, end: 6 },
      { text: 'bbbbbbbbbb.', start: 6, end: 28 },
    ]);
  });

  it('keeps segments contiguous and ends the last segment exactly at totalDuration', () => {
    const text = 'First sentence here. Second one is longer and takes more time. Done.';
    const segments = estimateSegments(text, 30);

    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBe(30);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBe(segments[i - 1].end);
    }
  });

  it('gives a longer sentence a proportionally longer window', () => {
    // "ab." (3 chars) and "cdefghij." (9 chars) → 12 total chars over 24s
    const segments = estimateSegments('ab. cdefghij.', 24);
    const [shortSeg, longSeg] = segments;
    expect(longSeg.end - longSeg.start).toBeGreaterThan(shortSeg.end - shortSeg.start);
    expect(shortSeg.end - shortSeg.start).toBeCloseTo(6, 3);
    expect(longSeg.end - longSeg.start).toBeCloseTo(18, 3);
  });

  it('rounds interior boundaries to 3 decimals while preserving contiguity', () => {
    // 4/6 and 2/6 of 1s → 0.667 (rounded) then exact end at 1
    const segments = estimateSegments('aaa. b.', 1);
    expect(segments[0]).toEqual({ text: 'aaa.', start: 0, end: 0.667 });
    expect(segments[1]).toEqual({ text: 'b.', start: 0.667, end: 1 });
  });

  it('handles a single sentence spanning the whole duration', () => {
    expect(estimateSegments('only one sentence here', 12)).toEqual([
      { text: 'only one sentence here', start: 0, end: 12 },
    ]);
  });

  it('falls back to a single full-duration segment for empty input', () => {
    expect(estimateSegments('', 8)).toEqual([{ text: '', start: 0, end: 8 }]);
    expect(estimateSegments('   ', 8)).toEqual([{ text: '   ', start: 0, end: 8 }]);
  });

  it('handles text with no sentence punctuation as one segment', () => {
    expect(estimateSegments('just words here', 10)).toEqual([
      { text: 'just words here', start: 0, end: 10 },
    ]);
  });

  it('produces zero-width segments when totalDuration is 0 (degenerate input, no throw)', () => {
    const segments = estimateSegments('aa. bbb.', 0);
    expect(segments).toHaveLength(2);
    expect(segments[segments.length - 1].end).toBe(0);
  });
});
