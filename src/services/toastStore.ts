// Lightweight observable toast queue, modeled on the logger store:
// module-level state, subscribe() for React views, notify() on mutation.

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  durationMs: number; // time until auto-expiry
}

export const DEFAULT_TOAST_DURATION_MS = 5000;

// Visible-stack cap: a burst of failures (e.g. several AI calls failing
// together) must not pile up unbounded — the oldest toast is evicted first.
export const MAX_VISIBLE_TOASTS = 3;

type Listener = (toasts: Toast[]) => void;

const toasts: Toast[] = [];
const listeners = new Set<Listener>();
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let nextId = 0;

function notify() {
  listeners.forEach(l => l([...toasts]));
}

function findVisible(kind: ToastKind, message: string): Toast | undefined {
  return toasts.find(t => t.kind === kind && t.message === message);
}

function armExpiry(toast: Toast) {
  expiryTimers.set(toast.id, setTimeout(() => dismissToast(toast.id), toast.durationMs));
}

function cancelExpiry(id: string) {
  const timer = expiryTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    expiryTimers.delete(id);
  }
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  cb([...toasts]);
  return () => { listeners.delete(cb); };
}

export function pushToast(kind: ToastKind, message: string, durationMs: number = DEFAULT_TOAST_DURATION_MS): Toast {
  const existing = findVisible(kind, message);
  if (existing) {
    // Dedupe: keep one instance and restart its expiry so a repeated
    // failure (e.g. retrying a broken generation) stays visible.
    cancelExpiry(existing.id);
    armExpiry(existing);
    return existing;
  }
  const toast: Toast = { id: `toast-${++nextId}`, kind, message, durationMs };
  toasts.unshift(toast); // newest first, matching the log panel's ordering
  armExpiry(toast);
  // Enforce the visible-stack cap by evicting the oldest toast (end of the
  // newest-first array) — its expiry timer is cancelled so it cannot notify.
  while (toasts.length > MAX_VISIBLE_TOASTS) {
    const oldest = toasts.pop();
    if (oldest) cancelExpiry(oldest.id);
  }
  notify();
  return toast;
}

export function dismissToast(id: string): void {
  const idx = toasts.findIndex(t => t.id === id);
  if (idx === -1) return;
  cancelExpiry(id);
  toasts.splice(idx, 1);
  notify();
}

export function clearToasts(): void {
  expiryTimers.forEach(timer => clearTimeout(timer));
  expiryTimers.clear();
  if (toasts.length === 0) return;
  toasts.length = 0;
  notify();
}

export const toast = {
  success: (message: string, durationMs?: number) => pushToast('success', message, durationMs),
  error: (message: string, durationMs?: number) => pushToast('error', message, durationMs),
  info: (message: string, durationMs?: number) => pushToast('info', message, durationMs),
};
