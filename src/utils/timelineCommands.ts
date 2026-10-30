import type { VideoClip } from '../types';
import { chainClips, rippleDeleteMany } from './chainClips';
import type { EditCommand, EvictionReason } from './commandStack';

export type TimelineOpKind = 'move' | 'trim' | 'reorder' | 'transition' | 'delete' | 'add' | 'split';

export interface TimelineEditCommand extends EditCommand<VideoClip[]> {
  readonly kind: TimelineOpKind;
  /** Blob URLs this command pins; the release policy revokes them on eviction. */
  readonly pinnedUrls: string[];
}

// Clip objects are treated as immutable values: any change produces a new
// object, so per-index reference equality means the two layouts are identical.
export function clipsEqual(a: VideoClip[], b: VideoClip[]): boolean {
  return a.length === b.length && a.every((clip, i) => clip === b[i]);
}

// One command per editing gesture (drag move/trim, discrete trim, transition
// change, alternatives swap). The gesture's full before/after arrays are the
// command: undo and redo restore those exact layouts, which makes
// op -> undo -> redo state equality hold by construction even though a single
// drag can touch several clips (overlap resolution truncates neighbours).
export function snapshotCommand(
  kind: TimelineOpKind,
  label: string,
  before: VideoClip[],
  after: VideoClip[],
): TimelineEditCommand {
  // Ops that mint new clips (split creates a right half with its own blob
  // URL) pin those URLs by the general rule below; move/trim/transition
  // mutate existing clips in place, so nothing new is pinned.
  const beforeUrls = new Set(before.map(c => c.url));
  const pinnedUrls = after.filter(c => !beforeUrls.has(c.url)).map(c => c.url);
  return { kind, label, pinnedUrls, apply: () => after, undo: () => before };
}

export function addClipsCommand(newClips: VideoClip[]): TimelineEditCommand {
  const newIds = new Set(newClips.map(c => c.id));
  return {
    kind: 'add',
    label: 'Add clips',
    pinnedUrls: newClips.map(c => c.url),
    apply: clips => [...clips, ...newClips],
    undo: clips => clips.filter(c => !newIds.has(c.id)),
  };
}

// Bulk delete (single or multi-select): snapshot-based — undo restores the
// exact pre-delete array, so no reinsertion-index math is needed. Remaining
// clips are ripple-rechained so the delete leaves no gap. The removed clips'
// blob URLs stay pinned until the delete can no longer be undone.
export function deleteClipsCommand(before: VideoClip[], ids: string[]): TimelineEditCommand {
  const removed = new Set(ids);
  const after = rippleDeleteMany(before, [...removed]);
  const pinnedUrls = before.filter(c => removed.has(c.id)).map(c => c.url);
  return {
    kind: 'delete',
    label: ids.length > 1 ? 'Delete clips' : 'Delete clip',
    pinnedUrls,
    apply: () => after,
    undo: () => before,
  };
}

// Swap two clips' timeline positions. Alternatives belong to the AI-suggested
// POSITION, not the clip, so each position keeps its own alternatives.
export function swapClipsById(clips: VideoClip[], clipId: string, altId: string): VideoClip[] | null {
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
  const idxA = sorted.findIndex(c => c.id === clipId);
  const idxB = sorted.findIndex(c => c.id === altId);
  if (idxA === -1 || idxB === -1) return null;
  const a = sorted[idxA];
  const b = sorted[idxB];
  sorted[idxA] = { ...b, alternatives: a.alternatives };
  sorted[idxB] = { ...a, alternatives: b.alternatives };
  return chainClips(sorted);
}

// Blob URLs must outlive their command: a delete keeps the URL alive so undo
// can restore the clip with a working player, and only revokes once the delete
// can no longer be undone (overflow / cleared). A delete discarded from the
// redo branch was already undone — its clip is live again and keeps its URL.
// Adds and splits are the mirror image: their new clips leave the state when
// undone, so the URLs are orphaned only when the op is discarded from the redo
// branch (superseded) or history is cleared.
export function releaseCommand(command: TimelineEditCommand, reason: EvictionReason): void {
  const revokes =
    command.kind === 'add' || command.kind === 'split'
      ? reason === 'superseded' || reason === 'cleared'
      : reason === 'overflow' || reason === 'cleared';
  if (!revokes) return;
  for (const url of command.pinnedUrls) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
