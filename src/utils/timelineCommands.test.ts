import { describe, it, expect, vi, afterEach } from 'vitest';
import { CommandStack } from './commandStack';
import type { EvictionReason } from './commandStack';
import {
  addClipsCommand,
  clipsEqual,
  deleteClipsCommand,
  releaseCommand,
  snapshotCommand,
  swapClipsById,
} from './timelineCommands';
import type { TimelineEditCommand } from './timelineCommands';
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

function makeStack(maxHistory = 50) {
  const evicted: Array<[TimelineEditCommand, EvictionReason]> = [];
  const stack = new CommandStack<VideoClip[]>(maxHistory, (command, reason) => {
    evicted.push([command as TimelineEditCommand, reason]);
  });
  return { stack, evicted };
}

const s0 = [
  makeClip({ id: 'a', duration: 5, startTime: 0 }),
  makeClip({ id: 'b', duration: 3, startTime: 5 }),
  makeClip({ id: 'c', duration: 2, startTime: 8 }),
];

describe('snapshotCommand (move / trim / transition / reorder gestures)', () => {
  it('op -> undo -> redo restores exact state equality', () => {
    const before = s0.map(c => ({ ...c }));
    // A "move" gesture: clip b dragged onto track 1 at a new start time.
    const after = before.map(c =>
      c.id === 'b' ? { ...c, startTime: 2.5, track: 1 } : c,
    );
    const command = snapshotCommand('move', 'Move clip', before, after);
    const { stack } = makeStack();

    const s1 = stack.execute(command, before);
    expect(s1).toEqual(after);

    const s2 = stack.undo(s1);
    expect(s2).toEqual(before);
    expect(s2).toEqual(s0);

    const s3 = stack.redo(s2!);
    expect(s3).toEqual(after);
    expect(s3).toEqual(s1);
  });

  it('restores overlap-trimmed neighbours exactly on undo', () => {
    // resolveOverlaps truncates OTHER clips when a drag collides — the snapshot
    // must restore them, not just the dragged clip.
    const before = [
      makeClip({ id: 'a', duration: 10, startTime: 0 }),
      makeClip({ id: 'b', duration: 10, startTime: 1 }),
    ];
    const after = [
      { ...before[0], trimmedDuration: 1 },
      { ...before[1], track: 2 },
    ];
    const command = snapshotCommand('move', 'Move clip', before, after);
    const { stack } = makeStack();

    const s1 = stack.execute(command, before);
    expect(s1[0].trimmedDuration).toBe(1);

    const s2 = stack.undo(s1)!;
    expect(s2).toEqual(before);
    expect(s2[0].trimmedDuration).toBeUndefined();

    expect(stack.redo(s2)).toEqual(after);
  });

  it('round-trips a trim and a transition change through undo/redo', () => {
    const { stack } = makeStack();
    const afterTrim = s0.map(c => (c.id === 'a' ? { ...c, trimStart: 1, startTime: 1, trimmedDuration: 4 } : c));
    const afterTransition = afterTrim.map(c => (c.id === 'c' ? { ...c, transitionIn: 'fade' as const } : c));
    const trim = snapshotCommand('trim', 'Trim clip', s0, afterTrim);
    const transition = snapshotCommand('transition', 'Change transition', afterTrim, afterTransition);

    const s1 = stack.execute(trim, s0);
    const s2 = stack.execute(transition, s1);
    expect(s2).toEqual(afterTransition);
    expect(stack.undo(s2)).toEqual(s1);
    expect(stack.undo(s1)).toEqual(s0);
    expect(stack.redo(s0)).toEqual(s1);
    expect(stack.redo(s1)).toEqual(s2);
  });
});

describe('addClipsCommand', () => {
  it('op -> undo -> redo restores exact state equality', () => {
    const newClips = [makeClip({ id: 'd', duration: 4 })];
    const command = addClipsCommand(newClips);
    const { stack } = makeStack();

    const s1 = stack.execute(command, s0);
    expect(s1.map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);

    const s2 = stack.undo(s1)!;
    expect(s2).toEqual(s0);

    const s3 = stack.redo(s2);
    expect(s3).toEqual(s1);
  });

  it('undo removes only the added clips and keeps unrelated clips untouched', () => {
    const newClips = [makeClip({ id: 'd' }), makeClip({ id: 'e' })];
    const command = addClipsCommand(newClips);
    const { stack } = makeStack();

    const s1 = stack.execute(command, s0);
    const s2 = stack.undo(s1)!;
    expect(s2).toEqual(s0);
    expect(s2.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('deleteClipsCommand', () => {
  it('op -> undo -> redo restores exact state equality, including position', () => {
    const command = deleteClipsCommand(s0, [s0[1].id]);
    const { stack } = makeStack();

    const s1 = stack.execute(command, s0);
    expect(s1.map(c => c.id)).toEqual(['a', 'c']);

    const s2 = stack.undo(s1)!;
    expect(s2).toEqual(s0);
    expect(s2[1]).toBe(s0[1]); // same object, not a copy

    expect(stack.redo(s2)).toEqual(s1);
  });

  it('deletes multiple selected clips as one undo step, in any position', () => {
    const command = deleteClipsCommand(s0, ['a', 'c']);
    const { stack } = makeStack();

    const s1 = stack.execute(command, s0);
    expect(s1.map(c => c.id)).toEqual(['b']);

    const s2 = stack.undo(s1)!;
    expect(s2).toEqual(s0);
    expect(stack.redo(s2)).toEqual(s1);
  });

  it('is a no-op command when none of the ids exist', () => {
    const command = deleteClipsCommand(s0, ['missing']);
    const { stack } = makeStack();

    expect(stack.execute(command, s0)).toEqual(s0);
    expect(stack.undo(stack.execute(command, s0))).toEqual(s0);
  });
});

describe('swapClipsById (reorder via alternatives popover)', () => {
  it('swaps positions, rechains startTimes, and each position keeps its alternatives', () => {
    const a = makeClip({ id: 'a', startTime: 0, alternatives: [{ id: 'x', confidence: 0.9, reason: 'r' }] });
    const b = makeClip({ id: 'b', startTime: 5, alternatives: [{ id: 'y', confidence: 0.8, reason: 'q' }] });
    const swapped = swapClipsById([a, b], 'a', 'b')!;

    expect(swapped.map(c => c.id)).toEqual(['b', 'a']);
    expect(swapped.map(c => c.startTime)).toEqual([0, 10]); // rechained from durations
    expect(swapped[0].alternatives).toEqual(a.alternatives); // position 1 keeps its alternatives
    expect(swapped[1].alternatives).toEqual(b.alternatives);
  });

  it('returns null when either id is missing', () => {
    expect(swapClipsById(s0, 'a', 'nope')).toBeNull();
    expect(swapClipsById(s0, 'nope', 'b')).toBeNull();
  });

  it('swap -> undo -> redo restores exact state equality', () => {
    const a = makeClip({ id: 'a', startTime: 0, alternatives: [{ id: 'x', confidence: 1, reason: 'r' }] });
    const b = makeClip({ id: 'b', startTime: 10, alternatives: [] });
    const before = [a, b];
    const swapped = swapClipsById(before, 'a', 'b')!;
    const command = snapshotCommand('reorder', 'Swap clips', before, swapped);
    const { stack } = makeStack();

    const s1 = stack.execute(command, before);
    expect(s1.map(c => c.id)).toEqual(['b', 'a']);

    const s2 = stack.undo(s1)!;
    expect(s2).toEqual(before);

    expect(stack.redo(s2)).toEqual(s1);
  });
});

describe('split (right half mints a new blob URL)', () => {
  // Mirrors splitClipsAtPlayhead: the left half keeps the original clip id but
  // is truncated, the right half gets a fresh id and a freshly minted blob URL.
  const before = [makeClip({ id: 'a', duration: 6, startTime: 0 })];
  const after = [
    makeClip({ id: 'a', duration: 2.5, startTime: 0 }),
    makeClip({ id: 'a-right', url: 'blob:a-right-minted', duration: 3.5, startTime: 2.5 }),
  ];

  it('op -> undo -> redo restores exact state equality', () => {
    const command = snapshotCommand('split', 'Split clip', before, after);
    const { stack } = makeStack();

    const s1 = stack.execute(command, before);
    expect(s1).toEqual(after);

    const s2 = stack.undo(s1);
    expect(s2).toEqual(before);

    const s3 = stack.redo(s2!);
    expect(s3).toEqual(after);
    expect(s3).toEqual(s1);
  });

  it('pins the minted right-half URL so the release policy can revoke it', () => {
    const command = snapshotCommand('split', 'Split clip', before, after);
    expect(command.pinnedUrls).toEqual(['blob:a-right-minted']);
  });
});

describe('clipsEqual', () => {
  it('is true for identical references in the same order', () => {
    expect(clipsEqual(s0, [...s0])).toBe(true);
  });

  it('is false for reordered, changed, or different-length arrays', () => {
    expect(clipsEqual(s0, [s0[1], s0[0], s0[2]])).toBe(false);
    expect(clipsEqual(s0, [...s0.slice(0, 2), { ...s0[2], name: 'changed' }])).toBe(false);
    expect(clipsEqual(s0, s0.slice(0, 2))).toBe(false);
  });
});

describe('releaseCommand blob policy', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  afterEach(() => revoke.mockClear());

  it('revokes a delete only once it can never be undone again', () => {
    const command = deleteClipsCommand(s0, [s0[0].id]);
    releaseCommand(command, 'superseded');
    expect(revoke).not.toHaveBeenCalled(); // undone delete — clip is live again

    releaseCommand(command, 'overflow');
    expect(revoke).toHaveBeenCalledWith(s0[0].url);

    releaseCommand(command, 'cleared');
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('revokes an add only when the undone add is discarded or history clears', () => {
    const command = addClipsCommand([makeClip({ id: 'n1' }), makeClip({ id: 'n2' })]);
    releaseCommand(command, 'overflow');
    expect(revoke).not.toHaveBeenCalled(); // clips are still in the state

    releaseCommand(command, 'superseded');
    expect(revoke).toHaveBeenCalledTimes(2);

    releaseCommand(command, 'cleared');
    expect(revoke).toHaveBeenCalledTimes(4);
  });

  it('revokes a split like an add — the undone right half is gone from state', () => {
    const before = [makeClip({ id: 'a', duration: 6, startTime: 0 })];
    const right = makeClip({ id: 'a-right', url: 'blob:a-right-minted', duration: 3.5, startTime: 2.5 });
    const command = snapshotCommand('split', 'Split clip', before, [...before, right]);
    releaseCommand(command, 'overflow');
    expect(revoke).not.toHaveBeenCalled(); // right half is still live in the state

    releaseCommand(command, 'superseded');
    expect(revoke).toHaveBeenCalledWith('blob:a-right-minted');

    releaseCommand(command, 'cleared');
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('never revokes non-blob URLs', () => {
    const remote = makeClip({ id: 'x', url: 'https://example.com/v.mp4' });
    const command = deleteClipsCommand([remote], ['x']);
    releaseCommand(command, 'overflow');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('ignores gesture snapshots — they pin no blob URLs', () => {
    const command = snapshotCommand('move', 'Move clip', s0, s0);
    releaseCommand(command, 'overflow');
    releaseCommand(command, 'superseded');
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('full gesture pipeline through the stack', () => {
  it('move -> add -> delete -> undo x3 lands back on the original state', () => {
    const { stack } = makeStack();
    const moved = s0.map(c => (c.id === 'a' ? { ...c, startTime: 3, track: 1 } : c));
    const added = [...stack.execute(snapshotCommand('move', 'Move clip', s0, moved), s0)];
    const withNew = [...stack.execute(addClipsCommand([makeClip({ id: 'n' })]), added)];
    const removedClip = withNew[0];
    const removed = stack.execute(deleteClipsCommand(withNew, [removedClip.id]), withNew);

    expect(removed.map(c => c.id)).toEqual(['b', 'c', 'n']);
    expect(stack.undo(removed)).toEqual(withNew);
    expect(stack.undo(withNew)).toEqual(added);
    expect(stack.undo(added)).toEqual(s0);
    expect(stack.canUndo).toBe(false);
  });
});
