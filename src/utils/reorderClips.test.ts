import { describe, it, expect } from 'vitest';
import { reorderClips } from './reorderClips';
import type { VideoClip } from '../types';

function makeClip(partial: Partial<VideoClip> & { id: string }): VideoClip {
  return {
    file: undefined as unknown as File,
    url: '',
    duration: 10,
    startTime: 0,
    name: partial.id,
    ...partial,
  };
}

// a(0–5), b(5–8), c(8–10) — a chained back-to-back timeline.
const abc = () => [
  makeClip({ id: 'a', duration: 5, startTime: 0 }),
  makeClip({ id: 'b', duration: 3, startTime: 5 }),
  makeClip({ id: 'c', duration: 2, startTime: 8 }),
];

describe('reorderClips', () => {
  it('moves a middle clip to the front when dropped before the first neighbour centre and rechains', () => {
    const reordered = reorderClips(abc(), 'b', 0);
    expect(reordered.map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(reordered.map(c => c.startTime)).toEqual([0, 3, 8]);
  });

  it('moves the first clip to the end when dropped past the last neighbour centre and rechains', () => {
    const reordered = reorderClips(abc(), 'a', 9);
    expect(reordered.map(c => c.id)).toEqual(['b', 'c', 'a']);
    expect(reordered.map(c => c.startTime)).toEqual([0, 3, 5]);
  });

  it('inserts after a span when dropped past its centre and before the next centre', () => {
    // c dropped at t=3: past a's centre (2.5) but before b's centre (6.5)
    const reordered = reorderClips(abc(), 'c', 3);
    expect(reordered.map(c => c.id)).toEqual(['a', 'c', 'b']);
    expect(reordered.map(c => c.startTime)).toEqual([0, 5, 7]);
  });

  it('keeps the sequence unchanged when dropped in place', () => {
    const reordered = reorderClips(abc(), 'b', 5);
    expect(reordered.map(c => c.id)).toEqual(['a', 'b', 'c']);
    expect(reordered.map(c => c.startTime)).toEqual([0, 5, 8]);
  });

  it('chains by trimmedDuration ?? duration when rechaining', () => {
    const clips = [
      makeClip({ id: 'a', duration: 10, trimmedDuration: 4, startTime: 0 }),
      makeClip({ id: 'b', duration: 6, startTime: 4 }),
      makeClip({ id: 'c', duration: 1, startTime: 10 }),
    ];
    const reordered = reorderClips(clips, 'c', 0);
    expect(reordered.map(c => c.id)).toEqual(['c', 'a', 'b']);
    expect(reordered.map(c => c.startTime)).toEqual([0, 1, 5]);
  });

  it('closes gaps and snaps the timeline back-to-back after the drop', () => {
    const clips = [
      makeClip({ id: 'a', duration: 2, startTime: 0 }),
      makeClip({ id: 'b', duration: 3, startTime: 7 }), // gap 2→7
      makeClip({ id: 'c', duration: 1, startTime: 20 }), // gap 10→20
    ];
    const reordered = reorderClips(clips, 'a', 1); // dropped inside its own slot
    expect(reordered.map(c => c.id)).toEqual(['a', 'b', 'c']);
    expect(reordered.map(c => c.startTime)).toEqual([0, 2, 5]);
  });

  it('preserves the relative order of the other clips', () => {
    const reordered = reorderClips(abc(), 'a', 0); // a back at the front
    expect(reordered.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves the dragged clip’s track through the reorder', () => {
    const clips = [
      makeClip({ id: 'a', duration: 5, startTime: 0, track: 0 }),
      makeClip({ id: 'b', duration: 3, startTime: 5, track: 1 }),
    ];
    const reordered = reorderClips(clips, 'b', 0);
    expect(reordered.map(c => c.id)).toEqual(['b', 'a']);
    expect(reordered.find(c => c.id === 'b')?.track).toBe(1);
  });

  it('returns the input unchanged when the dragged id does not exist', () => {
    const clips = abc();
    expect(reorderClips(clips, 'missing', 4)).toBe(clips);
  });

  it('does not mutate the input clips', () => {
    const clips = abc();
    const snapshot = clips.map(c => ({ ...c }));
    reorderClips(clips, 'b', 0);
    expect(clips).toEqual(snapshot);
  });
});
