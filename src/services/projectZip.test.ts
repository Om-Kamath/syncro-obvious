import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptionStyle, VideoClip, Voiceover } from '../types';
import {
  exportProjectZip,
  importProjectZip,
  ProjectZipError,
} from './projectZip';
import { unzip, zip, strFromU8, strToU8 } from 'fflate';

// Node has no blob-URL registry; stand in a stub so restored files get
// deterministic fake URLs the tests can assert on.
let urlCounter = 0;
const createObjectURL = vi.fn(() => `blob:fixture-${++urlCounter}`);
const revokeObjectURL = vi.fn();
const urlStatics = URL as unknown as {
  createObjectURL?: typeof createObjectURL;
  revokeObjectURL?: typeof revokeObjectURL;
};

beforeAll(() => {
  urlStatics.createObjectURL = createObjectURL;
  urlStatics.revokeObjectURL = revokeObjectURL;
});

beforeEach(() => {
  vi.clearAllMocks();
  urlCounter = 0;
});

const CLIP_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
const CLIP2_BYTES = new Uint8Array([0x10, 0x11, 0x12]);
const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x0a]);

function fixtureFile(name: string, type: string, bytes: Uint8Array): File {
  return new File([bytes], name, { type });
}

const fixtureCaptionStyle: CaptionStyle = {
  mode: 'word-highlight',
  fontSize: 22,
  color: '#f8fafc',
  bgColor: '#4c1d95',
  position: 'bottom',
};

function fixtureClips(): VideoClip[] {
  return [
    {
      id: 'clip-1',
      file: fixtureFile('intro.mp4', 'video/mp4', CLIP_BYTES),
      url: 'blob:original-1',
      duration: 12.5,
      trimmedDuration: 10,
      trimStart: 1.25,
      startTime: 0,
      name: 'intro.mp4',
      analysis: 'Opening shot of the office.',
      textOverlay: 'Welcome back',
      track: 0,
      transitionIn: 'fade',
      alternatives: [{ id: 'clip-2', confidence: 0.8, reason: 'Matches narration beat' }],
    },
    {
      id: 'clip-2',
      file: fixtureFile('B-Roll!.mp4', 'video/mp4', CLIP2_BYTES),
      url: 'blob:original-2',
      duration: 5,
      startTime: 10,
      name: 'B-Roll!.mp4',
      track: 0,
    },
  ];
}

function fixtureVoiceover(): Voiceover {
  return {
    file: fixtureFile('narration.mp3', 'audio/mpeg', AUDIO_BYTES),
    url: 'blob:original-voiceover',
    duration: 30,
    trimStart: 0.5,
    trimEnd: 29.5,
    transcription: 'Hello and welcome.',
    segments: [{ text: 'Hello and welcome.', start: 0.5, end: 3.2 }],
    startTime: 0,
  };
}

async function unzipBytes(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => (error ? reject(error) : resolve(files)));
  });
}

async function buildZip(manifest: unknown): Promise<Blob> {
  return new Promise((resolve, reject) => {
    zip({ 'project.json': strToU8(JSON.stringify(manifest)) }, (error, data) =>
      error ? reject(error) : resolve(new Blob([data]))
    );
  });
}

function bytesOf(data: Uint8Array): Buffer {
  return Buffer.from(data);
}

describe('exportProjectZip → importProjectZip round trip', () => {
  it('restores clip metadata and media bytes on a tiny fixture project', async () => {
    const blob = await exportProjectZip({
      clips: fixtureClips(),
      voiceover: fixtureVoiceover(),
      captionsEnabled: true,
      captionStyle: fixtureCaptionStyle,
    });

    const imported = await importProjectZip(blob);

    expect(imported.name).toBe('Syncro project');
    expect(imported.captionsEnabled).toBe(true);
    expect(imported.captionStyle).toEqual(fixtureCaptionStyle);

    expect(imported.clips).toHaveLength(2);
    const [clip1, clip2] = imported.clips;

    // Serializable metadata survives verbatim (startTime included — import
    // must not re-chain, or multi-track stacks would collapse).
    expect(clip1).toMatchObject({
      id: 'clip-1',
      name: 'intro.mp4',
      duration: 12.5,
      trimmedDuration: 10,
      trimStart: 1.25,
      startTime: 0,
      analysis: 'Opening shot of the office.',
      textOverlay: 'Welcome back',
      track: 0,
      transitionIn: 'fade',
      alternatives: [{ id: 'clip-2', confidence: 0.8, reason: 'Matches narration beat' }],
    });
    expect(clip2).toMatchObject({ id: 'clip-2', name: 'B-Roll!.mp4', duration: 5, startTime: 10, trimmedDuration: undefined });

    // Media is restored as playable File objects with the original bytes.
    expect(clip1.file).toBeInstanceOf(File);
    expect(clip1.file.name).toBe('intro.mp4');
    expect(clip1.file.type).toBe('video/mp4');
    expect(bytesOf(new Uint8Array(await clip1.file.arrayBuffer()))).toEqual(bytesOf(CLIP_BYTES));
    expect(bytesOf(new Uint8Array(await clip2.file.arrayBuffer()))).toEqual(bytesOf(CLIP2_BYTES));
    expect(clip1.url).toMatch(/^blob:fixture-\d+$/);
    expect(clip2.url).toMatch(/^blob:fixture-\d+$/);

    expect(imported.voiceover).not.toBeNull();
    expect(imported.voiceover).toMatchObject({
      duration: 30,
      trimStart: 0.5,
      trimEnd: 29.5,
      transcription: 'Hello and welcome.',
      segments: [{ text: 'Hello and welcome.', start: 0.5, end: 3.2 }],
      startTime: 0,
    });
    expect(imported.voiceover?.file?.name).toBe('narration.mp3');
    expect(imported.voiceover?.file?.type).toBe('audio/mpeg');
    expect(bytesOf(new Uint8Array(await imported.voiceover!.file!.arrayBuffer()))).toEqual(bytesOf(AUDIO_BYTES));
  });

  it('round-trips an empty project', async () => {
    const blob = await exportProjectZip({
      clips: [],
      voiceover: null,
      captionsEnabled: false,
      captionStyle: { mode: 'lower-third', fontSize: 16, color: '#ffffff', bgColor: '#000000', position: 'bottom' },
    });
    const imported = await importProjectZip(blob);
    expect(imported.clips).toEqual([]);
    expect(imported.voiceover).toBeNull();
    expect(imported.captionsEnabled).toBe(false);
  });

  it('recovers AI-generated voiceover bytes from the blob URL via fetch', async () => {
    const response = new Response(new Blob([AUDIO_BYTES], { type: 'audio/wav' }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => response));

    const voiceover = fixtureVoiceover();
    voiceover.file = undefined; // TTS-generated audio: no File handle
    const blob = await exportProjectZip({
      clips: [],
      voiceover,
      captionsEnabled: false,
      captionStyle: fixtureCaptionStyle,
    });

    const imported = await importProjectZip(blob);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(voiceover.url);
    expect(imported.voiceover?.file?.type).toBe('audio/wav');
    expect(bytesOf(new Uint8Array(await imported.voiceover!.file!.arrayBuffer()))).toEqual(bytesOf(AUDIO_BYTES));
  });

  it('keeps voiceover metadata when its bytes cannot be recovered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('blob URL gone'); }));

    const voiceover = fixtureVoiceover();
    voiceover.file = undefined;
    const blob = await exportProjectZip({
      clips: [],
      voiceover,
      captionsEnabled: false,
      captionStyle: fixtureCaptionStyle,
    });

    const imported = await importProjectZip(blob);
    expect(imported.voiceover).toMatchObject({
      duration: 30,
      transcription: 'Hello and welcome.',
      url: '',
      file: undefined,
    });
  });

  it('writes a versioned manifest and stores media uncompressed alongside it', async () => {
    const blob = await exportProjectZip({
      clips: fixtureClips(),
      voiceover: fixtureVoiceover(),
      captionsEnabled: true,
      captionStyle: fixtureCaptionStyle,
    });

    const entries = await unzipBytes(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      'media/clip-0-intro.mp4',
      'media/clip-1-B-Roll_.mp4',
      'media/voiceover-narration.mp3',
      'project.json',
    ]);

    const manifest = JSON.parse(strFromU8(entries['project.json']));
    expect(manifest.format).toBe('syncro-project');
    expect(manifest.version).toBe(1);
    expect(manifest.name).toBe('Syncro project');
    expect(new Date(manifest.exportedAt).toISOString()).toBe(manifest.exportedAt);
    expect(manifest.clips).toHaveLength(2);
    expect(manifest.clips[0].mediaPath).toBe('media/clip-0-intro.mp4');
    expect(manifest.voiceover.mediaPath).toBe('media/voiceover-narration.mp3');
  });
});

describe('importProjectZip rejects bad archives', () => {
  it('rejects bytes that are not a zip at all', async () => {
    await expect(importProjectZip(new Blob([new Uint8Array([1, 2, 3, 4])])))
      .rejects.toBeInstanceOf(ProjectZipError);
  });

  it('rejects a zip without a Syncro manifest', async () => {
    const blob = await new Promise<Blob>((resolve, reject) => {
      zip({ 'readme.txt': strToU8('hello') }, (error, data) =>
        error ? reject(error) : resolve(new Blob([data]))
      );
    });
    await expect(importProjectZip(blob)).rejects.toThrow(/not a Syncro project archive/i);
  });

  it('rejects a manifest exported by a newer format version', async () => {
    const blob = await buildZip({ format: 'syncro-project', version: 99 });
    await expect(importProjectZip(blob)).rejects.toThrow(/newer version of Syncro/i);
  });

  it('names the clip whose media entry is missing', async () => {
    const blob = await buildZip({
      format: 'syncro-project',
      version: 1,
      name: 'Broken',
      clips: [{ id: 'c1', name: 'intro.mp4', duration: 3, startTime: 0, mediaPath: 'media/clip-0-intro.mp4' }],
      voiceover: null,
      captionsEnabled: false,
      captionStyle: { mode: 'lower-third', fontSize: 16, color: '#ffffff', bgColor: '#000000', position: 'bottom' },
    });
    await expect(importProjectZip(blob)).rejects.toThrow(/incomplete.*intro\.mp4/is);
  });

  it('rejects a manifest with a malformed clip record', async () => {
    const blob = await buildZip({
      format: 'syncro-project',
      version: 1,
      clips: [{ name: 'intro.mp4', duration: 3, startTime: 0, mediaPath: 'media/clip-0-intro.mp4' }],
      voiceover: null,
      captionsEnabled: false,
      captionStyle: { mode: 'lower-third', fontSize: 16, color: '#ffffff', bgColor: '#000000', position: 'bottom' },
    });
    await expect(importProjectZip(blob)).rejects.toThrow(/Clip 1 is malformed \(missing "id"\)/);
  });

  it('revokes URLs it created when the import fails partway', async () => {
    const entries = await unzipBytes(
      new Uint8Array(
        await (
          await exportProjectZip({
            clips: fixtureClips(),
            voiceover: null,
            captionsEnabled: false,
            captionStyle: fixtureCaptionStyle,
          })
        ).arrayBuffer()
      )
    );
    delete entries['media/clip-1-B-Roll_.mp4']; // second clip's media vanishes

    const corrupted = await new Promise<Blob>((resolve, reject) => {
      zip(entries, (error, data) => (error ? reject(error) : resolve(new Blob([data]))));
    });

    await expect(importProjectZip(corrupted)).rejects.toBeInstanceOf(ProjectZipError);
    expect(createObjectURL).toHaveBeenCalledTimes(1); // first clip got a URL...
    expect(revokeObjectURL).toHaveBeenCalledTimes(1); // ...and it was cleaned up
  });
});
