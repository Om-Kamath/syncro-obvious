// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ToastContainer } from './ToastContainer';
import { toast, clearToasts, DEFAULT_TOAST_DURATION_MS } from '../services/toastStore';

describe('ToastContainer', () => {
  afterEach(() => {
    cleanup();
    clearToasts();
    vi.useRealTimers();
  });

  it('renders nothing when the queue is empty', () => {
    render(<ToastContainer />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders pushed toasts; errors use alert semantics', () => {
    render(<ToastContainer />);
    act(() => {
      toast.error('Generation failed');
      toast.success('Voiceover audio generated');
    });
    expect(screen.getByRole('alert').textContent).toContain('Generation failed');
    expect(screen.getByRole('status').textContent).toContain('Voiceover audio generated');
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(2);
  });

  it('dismisses a toast from its dismiss button', () => {
    render(<ToastContainer />);
    act(() => {
      toast.info('Dismissible');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Dismissible')).toBeNull();
  });

  it('drops the toast when it auto-expires', () => {
    vi.useFakeTimers();
    render(<ToastContainer />);
    act(() => {
      toast.info('Temporary');
    });
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS);
    });
    expect(screen.queryByText('Temporary')).toBeNull();
  });
});
