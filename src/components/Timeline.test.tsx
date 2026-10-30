// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Timeline } from './Timeline';
import type { VideoClip } from '../types';

// Same proven WaveSurfer stub as ClipWaveform.test.tsx — the timeline mounts
// one waveform per clip, and jsdom cannot decode real audio.
const { FakeWaveSurfer, resetWaveSurfer } = vi.hoisted(() => {
  class FakeWaveSurfer {
    static instances: FakeWaveSurfer[] = [];
    options: Record<string, unknown>;
    listeners = new Map<string, Array<(arg?: unknown) => void>>();
    destroyed = false;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeWaveSurfer.instances.push(this);
    }
    on(event: string, callback: (arg?: unknown) => void): this {
      const existing = this.listeners.get(event) ?? [];
      existing.push(callback);
      this.listeners.set(event, existing);
      if (event === 'ready') callback();
      return this;
    }
    emit(event: string, arg?: unknown): void {
      for (const callback of this.listeners.get(event) ?? []) callback(arg);
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return {
    FakeWaveSurfer,
    resetWaveSurfer: (): void => {
      FakeWaveSurfer.instances.length = 0;
    },
  };
});

vi.mock('wavesurfer.js', () => ({
  default: { create: (options: Record<string, unknown>) => new FakeWaveSurfer(options) },
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

describe('Timeline trim handle target size', () => {
  beforeEach(() => {
    resetWaveSurfer();
  });
  afterEach(() => {
    cleanup();
  });

  it('keeps the visible strip small and carries a 24px invisible hit-area extension on both handles (WCAG 2.5.8)', () => {
    const { container } = renderTimeline([makeClip()]);

    for (const side of ['left', 'right'] as const) {
      const handle = container.querySelector(`[data-trim-handle="${side}"]`);
      expect(handle).not.toBeNull();
      const classes = (handle as HTMLElement).className;

      // The painted strip stays at its original 10px width — no visual bloat.
      expect(classes).toContain('w-2.5');

      // Invisible ::after pseudo-element stretches the interactive target to
      // 24px (10px strip + 14px inward extension) along the full handle height.
      // jsdom cannot compute Tailwind CSS lengths, so this guards the classes;
      // the real hit geometry is verified in the browser against the built app.
      expect(classes).toContain('after:absolute');
      expect(classes).toContain('after:inset-y-0');
      expect(classes).toContain("after:content-['']");
      // Anchored at the clip edge, extended 14px inward (0.875rem = 3.5 spacing units).
      expect(classes).toContain(side === 'left' ? 'after:left-0' : 'after:right-0');
      expect(classes).toContain(side === 'left' ? 'after:-right-3.5' : 'after:-left-3.5');
    }
  });
});
