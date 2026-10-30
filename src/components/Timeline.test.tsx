// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Timeline } from './Timeline';
import type { VideoClip } from '../types';

vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ on: () => {}, destroy: () => {} }) },
}));

function makeClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'clip-1',
    file: new File(['bytes'], 'speech-a.webm', { type: 'video/webm' }),
    url: 'blob:clip-1',
    duration: 4,
    startTime: 0,
    name: 'Speech A',
    ...overrides,
  };
}

function renderTimeline(clips: VideoClip[]) {
  return render(
    <Timeline
      voiceover={null}
      videoClips={clips}
      onVideoClipChange={() => {}}
      onAutoAlign={() => {}}
      isAligning={false}
      currentTime={0}
      onTimeUpdate={() => {}}
    />
  );
}

// Reduced-motion contract: trim handles fade in via transition-opacity, but
// users with prefers-reduced-motion: reduce must get the instant reveal
// (Tailwind's motion-reduce:transition-none) instead of the animated fade.
describe('Timeline trim handles reduced motion', () => {
  afterEach(() => {
    cleanup();
  });

  it('fades both trim handles in via transition-opacity', () => {
    const { container } = renderTimeline([makeClip()]);
    for (const side of ['left', 'right'] as const) {
      const handle = container.querySelector(`[data-trim-handle="${side}"]`);
      expect(handle).not.toBeNull();
      expect((handle as HTMLElement).className).toContain('transition-opacity');
    }
  });

  it('opts both trim handles out of transitions under reduced motion', () => {
    const { container } = renderTimeline([makeClip()]);
    for (const side of ['left', 'right'] as const) {
      const handle = container.querySelector(`[data-trim-handle="${side}"]`);
      expect(handle).not.toBeNull();
      expect((handle as HTMLElement).className).toContain('motion-reduce:transition-none');
    }
  });

  it('renders both trim handles as keyboard-operable sliders', () => {
    const { container } = renderTimeline([makeClip()]);
    for (const side of ['left', 'right'] as const) {
      const handle = container.querySelector(`[data-trim-handle="${side}"]`);
      expect(handle).not.toBeNull();
      expect(handle!.getAttribute('role')).toBe('slider');
      expect(handle!.getAttribute('tabindex')).toBe('0');
    }
  });
});
