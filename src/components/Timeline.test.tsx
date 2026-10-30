// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Timeline } from './Timeline';

function renderTimeline() {
  return render(
    <Timeline
      voiceover={null}
      videoClips={[]}
      onVideoClipChange={vi.fn()}
      onAutoAlign={vi.fn()}
      isAligning={false}
      currentTime={0}
      onTimeUpdate={vi.fn()}
    />
  );
}

/** The ruler is the first aria-hidden div inside the Timeline tree; read its `{i}s` labels. */
function rulerLabels(container: HTMLElement): string[] {
  const ruler = container.querySelector('div[aria-hidden="true"]');
  if (!ruler) throw new Error('ruler not rendered');
  return within(ruler as HTMLElement).getAllByText(/^\d+s$/).map(el => el.textContent ?? '');
}

describe('Timeline ruler', () => {
  afterEach(cleanup);

  it('labels every second at the default zoom', () => {
    const { container } = renderTimeline();
    // Empty timeline spans 10s + 5s headroom → ticks 0..14
    expect(rulerLabels(container)).toEqual(['0s', '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s']);
  });

  it('thins labels out when zoomed all the way out so they never collide', () => {
    const { container } = renderTimeline();
    const zoomOut = screen.getByRole('button', { name: 'Zoom out timeline' });
    for (let i = 0; i < 5; i++) fireEvent.click(zoomOut); // 50px/s → MIN_PPS (10px/s)
    expect(rulerLabels(container)).toEqual(['0s', '5s', '10s']);
  });
});
