// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MediaListSkeleton } from './MediaListSkeleton';

describe('MediaListSkeleton', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders one pulsing placeholder row per pending media item', () => {
    const { container } = render(<MediaListSkeleton count={3} />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
    expect(container.querySelector('[role="status"]')).toBeDefined();
  });

  it('renders nothing when there are no pending media items', () => {
    const { container } = render(<MediaListSkeleton count={0} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });

  it('announces the loading state to assistive tech', () => {
    render(<MediaListSkeleton count={1} />);
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText(/loading media/i)).toBeDefined();
  });

  it('uses a custom status label when provided', () => {
    render(<MediaListSkeleton count={1} label="Loading videos…" />);
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText(/loading videos/i)).toBeDefined();
  });
});
