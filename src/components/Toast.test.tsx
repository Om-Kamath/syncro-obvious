// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { Toast, type ToastState } from './Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders the message with alert semantics', () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        toast={{ kind: 'error', message: 'Unsupported file type: "deck.pdf"' } satisfies ToastState}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByRole('alert').textContent).toContain('Unsupported file type');
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeDefined();
  });

  it('auto-dismisses after the toast timeout', () => {
    const onDismiss = vi.fn();
    render(
      <Toast toast={{ kind: 'success', message: 'Imported 2 videos' } satisfies ToastState} onDismiss={onDismiss} />
    );

    act(() => { vi.advanceTimersByTime(3999); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not restart the timer while only the parent re-renders', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Toast toast={{ kind: 'error', message: 'boom' } satisfies ToastState} onDismiss={onDismiss} />
    );

    // A re-render with the SAME toast must not reset the dismissal clock.
    rerender(
      <Toast toast={{ kind: 'error', message: 'boom' } satisfies ToastState} onDismiss={onDismiss} />
    );
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses immediately from the close button', () => {
    const onDismiss = vi.fn();
    render(<Toast toast={{ kind: 'error', message: 'boom' } satisfies ToastState} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there is no toast', () => {
    render(<Toast toast={null} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
