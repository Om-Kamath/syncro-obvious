// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MediaLibraryPanel } from './MediaLibraryPanel';
import type { MediaAsset } from '../types';

const asset = (id: string, name: string, duration: number): MediaAsset => ({
  id,
  file: new File([], name, { type: 'video/mp4' }),
  url: `blob:${id}`,
  duration,
  name,
});

describe('MediaLibraryPanel', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists each imported asset with duration and its used-in indicator', () => {
    render(
      <MediaLibraryPanel
        assets={[asset('a1', 'beach.mp4', 12.3), asset('a2', 'city.mp4', 4)]}
        usageCounts={{ a1: 2 }}
        onAddToTimeline={vi.fn()}
        onRemoveAsset={vi.fn()}
      />
    );
    expect(screen.getByText('Media Library')).toBeDefined();
    expect(screen.getByText('beach.mp4')).toBeDefined();
    expect(screen.getByText('12.3s')).toBeDefined();
    expect(screen.getByText('On timeline ×2')).toBeDefined();
    expect(screen.getByText('city.mp4')).toBeDefined();
    expect(screen.getByText('Not on timeline')).toBeDefined();
  });

  it('invokes onAddToTimeline with the asset id when its add action is used', () => {
    const onAddToTimeline = vi.fn();
    render(
      <MediaLibraryPanel
        assets={[asset('a1', 'beach.mp4', 5), asset('a2', 'city.mp4', 5)]}
        usageCounts={{}}
        onAddToTimeline={onAddToTimeline}
        onRemoveAsset={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add city.mp4 to timeline' }));
    expect(onAddToTimeline).toHaveBeenCalledTimes(1);
    expect(onAddToTimeline).toHaveBeenCalledWith('a2');
  });

  it('disables removing an asset that is still on the timeline', () => {
    const onRemoveAsset = vi.fn();
    render(
      <MediaLibraryPanel
        assets={[asset('a1', 'beach.mp4', 5), asset('a2', 'city.mp4', 5)]}
        usageCounts={{ a1: 1 }}
        onAddToTimeline={vi.fn()}
        onRemoveAsset={onRemoveAsset}
      />
    );
    const removeUsed = screen.getByRole('button', { name: 'Remove beach.mp4 from library' }) as HTMLButtonElement;
    expect(removeUsed.disabled).toBe(true);
    const removeFree = screen.getByRole('button', { name: 'Remove city.mp4 from library' }) as HTMLButtonElement;
    expect(removeFree.disabled).toBe(false);
    fireEvent.click(removeFree);
    expect(onRemoveAsset).toHaveBeenCalledWith('a2');
  });

  it('shows an empty state when no media has been imported', () => {
    render(
      <MediaLibraryPanel
        assets={[]}
        usageCounts={{}}
        onAddToTimeline={vi.fn()}
        onRemoveAsset={vi.fn()}
      />
    );
    expect(screen.getByText(/No imported media yet/)).toBeDefined();
  });
});
