import { useEffect, useRef, useState } from 'react';
import { EXPORT_PRESETS } from '../utils/exportPresets';
import {
  cancelAllItems,
  cancelCurrent,
  clearFinishedItems,
  completeCurrent,
  enqueueItem,
  failCurrent,
  removeQueueItem,
  setItemProgress,
  startNext,
  type ExportQueueItem,
  type QueueTransition,
  type RenderHandle,
  type StartRenderFn,
} from '../utils/exportQueue';

export interface ExportQueueApi {
  items: ExportQueueItem[];
  /** Append a preset to the queue; starts rendering immediately when the queue is idle. */
  enqueue: (presetId: ExportQueueItem['presetId']) => void;
  /** Stop the active render — its item is marked cancelled and the queue advances. */
  cancelActive: () => void;
  /** Stop the active render and cancel every queued item. */
  cancelAll: () => void;
  /** Remove a queued (not yet started) item. */
  removeItem: (id: number) => void;
  /** Drop terminal items once the queue is idle. */
  clearFinished: () => void;
}

/**
 * Sequencer for batch exports: runs queued preset renders one at a time.
 * The transitions live in the pure state machine (utils/exportQueue); this hook
 * launches the real render through `startRender`, feeds progress back into the
 * items, and chains to the next queued item when a render settles.
 */
export function useExportQueue(startRender: StartRenderFn): ExportQueueApi {
  const [items, setItems] = useState<ExportQueueItem[]>([]);
  const itemsRef = useRef<ExportQueueItem[]>([]);
  const runningIdRef = useRef<number | null>(null);
  const activeCancelRef = useRef<(() => void) | null>(null);
  const startRenderRef = useRef(startRender);
  useEffect(() => {
    // Keep the latest render factory outside the render path (react-hooks/refs).
    startRenderRef.current = startRender;
  });

  const commit = (next: ExportQueueItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  const launch = (item: ExportQueueItem) => {
    runningIdRef.current = item.id;
    let handle: RenderHandle;
    try {
      handle = startRenderRef.current(EXPORT_PRESETS[item.presetId], progress => {
        commit(setItemProgress(itemsRef.current, item.id, progress));
      });
    } catch (error) {
      // startRender failed before producing a handle — fail the item honestly and move on.
      runningIdRef.current = null;
      activeCancelRef.current = null;
      const message = error instanceof Error ? error.message : String(error);
      advance(failCurrent(itemsRef.current, item.id, message));
      return;
    }
    activeCancelRef.current = handle.cancel;
    void handle.promise.then(
      outcome => {
        if (runningIdRef.current !== item.id) return; // superseded by cancel-all/unmount
        runningIdRef.current = null;
        activeCancelRef.current = null;
        const transition = outcome.cancelled
          ? cancelCurrent(itemsRef.current, item.id)
          : completeCurrent(itemsRef.current, item.id);
        advance(transition);
      },
      (error: unknown) => {
        if (runningIdRef.current !== item.id) return;
        runningIdRef.current = null;
        activeCancelRef.current = null;
        const message = error instanceof Error ? error.message : String(error);
        advance(failCurrent(itemsRef.current, item.id, message));
      }
    );
  };

  const advance = (transition: QueueTransition) => {
    commit(transition.items);
    if (transition.started) launch(transition.started);
  };

  const enqueue = (presetId: ExportQueueItem['presetId']) => {
    const { items: withItem } = enqueueItem(itemsRef.current, presetId);
    if (runningIdRef.current !== null) {
      commit(withItem); // a render is active — the new item waits its turn
      return;
    }
    advance(startNext(withItem));
  };

  const cancelActive = () => {
    // The render settles as cancelled; the promise handler marks the item and advances.
    activeCancelRef.current?.();
  };

  const cancelAll = () => {
    runningIdRef.current = null;
    activeCancelRef.current?.();
    activeCancelRef.current = null;
    commit(cancelAllItems(itemsRef.current));
  };

  const removeItem = (id: number) => {
    commit(removeQueueItem(itemsRef.current, id));
  };

  const clearFinished = () => {
    commit(clearFinishedItems(itemsRef.current));
  };

  useEffect(
    () => () => {
      // The panel unmounted mid-render — stop the recorder so it doesn't keep running.
      activeCancelRef.current?.();
    },
    []
  );

  return { items, enqueue, cancelActive, cancelAll, removeItem, clearFinished };
}
