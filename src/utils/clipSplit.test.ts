import { describe, it, expect } from 'vitest';
import {
  effectiveClipDuration,
  findClipAtPlayhead,
  splitClip,
  splitClipsAtPlayhead,
} from './clipSplit';
import { chainClips } from './chainClips';
import type { VideoClip } from '../types';

function makeClip(partial: Partial<VideoClip> & { id: string }): VideoClip {
  return {
    file: undefined as unknown as File,
    url: `blob:${partial.id}`,
    duration: 10,
    startTime: 0,
    name: partial.id,
    ...partial,
  };
}

describe('effectiveClipDuration', () => {
  it('prefers trimmedDuration over duration', () => {
    expect(effectiveClipDuration(makeClip({ id: 'a', duration: 10, trimmedDuration: 4 }))).toBe(4);
  });

  it('falls back to duration when untrimmed', () => {
    expect(effectiveClipDuration(makeClip({ id: 'a', duration: 10 }))).toBe(10);
  });
});

describe('findClipAtPlayhead', () => {
  it('finds the clip spanning the playhead', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0 }),
      makeClip({ id: 'b', duration: 5, startTime: 5 }),
    ];
    expect(findClipAtPlayhead(clips, 7)?.id).toBe('b');
    expect(findClipAtPlayhead(clips, 4.9)?.id).toBe('a');
  });

  it('returns null in a gap or past the end', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0 }),
      makeClip({ id: 'b', duration: 5, startTime: 8 }), // gap 5..8
    ];
    expect(findClipAtPlayhead(clips, 6)).toBeNull();
    expect(findClipAtPlayhead(clips, 13)).toBeNull();
    expect(findClipAtPlayhead([], 0)).toBeNull();
  });

  it('resolves overlapping clips to the latest-starting one (preview parity)', () => {
    const clips = [
      makeClip({ id: 'bottom', duration: 10, startTime: 0 }),
      makeClip({ id: 'top', duration: 10, startTime: 3, track: 1 }),
    ];
    expect(findClipAtPlayhead(clips, 5)?.id).toBe('top');
  });

  it('excludes the instant at a clip end boundary', () => {
    const clips = [makeClip({ id: 'a', duration: 5, startTime: 0 })];
    expect(findClipAtPlayhead(clips, 5)).toBeNull();
  });
});

describe('splitClip', () => {
  it('splits an untrimmed clip: left trims, right continues the media', () => {
    const clip = makeClip({ id: 'a', duration: 10, startTime: 3 });
    const result = splitClip(clip, 4, 'b');

    expect(result).not.toBeNull();
    const { left, right } = result!;

    // Left keeps identity, is right-trimmed to the split point.
    expect(left.id).toBe('a');
    expect(left.trimStart).toBeUndefined();
    expect(left.trimmedDuration).toBe(4);
    expect(left.startTime).toBe(3);

    // Right continues at the media split point, chained after left.
    expect(right.id).toBe('b');
    expect(right.trimStart).toBe(4);
    expect(right.trimmedDuration).toBe(6);
    expect(right.startTime).toBe(7);
    expect(right.url).toBe(clip.url);
  });

  it('respects an existing trimStart: media positions stay continuous', () => {
    // Clip plays media [2, 7) on the timeline (trimStart 2, effective 5).
    const clip = makeClip({ id: 'a', duration: 10, trimStart: 2, trimmedDuration: 5, startTime: 1 });
    const result = splitClip(clip, 2, 'b')!;
    const { left, right } = result;

    // Left still plays [2, 4).
    expect(left.trimStart).toBe(2);
    expect(left.trimmedDuration).toBe(2);

    // Right plays [4, 7) — media continuity across the split.
    expect(right.trimStart).toBe(4);
    expect(right.trimmedDuration).toBe(3);
    expect(left.trimStart + left.trimmedDuration).toBe(right.trimStart);

    // Timeline continuity: right starts exactly where left ends.
    expect(left.startTime).toBe(1);
    expect(right.startTime).toBe(3);
    expect(left.startTime + effectiveClipDuration(left)).toBe(right.startTime);
  });

  it('treats a trimStart-only clip as spanning the full duration (chainClips parity)', () => {
    // trimStart without trimmedDuration: chainClips/playhead see a 10s span.
    const clip = makeClip({ id: 'a', duration: 10, trimStart: 2 });
    const result = splitClip(clip, 4, 'b')!;
    expect(result.left.trimmedDuration).toBe(4);
    expect(result.right.trimStart).toBe(6);
    expect(result.right.trimmedDuration).toBe(6);
  });

  it('returns null when the offset is on or outside the span boundary', () => {
    const clip = makeClip({ id: 'a', duration: 10, trimStart: 2, trimmedDuration: 5 });
    expect(splitClip(clip, 0, 'b')).toBeNull();       // at start
    expect(splitClip(clip, 5, 'b')).toBeNull();       // at end
    expect(splitClip(clip, 6, 'b')).toBeNull();       // past end
    expect(splitClip(clip, -1, 'b')).toBeNull();      // before start
  });

  it('uses the createUrl factory for the right piece so each owns its URL', () => {
    const clip = makeClip({ id: 'a', duration: 10 });
    const calls: VideoClip[] = [];
    const result = splitClip(clip, 5, 'b', c => {
      calls.push(c);
      return 'blob:fresh';
    })!;
    expect(calls).toEqual([clip]);
    expect(result.right.url).toBe('blob:fresh');
    expect(result.left.url).toBe(clip.url);
  });

  it('keeps per-span decorations on the left and starts the right clean', () => {
    const clip = makeClip({
      id: 'a',
      duration: 10,
      textOverlay: 'hello',
      transitionIn: 'fade',
      track: 2,
      analysis: 'a park scene',
      alternatives: [{ id: 'x', confidence: 0.9, reason: 'similar' }],
    });
    const result = splitClip(clip, 5, 'b')!;
    expect(result.left.textOverlay).toBe('hello');
    expect(result.left.transitionIn).toBe('fade');
    expect(result.right.textOverlay).toBeUndefined();
    expect(result.right.transitionIn).toBeUndefined();
    // Shared media facts carry to the right piece.
    expect(result.right.track).toBe(2);
    expect(result.right.analysis).toBe('a park scene');
    expect(result.right.duration).toBe(10);
  });

  it('does not mutate the input clip and conserves the span', () => {
    const clip = makeClip({ id: 'a', duration: 10, trimStart: 1, trimmedDuration: 8, startTime: 2 });
    const snapshot = { ...clip };
    const result = splitClip(clip, 3, 'b')!;
    expect(clip).toEqual(snapshot);
    expect(effectiveClipDuration(result.left) + effectiveClipDuration(result.right)).toBe(8);
  });
});

describe('splitClipsAtPlayhead', () => {
  it('splits the active clip and inserts the right piece directly after it', () => {
    const a = makeClip({ id: 'a', duration: 5, startTime: 0 });
    const b = makeClip({ id: 'b', duration: 5, startTime: 5 });
    const result = splitClipsAtPlayhead([a, b], 3, 'a2');

    expect(result).not.toBeNull();
    expect(result!.map(c => c.id)).toEqual(['a', 'a2', 'b']);
    expect(result![1].trimStart).toBe(3);
    expect(result![1].startTime).toBe(3);
  });

  it('keeps later clips in place — the split subdivides the span, nothing shifts', () => {
    const a = makeClip({ id: 'a', duration: 4, startTime: 0 });
    const b = makeClip({ id: 'b', duration: 4, startTime: 4 });
    const result = splitClipsAtPlayhead([a, b], 1, 'a2')!;

    // Left (0..1) + right (1..4) occupy exactly a's old span, so b stays at 4.
    const untouched = result.find(c => c.id === 'b')!;
    expect(untouched.startTime).toBe(4);

    // Re-chaining the result reproduces the same layout — the chain is sound.
    expect(chainClips(result).map(c => c.startTime)).toEqual(result.map(c => c.startTime));
  });

  it('leaves clips on other tracks untouched', () => {
    const a = makeClip({ id: 'a', duration: 6, startTime: 0, track: 0 });
    const overlay = makeClip({ id: 'o', duration: 6, startTime: 2, track: 1 });
    // t=1 is strictly inside a and before the overlay starts, so a is active.
    const result = splitClipsAtPlayhead([a, overlay], 1, 'a2')!;

    expect(result.find(c => c.id === 'o')!.startTime).toBe(2);
    expect(result.map(c => c.id)).toEqual(['a', 'a2', 'o']);
  });

  it('returns null and leaves the array untouched when nothing spans the playhead', () => {
    const a = makeClip({ id: 'a', duration: 5, startTime: 0 });
    expect(splitClipsAtPlayhead([a], 7, 'a2')).toBeNull();
    expect(splitClipsAtPlayhead([], 0, 'x')).toBeNull();
  });

  it('returns null when the playhead sits exactly on a clip start', () => {
    const a = makeClip({ id: 'a', duration: 5, startTime: 2 });
    expect(splitClipsAtPlayhead([a], 2, 'a2')).toBeNull();
  });

  it('splits the latest-starting clip when two cover the playhead', () => {
    const bottom = makeClip({ id: 'bottom', duration: 10, startTime: 0, track: 0 });
    const top = makeClip({ id: 'top', duration: 10, startTime: 3, track: 1 });
    const result = splitClipsAtPlayhead([bottom, top], 5, 'top2')!;

    expect(result.map(c => c.id)).toEqual(['bottom', 'top', 'top2']);
    expect(result.find(c => c.id === 'top2')!.track).toBe(1);
    // The other clip keeps its position — its span is untouched.
    expect(result.find(c => c.id === 'bottom')!.startTime).toBe(0);
  });

  it('does not mutate the input array', () => {
    const a = makeClip({ id: 'a', duration: 6, startTime: 0 });
    const before = a.startTime;
    splitClipsAtPlayhead([a], 3, 'a2');
    expect(a.startTime).toBe(before);
    expect(a.trimmedDuration).toBeUndefined();
  });
});
