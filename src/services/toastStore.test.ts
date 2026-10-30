import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pushToast,
  dismissToast,
  clearToasts,
  subscribe,
  toast,
  DEFAULT_TOAST_DURATION_MS,
  MAX_VISIBLE_TOASTS,
  type Toast,
} from './toastStore';

describe('toastStore', () => {
  let snapshots: Toast[][] = [];
  let unsubscribe: (() => void) | undefined;

  // Stable handle for the newest snapshot; Array.at() is T | undefined.
  const last = (): Toast[] => snapshots.at(-1) ?? [];

  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
    snapshots = [];
    unsubscribe = subscribe(next => snapshots.push(next));
  });

  afterEach(() => {
    unsubscribe?.();
    clearToasts();
    vi.useRealTimers();
  });

  it('pushes a toast and notifies subscribers, newest first', () => {
    const pushed = pushToast('error', 'Generation failed');
    expect(pushed).toMatchObject({ kind: 'error', message: 'Generation failed', durationMs: DEFAULT_TOAST_DURATION_MS });
    expect(last()).toEqual([pushed]);
  });

  it('stacks multiple distinct toasts with the newest first', () => {
    const first = pushToast('info', 'First');
    const second = pushToast('success', 'Second');
    expect(last()).toEqual([second, first]);
  });

  it('auto-expires a toast after its duration', () => {
    pushToast('info', 'Temporary', 1000);
    expect(last()).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(last()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(last()).toHaveLength(0);
  });

  it('auto-expires with the default duration when none is given', () => {
    pushToast('success', 'Default timing');
    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS - 1);
    expect(last()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(last()).toHaveLength(0);
  });

  it('dedupes an identical kind+message push instead of stacking a copy', () => {
    const first = pushToast('error', 'Generation failed');
    const again = pushToast('error', 'Generation failed');

    expect(again.id).toBe(first.id);
    expect(last()).toEqual([first]);
    expect(last()).toHaveLength(1);
  });

  it('keeps toasts with the same message but different kinds separate', () => {
    const info = pushToast('info', 'Done');
    const error = pushToast('error', 'Done');
    expect(last()).toEqual([error, info]);
  });

  it('caps the visible stack at MAX_VISIBLE_TOASTS, dropping the oldest', () => {
    const first = pushToast('error', 'First failure');
    pushToast('error', 'Second failure');
    pushToast('error', 'Third failure');
    const fourth = pushToast('error', 'Fourth failure');

    expect(last()).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(last()).toEqual([fourth, expect.anything(), expect.anything()]);
    expect(last().map(t => t.id)).not.toContain(first.id);
  });

  it('cancels the evicted toast\u2019s expiry timer so only visible toasts hold timers', () => {
    pushToast('info', 'Evicted', 10_000);
    pushToast('info', 'Two', 10_000);
    pushToast('info', 'Three', 10_000);
    pushToast('info', 'Four', 10_000); // evicts 'Evicted'
    expect(last()).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(vi.getTimerCount()).toBe(MAX_VISIBLE_TOASTS); // no leaked timer for the evicted toast

    vi.advanceTimersByTime(10_000); // visible toasts expire normally…
    expect(last()).toHaveLength(0);
    vi.advanceTimersByTime(10_000); // …and the evicted toast never resurrects
    expect(last()).toHaveLength(0);
  });

  it('deduping a visible toast does not evict anything', () => {
    pushToast('info', 'One');
    pushToast('info', 'Two');
    pushToast('info', 'Three');
    pushToast('info', 'One'); // dedupe path — no new toast, no eviction

    expect(last()).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(last().map(t => t.message)).toEqual(['Three', 'Two', 'One']); // order unchanged by the dedupe re-push
  });

  it('restarts the expiry clock on a deduped re-push', () => {
    pushToast('error', 'Generation failed', 5000);
    vi.advanceTimersByTime(3000);

    pushToast('error', 'Generation failed', 5000); // dedupe, restarts the 5s clock
    vi.advanceTimersByTime(3000); // past the original expiry
    expect(last()).toHaveLength(1);

    vi.advanceTimersByTime(2000);
    expect(last()).toHaveLength(0);
  });

  it('dismisses a toast manually and cancels its expiry timer', () => {
    const pushed = pushToast('info', 'Dismissible', 1000);
    dismissToast(pushed.id);
    expect(last()).toHaveLength(0);

    vi.advanceTimersByTime(2000); // the cancelled timer must not resurrect it
    expect(last()).toHaveLength(0);
  });

  it('ignores dismissal of an unknown id without notifying', () => {
    const countBefore = snapshots.length;
    dismissToast('toast-404');
    expect(snapshots.length).toBe(countBefore);
  });

  it('clears the whole queue and cancels pending expiries', () => {
    pushToast('error', 'One', 10_000);
    pushToast('error', 'Two', 10_000);
    clearToasts();
    expect(last()).toEqual([]);

    vi.advanceTimersByTime(10_000); // cancelled timers must not notify again
    expect(last()).toEqual([]);
  });

  it('routes the kind helpers to the right toast kind', () => {
    toast.success('Saved');
    toast.error('Broken');
    toast.info('FYI');
    expect(last().map(t => t.kind)).toEqual(['info', 'error', 'success']);
  });
});
