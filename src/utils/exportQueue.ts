/**
 * Batch export queue state machine.
 *
 * Pure data in, pure data out — the useExportQueue hook owns side effects
 * (driving MediaRecorder renders) and mirrors these transitions into React
 * state. Transitions that end the active render return the next items array
 * plus the queued item they promoted to `rendering` (if any), so the hook
 * knows when to launch the next render.
 */

import type { ExportPreset, ExportPresetId } from './exportPresets';

export type ExportQueueItemStatus = 'queued' | 'rendering' | 'done' | 'cancelled' | 'failed';

export interface ExportQueueItem {
  id: number;
  presetId: ExportPresetId;
  status: ExportQueueItemStatus;
  /** 0..1 render progress; only meaningful while `rendering`. */
  progress: number;
  /** Set when the status is `failed`. */
  error?: string;
}

export interface QueueTransition {
  items: ExportQueueItem[];
  /** The item this transition promoted to `rendering`, if any. */
  started: ExportQueueItem | null;
}

export interface RenderOutcome {
  cancelled: boolean;
}

/** One unit of export work: a running preset render that can be cancelled. */
export interface RenderHandle {
  /** Resolves when the render finishes naturally or is cancelled; rejects when setup fails. */
  promise: Promise<RenderOutcome>;
  cancel: () => void;
}

export type StartRenderFn = (preset: ExportPreset, onProgress: (progress: number) => void) => RenderHandle;

const TERMINAL_STATUSES: ExportQueueItemStatus[] = ['done', 'cancelled', 'failed'];

export function getRenderingItem(items: ExportQueueItem[]): ExportQueueItem | null {
  return items.find(item => item.status === 'rendering') ?? null;
}

/** True when a preset with this id is queued or rendering — the UI blocks duplicate tiles. */
export function isPresetPending(items: ExportQueueItem[], presetId: ExportPresetId): boolean {
  return items.some(
    item => item.presetId === presetId && (item.status === 'queued' || item.status === 'rendering')
  );
}

/** Append a queued render request. Duplicates of a pending preset are allowed — the UI dedupes. */
export function enqueueItem(
  items: ExportQueueItem[],
  presetId: ExportPresetId
): { items: ExportQueueItem[]; item: ExportQueueItem } {
  const id = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  const item: ExportQueueItem = { id, presetId, status: 'queued', progress: 0 };
  return { items: [...items, item], item };
}

/** Promote the first queued item to `rendering`; no-op while another render is active. */
export function startNext(items: ExportQueueItem[]): QueueTransition {
  if (getRenderingItem(items)) return { items, started: null };
  const next = items.find(item => item.status === 'queued');
  if (!next) return { items, started: null };
  const started: ExportQueueItem = { ...next, status: 'rendering' };
  return { items: items.map(item => (item.id === next.id ? started : item)), started };
}

/**
 * Mark the active render finished (`done` / `cancelled` / `failed`) and promote
 * the next queued item so the queue keeps draining. No-op unless `id` is the
 * rendering item — this guard makes late resolutions after cancel-all harmless.
 */
function finishAndPromote(
  items: ExportQueueItem[],
  id: number,
  patch: Partial<ExportQueueItem>
): QueueTransition {
  const rendering = getRenderingItem(items);
  if (!rendering || rendering.id !== id) return { items, started: null };
  const updated = items.map(item => (item.id === id ? { ...item, ...patch } : item));
  return startNext(updated);
}

/** Mark the rendering item done (progress 1) and promote the next queued item. */
export function completeCurrent(items: ExportQueueItem[], id: number): QueueTransition {
  return finishAndPromote(items, id, { status: 'done', progress: 1 });
}

/** Cancel the rendering item and promote the next queued item — the queue keeps draining. */
export function cancelCurrent(items: ExportQueueItem[], id: number): QueueTransition {
  return finishAndPromote(items, id, { status: 'cancelled' });
}

/** Mark the rendering item failed with a surfaced error and promote the next queued item. */
export function failCurrent(items: ExportQueueItem[], id: number, error?: string): QueueTransition {
  return finishAndPromote(items, id, { status: 'failed', error });
}

/** Cancel the active render and every queued item; terminal items keep their status. */
export function cancelAllItems(items: ExportQueueItem[]): ExportQueueItem[] {
  return items.map(item =>
    item.status === 'queued' || item.status === 'rendering' ? { ...item, status: 'cancelled' } : item
  );
}

/** Remove a queued (not yet started) item; no-op for anything else. */
export function removeQueueItem(items: ExportQueueItem[], id: number): ExportQueueItem[] {
  const item = items.find(candidate => candidate.id === id);
  if (!item || item.status !== 'queued') return items;
  return items.filter(candidate => candidate.id !== id);
}

/** Update the rendering item's progress, clamped to 0..1; no-op for other items. */
export function setItemProgress(items: ExportQueueItem[], id: number, progress: number): ExportQueueItem[] {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return items.map(item => (item.id === id && item.status === 'rendering' ? { ...item, progress: clamped } : item));
}

/** Drop every terminal item; queued/rendering items are untouched. */
export function clearFinishedItems(items: ExportQueueItem[]): ExportQueueItem[] {
  return items.filter(item => !TERMINAL_STATUSES.includes(item.status));
}
