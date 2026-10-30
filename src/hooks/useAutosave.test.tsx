// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutosave, DEFAULT_AUTOSAVE_IDLE_MS } from './useAutosave';

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderAutosave = (
    save: (data: { v: number }) => Promise<void>,
    initialProps?: Partial<Parameters<typeof useAutosave<{ v: number }>>[0]>,
  ) =>
    renderHook(
      ({ data, ...opts }: { data: { v: number } } & Partial<Parameters<typeof useAutosave<{ v: number }>>[0]>) =>
        useAutosave({ data, save, ...opts }),
      { initialProps: { data: { v: 1 }, ...initialProps } },
    );

  it('saves once after the project stays unchanged for the idle window', async () => {
    const save = vi.fn<(data: { v: number }) => Promise<void>>().mockResolvedValue(undefined);
    const { result, rerender } = renderAutosave(save, { idleWindowMs: 2000 });

    // Mount alone never saves — initial data is the saved baseline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');

    rerender({ data: { v: 2 } });
    expect(result.current.status).toBe('dirty');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_AUTOSAVE_IDLE_MS - 1);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ v: 2 });
    expect(result.current.status).toBe('saved');
    expect(result.current.lastSavedAt).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('re-arms the idle window on every change (debounce, not throttle)', async () => {
    const save = vi.fn<(data: { v: number }) => Promise<void>>().mockResolvedValue(undefined);
    const { result, rerender } = renderAutosave(save, { idleWindowMs: 2000 });

    rerender({ data: { v: 2 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    // A second change inside the window resets the countdown.
    rerender({ data: { v: 3 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('dirty');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ v: 3 });
    expect(result.current.status).toBe('saved');
  });

  it('surfaces a save failure and recovers via saveNow', async () => {
    const save = vi.fn<(data: { v: number }) => Promise<void>>()
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderAutosave(save, { idleWindowMs: 2000 });

    rerender({ data: { v: 2 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('quota exceeded');

    act(() => {
      result.current.saveNow();
    });
    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
    expect(result.current.error).toBeNull();
  });

  it('never saves while disabled', async () => {
    const save = vi.fn<(data: { v: number }) => Promise<void>>().mockResolvedValue(undefined);
    const { result, rerender } = renderAutosave(save, { enabled: false });

    rerender({ data: { v: 2 }, enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('stays dirty when the data changes during an in-flight save, then saves the newest state', async () => {
    const resolvers: Array<() => void> = [];
    const save = vi.fn<(data: { v: number }) => Promise<void>>().mockImplementation(
      () => new Promise<void>((resolve) => { resolvers.push(resolve); }),
    );
    const { result, rerender } = renderAutosave(save, { idleWindowMs: 2000 });

    rerender({ data: { v: 2 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.status).toBe('saving');

    // Edit lands while the first save is still in flight.
    rerender({ data: { v: 3 } });
    await act(async () => {
      resolvers[0]?.();
    });
    expect(result.current.status).toBe('dirty');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      resolvers[1]?.();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ v: 3 });
    expect(result.current.status).toBe('saved');
  });

  it('returns to idle when edits are reverted back to the saved state', async () => {
    const save = vi.fn<(data: { v: number }) => Promise<void>>().mockResolvedValue(undefined);
    const { result, rerender } = renderAutosave(save, { idleWindowMs: 2000 });

    rerender({ data: { v: 2 } });
    expect(result.current.status).toBe('dirty');
    rerender({ data: { v: 1 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});
