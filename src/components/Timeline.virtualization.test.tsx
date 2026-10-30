// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Timeline } from './Timeline';
import { VideoClip } from '../types';

const noop = () => {};

function makeClips(count: number, clipSeconds = 5): VideoClip[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `clip-${i}`,
    file: new File(['bytes'], `clip-${i}.mp4`, { type: 'video/mp4' }),
    url: `blob:clip-${i}`,
    duration: clipSeconds,
    startTime: i * clipSeconds,
    name: `Clip ${i}`,
  }));
}

function renderTimeline(clips: VideoClip[]) {
  return render(
    <Timeline
      voiceover={null}
      videoClips={clips}
      onVideoClipChange={noop}
      onAutoAlign={noop}
      isAligning={false}
      currentTime={0}
      onTimeUpdate={noop}
    />,
  );
}

// jsdom has no layout engine: clientWidth/scrollLeft are always 0, so the test
// injects them on the scroll container and fires the scroll event the same way
// a real browser would.
function setViewport(el: HTMLElement, clientWidth: number, scrollLeft: number) {
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true, writable: true });
  fireEvent.scroll(el);
}

function scrollArea(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-testid="timeline-scroll-area"]');
  if (!(el instanceof HTMLElement)) throw new Error('timeline scroll area not found');
  return el;
}

describe('Timeline windowed clip rendering', () => {
  afterEach(cleanup);

  it('mounts only the clips intersecting the initial viewport, not all of them', () => {
    const { container } = renderTimeline(makeClips(600));
    setViewport(scrollArea(container), 1200, 0);
    const mounted = container.querySelectorAll('[data-clip]').length;
    // 1200px @ 50px/s + 96px overscan spans ~25.9s; 5s clips → 6 in-window clips.
    expect(mounted).toBe(6);
    expect(mounted).toBeLessThan(600);
  });

  it('swaps the mounted set when the viewport scrolls to a distant range', () => {
    const { container } = renderTimeline(makeClips(600));
    const el = scrollArea(container);
    // 100044px = t 2000s: clips 399–405 straddle the 1200px window.
    setViewport(el, 1200, 100044);
    expect(container.querySelectorAll('[data-clip]').length).toBe(7);
    expect(screen.getByLabelText('Clip: Clip 402, 5.0 seconds')).toBeDefined();
    expect(screen.queryByLabelText(/Clip: Clip 0,/)).toBeNull();

    // Back to the start: early clips return, distant clips unmount.
    setViewport(el, 1200, 0);
    expect(screen.getByLabelText(/Clip: Clip 0,/)).toBeDefined();
    expect(screen.queryByLabelText(/Clip: Clip 402,/)).toBeNull();
  });

  it('keeps a clip mid-drag mounted even when the viewport leaves it behind', () => {
    const { container } = renderTimeline(makeClips(600));
    const el = scrollArea(container);
    setViewport(el, 1200, 100044);
    const dragged = screen.getByLabelText(/Clip: Clip 402,/);
    fireEvent.mouseDown(dragged);
    setViewport(el, 1200, 0);
    expect(screen.getByLabelText(/Clip: Clip 0,/)).toBeDefined();
    expect(screen.queryByLabelText(/Clip: Clip 402,/)).not.toBeNull();
  });

  it('renders only the ruler ticks inside the viewport', () => {
    const { container } = renderTimeline(makeClips(600));
    const el = scrollArea(container);
    setViewport(el, 1200, 0);
    // Pre-virtualization this ruler rendered ceil(3000)+5 = 3005 ticks.
    expect(screen.queryByText('3000s')).toBeNull();
    setViewport(el, 1200, 100044);
    expect(screen.getByText('2000s')).toBeDefined();
    expect(container.querySelectorAll('[aria-hidden="true"] .font-mono').length).toBeLessThan(40);
  });
});
