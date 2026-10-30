import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_CODEC,
  EXPORT_CODECS,
  selectMimeType,
} from './exportCodecs';

/** Probe built from a fixed allow-list, mimicking MediaRecorder.isTypeSupported. */
const supporting = (list: string[]) => (mimeType: string) => list.includes(mimeType);
const supportingAll = supporting(Object.values(EXPORT_CODECS).flatMap(c => c.candidates.map(x => x.mimeType)));

describe('EXPORT_CODECS registry', () => {
  it('offers the two campaign container families', () => {
    expect(Object.keys(EXPORT_CODECS).sort()).toEqual(['mp4', 'webm']);
  });

  it('keeps MP4 (H.264) as the default to preserve historical export behavior', () => {
    expect(DEFAULT_EXPORT_CODEC).toBe('mp4');
  });

  it('ends every candidate list with the bare container mimeType', () => {
    for (const codec of Object.values(EXPORT_CODECS)) {
      const last = codec.candidates[codec.candidates.length - 1];
      expect(last.mimeType).toBe(`video/${codec.ext}`);
    }
  });

  it('puts codec-qualified strings before the bare container (fallback order)', () => {
    for (const codec of Object.values(EXPORT_CODECS)) {
      const qualified = codec.candidates.slice(0, -1);
      expect(qualified.length).toBeGreaterThan(0);
      for (const c of qualified) {
        expect(c.mimeType).toContain('codecs=');
        expect(c.mimeType.startsWith(`video/${codec.ext};`)).toBe(true);
      }
    }
  });

  it('has no duplicate mimeTypes across containers (each probe is unambiguous)', () => {
    const all = Object.values(EXPORT_CODECS).flatMap(c => c.candidates.map(x => x.mimeType));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('selectMimeType — requested container supported', () => {
  it('picks the most preferred MP4 candidate when everything is supported', () => {
    const s = selectMimeType('mp4', supportingAll);
    expect(s.mimeType).toBe('video/mp4;codecs=avc1');
    expect(s.label).toBe('MP4 · H.264');
    expect(s.ext).toBe('mp4');
    expect(s.codec).toBe('mp4');
    expect(s.requested).toBe('mp4');
  });

  it('falls back avc1 → h264 within MP4', () => {
    const s = selectMimeType('mp4', supporting(['video/mp4;codecs=h264', 'video/mp4']));
    expect(s.mimeType).toBe('video/mp4;codecs=h264');
    expect(s.codec).toBe('mp4');
  });

  it('lands on bare video/mp4 when only the container itself is supported', () => {
    const s = selectMimeType('mp4', supporting(['video/mp4']));
    expect(s.mimeType).toBe('video/mp4');
    expect(s.label).toBe('MP4');
    expect(s.codec).toBe('mp4');
  });

  it('picks VP9 first for WebM when everything is supported', () => {
    const s = selectMimeType('webm', supportingAll);
    expect(s.mimeType).toBe('video/webm;codecs=vp9');
    expect(s.label).toBe('WebM · VP9');
    expect(s.ext).toBe('webm');
  });

  it('falls back VP9 → VP8 within WebM', () => {
    const s = selectMimeType('webm', supporting(['video/webm;codecs=vp8', 'video/webm']));
    expect(s.mimeType).toBe('video/webm;codecs=vp8');
    expect(s.label).toBe('WebM · VP8');
  });

  it('lands on bare video/webm when only the container itself is supported', () => {
    const s = selectMimeType('webm', supporting(['video/webm']));
    expect(s.mimeType).toBe('video/webm');
    expect(s.label).toBe('WebM');
  });
});

describe('selectMimeType — graceful cross-container fallback', () => {
  it('requested MP4 with no MP4 support falls back to the WebM chain, best-first', () => {
    const s = selectMimeType('mp4', supporting([
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
    ]));
    expect(s.mimeType).toBe('video/webm;codecs=vp9');
    expect(s.codec).toBe('webm');
    expect(s.requested).toBe('mp4');
    expect(s.ext).toBe('webm');
  });

  it('requested WebM with no WebM support falls back to the MP4 chain', () => {
    const s = selectMimeType('webm', supporting([
      'video/mp4;codecs=avc1', 'video/mp4;codecs=h264', 'video/mp4',
    ]));
    expect(s.mimeType).toBe('video/mp4;codecs=avc1');
    expect(s.codec).toBe('mp4');
    expect(s.requested).toBe('webm');
    expect(s.ext).toBe('mp4');
  });

  it('cross-fallback still walks the alternate chain in order (vp8 before bare webm)', () => {
    const s = selectMimeType('mp4', supporting(['video/webm;codecs=vp8', 'video/webm']));
    expect(s.mimeType).toBe('video/webm;codecs=vp8');
    expect(s.codec).toBe('webm');
  });

  it('never returns the requested container when its mimeTypes are unsupported', () => {
    const s = selectMimeType('mp4', supporting(['video/webm']));
    expect(s.mimeType).not.toContain('video/mp4');
    expect(s.ext).toBe('webm');
  });
});

describe('selectMimeType — nothing supported', () => {
  it('returns bare WebM as the hard fallback (MediaRecorder surfaces the real error)', () => {
    const s = selectMimeType('mp4', supporting([]));
    expect(s.mimeType).toBe('video/webm');
    expect(s.ext).toBe('webm');
    expect(s.codec).toBe('webm');
    expect(s.requested).toBe('mp4');
  });
});

describe('selectMimeType — selection is always the first supported candidate', () => {
  it.each(['mp4', 'webm'] as const)(
    'returns the first supported entry of the ordered candidate walk for %s',
    requested => {
      const order = [
        ...EXPORT_CODECS[requested].candidates,
        ...EXPORT_CODECS[requested === 'webm' ? 'mp4' : 'webm'].candidates,
      ];
      // Drop one candidate at a time to walk the fallback chain end-to-end.
      for (let drop = 0; drop < order.length; drop++) {
        const supported = order.slice(drop).map(c => c.mimeType);
        const s = selectMimeType(requested, supporting(supported));
        expect(s.mimeType).toBe(order[drop].mimeType);
        expect(s.label).toBe(order[drop].label);
      }
    }
  );
});
