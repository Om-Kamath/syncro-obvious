// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AUTOSAVE_STORAGE_KEY,
  AutosaveStorageError,
  buildProjectSnapshot,
  saveProjectSnapshot,
} from './projectSnapshot';
import type { VideoClip, Voiceover } from '../types';

function makeClip(partial: Partial<VideoClip> & { id: string }): VideoClip {
  return {
    file: new File(['bytes'], 'clip.mp4', { type: 'video/mp4' }),
    url: 'blob:clip-url',
    duration: 10,
    startTime: 0,
    name: partial.id,
    ...partial,
  };
}

function makeVoiceover(partial: Partial<Voiceover> = {}): Voiceover {
  return {
    file: new File(['audio'], 'voice.wav', { type: 'audio/wav' }),
    url: 'blob:voice-url',
    duration: 30,
    ...partial,
  };
}

describe('buildProjectSnapshot', () => {
  it('strips File handles and blob URLs but keeps editable metadata', () => {
    const clip = makeClip({
      id: 'a',
      name: 'intro.mp4',
      duration: 12.5,
      trimmedDuration: 8,
      trimStart: 2,
      startTime: 0,
      textOverlay: 'Hello',
      track: 1,
      transitionIn: 'fade',
      analysis: 'opening scene',
      alternatives: [{ id: 'b', confidence: 0.9, reason: 'tighter cut' }],
    });
    const snapshot = buildProjectSnapshot([clip], null, { mode: 'lower-third', fontSize: 16, color: '#ffffff', bgColor: '#000000', position: 'bottom' }, true);

    expect(snapshot.version).toBe(1);
    expect(snapshot.clips).toHaveLength(1);
    const serialized = JSON.parse(JSON.stringify(snapshot.clips[0]));
    expect(serialized).toEqual({
      id: 'a',
      name: 'intro.mp4',
      duration: 12.5,
      trimmedDuration: 8,
      trimStart: 2,
      startTime: 0,
      textOverlay: 'Hello',
      track: 1,
      transitionIn: 'fade',
      analysis: 'opening scene',
      alternatives: [{ id: 'b', confidence: 0.9, reason: 'tighter cut' }],
    });
    expect(snapshot.voiceover).toBeNull();
    expect(snapshot.captionsEnabled).toBe(true);
  });

  it('keeps voiceover metadata and caption settings, drops its file and blob url', () => {
    const voiceover = makeVoiceover({
      trimStart: 1,
      trimEnd: 25,
      startTime: 0.5,
      transcription: 'welcome back',
      segments: [{ text: 'welcome back', start: 0.5, end: 1.4 }],
    });
    const captionStyle = { mode: 'word-highlight', fontSize: 20, color: '#ffffff', bgColor: '#111111', position: 'top' } as const;
    const snapshot = buildProjectSnapshot([], voiceover, captionStyle, false);

    expect(snapshot.voiceover).toEqual({
      duration: 30,
      trimStart: 1,
      trimEnd: 25,
      startTime: 0.5,
      transcription: 'welcome back',
      segments: [{ text: 'welcome back', start: 0.5, end: 1.4 }],
    });
    expect(snapshot.captionStyle).toEqual(captionStyle);
    expect(snapshot.captionsEnabled).toBe(false);
    // The whole snapshot must survive a JSON round-trip untouched.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('does not mutate the state it serializes', () => {
    const clip = makeClip({ id: 'a' });
    const voiceover = makeVoiceover();
    buildProjectSnapshot([clip], voiceover, { mode: 'lower-third', fontSize: 16, color: '#ffffff', bgColor: '#000000', position: 'bottom' }, true);
    expect(clip.file).toBeInstanceOf(File);
    expect(clip.url).toBe('blob:clip-url');
    expect(voiceover.url).toBe('blob:voice-url');
  });
});

describe('saveProjectSnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const snapshot = buildProjectSnapshot(
    [makeClip({ id: 'a', name: 'intro.mp4' })],
    null,
    { mode: 'lower-third', fontSize: 16, color: '#ffffff', bgColor: '#000000', position: 'bottom' },
    true,
  );

  it('writes the snapshot with a savedAt timestamp to the autosave key', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    await saveProjectSnapshot(snapshot);

    expect(setItem).toHaveBeenCalledTimes(1);
    const [key, value] = setItem.mock.calls[0];
    expect(key).toBe(AUTOSAVE_STORAGE_KEY);
    const record = JSON.parse(value);
    expect(typeof record.savedAt).toBe('string');
    expect(record.snapshot).toEqual(snapshot);
  });

  it('actually persists readable bytes to localStorage', async () => {
    await saveProjectSnapshot(snapshot);
    const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).snapshot.clips[0].name).toBe('intro.mp4');
  });

  it('rejects with AutosaveStorageError when the storage write fails', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    await expect(saveProjectSnapshot(snapshot)).rejects.toBeInstanceOf(AutosaveStorageError);
    await expect(saveProjectSnapshot(snapshot)).rejects.toThrow(/storage/);
  });
});
