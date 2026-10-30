// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// WaveSurfer is only constructed when a voiceover exists (never in these
// tests), but the per-clip ClipWaveform still touches it — stub it out so the
// mount is deterministic in jsdom (no Web Audio there).
vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn(() => ({ on: vi.fn(), destroy: vi.fn() })),
  },
}));

import { Timeline } from './Timeline';
import type { VideoClip } from '../types';

function clip(id: string, startTime: number, duration: number): VideoClip {
  return {
    id,
    name: `${id}.mp4`,
    file: new File(['x'], `${id}.mp4`, { type: 'video/mp4' }),
    url: `blob:${id}`,
    duration,
    startTime,
  };
}

function renderTimeline(videoClips: VideoClip[]) {
  return render(
    <Timeline
      voiceover={null}
      videoClips={videoClips}
      onVideoClipChange={vi.fn()}
      onAutoAlign={vi.fn()}
      isAligning={false}
      currentTime={0}
      onTimeUpdate={vi.fn()}
    />,
  );

}

afterEach(cleanup);

describe('Timeline transition picker', () => {
  it('opens from a clip boundary and offers every transition type with an icon from the shared set', () => {
    // Two back-to-back clips on the default track — the boundary between them
    // is where the transition control renders.
    renderTimeline([clip('a', 0, 10), clip('b', 10, 5)]);

    fireEvent.click(screen.getByRole('button', { name: /Edit transition into next clip/ }));

    // Every transition type is offered; each option renders a lucide icon
    // (inline svg) matching the toolbar's icon set — not an emoji glyph.
    for (const label of ['Cut', 'Fade', 'Dissolve', 'Wipe']) {
      const option = screen.getByRole('button', { name: label });
      expect(option.querySelector('svg')).not.toBeNull();
    }
  });

  it('renders no emoji glyphs in the transition options', () => {
    renderTimeline([clip('a', 0, 10), clip('b', 10, 5)]);

    fireEvent.click(screen.getByRole('button', { name: /Edit transition into next clip/ }));

    for (const label of ['Cut', 'Fade', 'Dissolve', 'Wipe']) {
      // The icon is an svg (no text contribution), so the button text is the
      // label alone — any other visible glyph would show up here.
      expect(screen.getByRole('button', { name: label }).textContent).toBe(label);
    }
  });
});
