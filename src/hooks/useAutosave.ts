import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export const DEFAULT_AUTOSAVE_IDLE_MS = 2000;

interface UseAutosaveOptions<T> {
  /** Editor state to persist; every change re-arms the idle window. */
  data: T;
  /** Persists one snapshot. Reject to surface a save failure. */
  save: (data: T) => Promise<void>;
  /** Idle window the project must stay unchanged before a save fires. */
  idleWindowMs?: number;
  /** False freezes the hook at idle (empty editor — nothing worth saving). */
  enabled?: boolean;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  /** Epoch ms of the last completed save, null until one succeeds. */
  lastSavedAt: number | null;
  /** Failure message from the most recent rejected save, else null. */
  error: string | null;
  /** Save immediately — backs the header's retry affordance. */
  saveNow: () => void;
}

/**
 * Debounced autosave: a data change re-arms an idle timer; the save fires
 * only once the project stays unchanged for the full window. The initial
 * data is treated as the saved baseline, so mounting never triggers a save.
 *
 * Dirty/saved are derived during render (serialized data vs. the last
 * persisted payload) rather than mirrored into state — only the genuinely
 * async facts (`saving`, `error`) are state.
 */
export function useAutosave<T>({
  data,
  save,
  idleWindowMs = DEFAULT_AUTOSAVE_IDLE_MS,
  enabled = true,
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serialized = useMemo(() => JSON.stringify(data), [data]);

  // Snapshot of the payload the last completed save actually persisted;
  // starts at the initial data so mounting never triggers a save. State,
  // not a ref — the render derives dirty/saved from it.
  const [savedSnapshot, setSavedSnapshot] = useState(serialized);

  // Latest data/save via refs so a firing timer persists the newest state
  // and a changed `save` identity never re-arms the effect.
  const dataRef = useRef(data);
  const saveRef = useRef(save);
  useEffect(() => {
    dataRef.current = data;
    saveRef.current = save;
  }, [data, save]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const payload = dataRef.current;
    setIsSaving(true);
    setError(null);
    try {
      await saveRef.current(payload);
      // Mark exactly what was persisted, not whatever data is current by now.
      setSavedSnapshot(JSON.stringify(payload));
      setLastSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }, []);

  const saveNow = useCallback(() => {
    void persist();
  }, [persist]);

  useEffect(() => {
    if (!enabled || serialized === savedSnapshot) return;
    const handle = setTimeout(() => {
      void persist();
    }, idleWindowMs);
    timerRef.current = handle;
    return () => {
      clearTimeout(handle);
      if (timerRef.current === handle) timerRef.current = null;
    };
  }, [serialized, savedSnapshot, enabled, idleWindowMs, persist]);

  // A failure stays visible even when the editor goes empty — a save did
  // fail, and hiding that would swallow it.
  const isDirty = enabled && serialized !== savedSnapshot;
  const status: AutosaveStatus = isSaving
    ? 'saving'
    : error !== null
      ? 'error'
      : isDirty
        ? 'dirty'
        : lastSavedAt !== null
          ? 'saved'
          : 'idle';

  return { status, lastSavedAt, error, saveNow };
}
