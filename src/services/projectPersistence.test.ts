import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app';
import type { CaptionStyle, VideoClip, Voiceover } from '../types';
import { MediaNotFoundError } from './mediaClient';
import {
  type MediaTransport,
  type ProjectStorage,
  ProjectNotFoundError,
  type SavedProjectRecord,
  type SavedProjectSummary,
  newProjectId,
  restoreProject,
  saveProject,
  serializeProject,
} from './projectPersistence';

/* ------------------------------------------------------------------ */
/* Test doubles                                                        */
/* ------------------------------------------------------------------ */

function memoryStorage(): ProjectStorage & { records: SavedProjectRecord[] } {
  const records: SavedProjectRecord[] = [];
  return {
    records,
    saveRecord(record): void {
      const existing = records.findIndex(r => r.id === record.id);
      if (existing >= 0) records.splice(existing, 1);
      records.push(record);
    },
    getRecord(id): SavedProjectRecord | undefined {
      return records.find(r => r.id === id);
    },
    listRecords(): SavedProjectRecord[] {
      return [...records].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    deleteRecord(id): void {
      const existing = records.findIndex(r => r.id === id);
      if (existing >= 0) records.splice(existing, 1);
    },
  };
}

/** Fake object-URL minting: records every minted URL for assertions. */
function fakeUrlMinter() {
  const urls: string[] = [];
  return {
    urls,
    createObjectUrl: (blob: Blob) => {
      const url = `blob:fake-${urls.length}`;
      void blob;
      urls.push(url);
      return url;
    },
  };
}

function testClip(name: string, overrides: Partial<VideoClip> = {}): VideoClip {
  const bytes = new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * 7) % 251));
  return {
    id: name.toLowerCase(),
    file: new File([bytes], `${name}.webm`, { type: 'video/webm' }),
    url: `blob:original-${name}`,
    duration: 12.5,
    startTime: 0,
    name,
    ...overrides,
  };
}

function testVoiceover(overrides: Partial<Voiceover> = {}): Voiceover {
  const bytes = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 3) % 200));
  return {
    file: new File([bytes], 'narration.wav', { type: 'audio/wav' }),
    url: 'blob:original-voiceover',
    duration: 8,
    transcription: 'Hello world.',
    segments: [{ text: 'Hello world.', start: 0, end: 8 }],
    startTime: 0,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Serialization (pure)                                                */
/* ------------------------------------------------------------------ */

describe('serializeProject', () => {
  it('produces a JSON-safe snapshot that excludes file and blob URLs', () => {
    const serialized = serializeProject({
      clips: [
        testClip('One', { startTime: 0, trimStart: 1, trimmedDuration: 10, textOverlay: 'hi', track: 2 }),
        testClip('Two', { startTime: 10 }),
      ],
      voiceover: testVoiceover({ trimStart: 0.5, trimEnd: 7.5 }),
      captionStyle: defaultCaptionStyle(),
      captionsEnabled: true,
    });

    // file/url are browser-only handles; nothing else may be dropped.
    for (const clip of serialized.clips) {
      expect(clip).not.toHaveProperty('file');
      expect(clip).not.toHaveProperty('url');
    }
    expect(serialized.voiceover).not.toHaveProperty('file');
    expect(serialized.voiceover).not.toHaveProperty('url');
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });
});

/* ------------------------------------------------------------------ */
/* Integration: save-with-media -> load -> clips playable              */
/* ------------------------------------------------------------------ */

describe('projectPersistence media round-trip', () => {
  let mediaRoot: string;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let transport: MediaTransport;
  let storage: ReturnType<typeof memoryStorage>;

  beforeAll(async () => {
    mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'syncro-media-test-'));
    const app = createApp({ media: { rootDir: mediaRoot } });
    server = app.listen(0);
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;

    transport = {
      async uploadMedia(blob, filename, mime) {
        const res = await fetch(`http://127.0.0.1:${port}/api/media?filename=${encodeURIComponent(filename)}`, {
          method: 'POST',
          headers: { 'Content-Type': mime },
          body: blob,
        });
        if (!res.ok) throw new Error(`Media upload failed (${res.status})`);
        return (await res.json()) as { id: string };
      },
      async fetchMedia(mediaId) {
        const res = await fetch(`http://127.0.0.1:${port}/api/media/${encodeURIComponent(mediaId)}`);
        if (res.status === 404) throw new MediaNotFoundError(mediaId);
        if (!res.ok) throw new Error(`Media fetch failed (${res.status})`);
        return res.blob();
      },
    };
  });

  beforeEach(() => {
    storage = memoryStorage();
  });

  afterAll(async () => {
    // Destroy keep-alive sockets first so close() does not wait on idle
    // connections, then wait for the listener to drop.
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('saves clips + voiceover with media ids, then restores playable files and fresh object URLs', async () => {
    const clips = [
      testClip('Intro', { startTime: 0, trimStart: 1, trimmedDuration: 10 }),
      testClip('Main', { startTime: 10, track: 1 }),
    ];
    const voiceover = testVoiceover({ startTime: 0.5 });
    const minted = fakeUrlMinter();

    const saved = await saveProject({ name: 'Trip', clips, voiceover, captionStyle: defaultCaptionStyle(), captionsEnabled: true, transport, storage });
    const record = storage.getRecord(saved.record.id);
    expect(record).toBeDefined();

    // Every piece of media got a persisted id (2 clips + voiceover).
    const savedClips = record!.project.clips;
    expect(savedClips).toHaveLength(2);
    expect(new Set(savedClips.map(c => c.mediaId)).size).toBe(2);
    expect(record!.project.voiceover?.mediaId).toBeDefined();

    const result = await restoreProject(saved.record.id, { transport, storage, createObjectUrl: minted.createObjectUrl });

    // Clips playable: real File objects, original bytes, fresh URLs.
    expect(result.clipErrors).toEqual([]);
    expect(result.voiceoverError).toBeNull();
    expect(result.clips).toHaveLength(2);
    for (const [index, restored] of result.clips.entries()) {
      const original = clips[index];
      expect(restored.mediaMissing).toBeUndefined();
      expect(minted.urls).toContain(restored.url);
      expect(restored.file?.name).toBe(original.file.name);
      expect(new Uint8Array(await restored.file!.arrayBuffer())).toEqual(new Uint8Array(await original.file.arrayBuffer()));
      // Editor settings ride along with the media.
      expect(restored.trimStart).toBe(original.trimStart);
      expect(restored.trimmedDuration).toBe(original.trimmedDuration);
      expect(restored.track).toBe(original.track);
      expect(restored.startTime).toBe(original.startTime);
    }
    // The restored clip must NOT keep the stale original blob: URL.
    expect(result.clips[0].url).not.toBe(clips[0].url);

    // Voiceover playable too.
    expect(result.voiceover?.file?.name).toBe('narration.wav');
    expect(new Uint8Array(await result.voiceover!.file!.arrayBuffer()))
      .toEqual(new Uint8Array(await voiceover.file!.arrayBuffer()));
    expect(result.voiceover?.transcription).toBe('Hello world.');
    expect(result.voiceover?.url).not.toBe(voiceover.url);
  });

  it('marks only the affected clip as media-missing when its saved blob is gone', async () => {
    const clips = [testClip('Survivor', { startTime: 0 }), testClip('Ghost', { startTime: 5 })];
    const saved = await saveProject({ name: 'Lossy', clips, voiceover: null, captionStyle: defaultCaptionStyle(), captionsEnabled: false, transport, storage });

    const ghostMediaId = storage.getRecord(saved.record.id)!.project.clips[1].mediaId!;
    // Main's store layout: flat <id>.bin blob + <id>.json metadata sidecar.
    await rm(path.join(mediaRoot, `${ghostMediaId}.bin`), { force: true });
    await rm(path.join(mediaRoot, `${ghostMediaId}.json`), { force: true });
    const minted = fakeUrlMinter();


    const result = await restoreProject(saved.record.id, { transport, storage, createObjectUrl: minted.createObjectUrl });

    // Per-clip error: settings restored, media flagged, nothing crashes.
    expect(result.clips).toHaveLength(2);
    expect(result.clips[1].mediaMissing).toBe(true);
    // VideoClip.file is non-optional — a missing clip gets an empty
    // placeholder File and no object URL, so nothing can play.
    expect(result.clips[1].file?.size).toBe(0);
    expect(result.clips[1].url).toBe('');
    expect(result.clips[1].startTime).toBe(5);
    expect(result.clipErrors).toEqual([{ clipId: 'ghost', name: 'Ghost', reason: expect.stringContaining('no longer exists') }]);

    // The other clip is still fully playable.
    expect(result.clips[0].mediaMissing).toBeUndefined();
    expect(result.clips[0].url).toBe('blob:fake-0');
    expect(new Uint8Array(await result.clips[0].file!.arrayBuffer()))
      .toEqual(new Uint8Array(await clips[0].file.arrayBuffer()));

    // Re-saving a missing-media clip keeps its dangling id (no duplicate upload).
    const resaved = await saveProject({
      name: 'Lossy',
      clips: result.clips as VideoClip[],
      voiceover: null,
      captionStyle: defaultCaptionStyle(),
      captionsEnabled: false,
      transport,
      storage,
    });
    expect(storage.getRecord(resaved.record.id)!.project.clips[1].mediaId).toBe(ghostMediaId);
  });

  it('reports a missing voiceover blob without dropping the project load', async () => {
    const saved = await saveProject({
      name: 'NoVoice',
      clips: [testClip('Only', { startTime: 0 })],
      voiceover: testVoiceover(),
      captionStyle: defaultCaptionStyle(),
      captionsEnabled: true,
      transport,
      storage,
    });
    const voiceoverMediaId = storage.getRecord(saved.record.id)!.project.voiceover!.mediaId!;
    await rm(path.join(mediaRoot, `${voiceoverMediaId}.bin`), { force: true });
    await rm(path.join(mediaRoot, `${voiceoverMediaId}.json`), { force: true });

    const result = await restoreProject(saved.record.id, { transport, storage, createObjectUrl: fakeUrlMinter().createObjectUrl });

    expect(result.voiceover).toBeNull();
    expect(result.voiceoverError).toContain('no longer exists');
    expect(result.clips).toHaveLength(1);
    expect(result.clipErrors).toEqual([]);
  });

  it('restores a legacy voiceover (no media id) as estimated-segments metadata', async () => {
    const saved = await saveProject({
      name: 'Legacy',
      clips: [],
      voiceover: testVoiceover(),
      captionStyle: defaultCaptionStyle(),
      captionsEnabled: true,
      transport,
      storage,
    });
    // Simulate a record saved before media persistence existed.
    const legacy = storage.getRecord(saved.record.id)!;
    const legacyRecord: SavedProjectRecord = {
      ...legacy,
      project: { ...legacy.project, voiceover: { duration: 8, transcription: 'Hello world.', segments: [{ text: 'Hello world.', start: 0, end: 8 }] } },
    };
    storage.saveRecord(legacyRecord);

    const result = await restoreProject(saved.record.id, { transport, storage, createObjectUrl: fakeUrlMinter().createObjectUrl });

    // No audio bytes exist server-side: the voiceover is dropped with a
    // surfaced reason, and the load itself still succeeds.
    expect(result.voiceover).toBeNull();
    expect(result.voiceoverError).toContain('older version');
    expect(result.clips).toEqual([]);
  });

  it('lists saved projects newest-first and deletes records', async () => {
    const first = await saveProject({ name: 'First', clips: [], voiceover: null, captionStyle: defaultCaptionStyle(), captionsEnabled: false, transport, storage });
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await saveProject({ name: 'Second', clips: [], voiceover: null, captionStyle: defaultCaptionStyle(), captionsEnabled: false, transport, storage });

    const summaries: SavedProjectSummary[] = storage.listRecords().map(r => ({
      id: r.id, name: r.name, savedAt: r.savedAt, clipCount: r.project.clips.length, hasVoiceover: r.project.voiceover !== null,
    }));
    expect(summaries.map(s => s.name)).toEqual(['Second', 'First']);

    storage.deleteRecord(first.record.id);
    expect(storage.getRecord(first.record.id)).toBeUndefined();
    expect(storage.getRecord(second.record.id)).toBeDefined();
  });

  it('throws ProjectNotFoundError for a record that no longer exists', async () => {
    await expect(restoreProject(newProjectId(), { transport, storage, createObjectUrl: fakeUrlMinter().createObjectUrl }))
      .rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

function defaultCaptionStyle(): CaptionStyle {
  return { mode: 'word-highlight', fontSize: 24, color: '#ffffff', bgColor: 'rgba(0,0,0,0.5)', position: 'bottom' };
}
