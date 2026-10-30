// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { ClipWaveform } from './ClipWaveform';
import { Timeline } from './Timeline';
import type { VideoClip } from '../types';

const { FakeWaveSurfer, waveSurferInstances, resetWaveSurfer, setAutoReady } = vi.hoisted(() => {
  class FakeWaveSurfer {
    static instances: FakeWaveSurfer[] = [];
    static autoReady = true;
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
      if (event === 'ready' && FakeWaveSurfer.autoReady) callback();
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
    waveSurferInstances: FakeWaveSurfer.instances,
    resetWaveSurfer: (): void => {
      FakeWaveSurfer.instances.length = 0;
      FakeWaveSurfer.autoReady = true;
    },
    setAutoReady: (value: boolean): void => {
      FakeWaveSurfer.autoReady = value;
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

// The timeline window-renders clips (timelineVirtualization); jsdom has no layout
// engine, so tests inject a scroll-viewport width big enough to mount every clip
// under test and fire the scroll event the component listens for.
function setViewport(container: HTMLElement, clientWidth: number, scrollLeft = 0) {
  const el = container.querySelector('[data-testid="timeline-scroll-area"]');
  if (!(el instanceof HTMLElement)) throw new Error('timeline scroll area not found');
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true, writable: true });
  act(() => {
    fireEvent.scroll(el);
  });
}

describe('ClipWaveform', () => {
  beforeEach(() => {
    resetWaveSurfer();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the waveform once the clip audio decodes', () => {
    const { container } = render(<ClipWaveform url="blob:clip-1" />);
    const waveform = container.querySelector('[data-clip-waveform="ready"]');
    expect(waveform).not.toBeNull();
    expect((waveform as HTMLElement).style.visibility).toBe('visible');
    expect(waveSurferInstances).toHaveLength(1);
    expect(waveSurferInstances[0].options.url).toBe('blob:clip-1');
  });

  it('creates a non-interactive normalized instance', () => {
    render(<ClipWaveform url="blob:clip-1" height={64} />);
    const options = waveSurferInstances[0].options;
    expect(options.interact).toBe(false);
    expect(options.normalize).toBe(true);
    expect(options.height).toBe(64);
  });

  it('hides the waveform when the media has no decodable audio', () => {
    setAutoReady(false);
    const { container } = render(<ClipWaveform url="blob:silent" />);
    expect(container.querySelector('[data-clip-waveform="loading"]')).not.toBeNull();
    act(() => {
      waveSurferInstances[0].emit('error', new Error('decoding failed'));
    });
    const failed = container.querySelector('[data-clip-waveform="failed"]');
    expect(failed).not.toBeNull();
    expect((failed as HTMLElement).style.visibility).toBe('hidden');
  });

  it('destroys the instance on unmount', () => {
    const { unmount } = render(<ClipWaveform url="blob:clip-1" />);
    unmount();
    expect(waveSurferInstances[0].destroyed).toBe(true);
  });

  it('recreates the instance when the clip url changes', () => {
    const { rerender } = render(<ClipWaveform url="blob:a" />);
    rerender(<ClipWaveform url="blob:b" />);
    expect(waveSurferInstances).toHaveLength(2);
    expect(waveSurferInstances[0].destroyed).toBe(true);
    expect(waveSurferInstances[1].destroyed).toBe(false);
    expect(waveSurferInstances[1].options.url).toBe('blob:b');
  });
});

describe('Timeline clip waveforms', () => {
  beforeEach(() => {
    resetWaveSurfer();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders a waveform inside the lane block for a clip with audio', () => {
    const { container } = renderTimeline([makeClip()]);
    const waveform = container.querySelector('[data-clip-waveform="ready"]');
    expect(waveform).not.toBeNull();
    // The waveform lives inside its own clip block on a video lane.
    expect(waveform?.closest('[data-clip]')).not.toBeNull();
  });

  it('renders one waveform per clip, wired to each clip url', () => {
    const { container } = renderTimeline([
      makeClip({ id: 'clip-1', url: 'blob:clip-1', startTime: 0 }),
      makeClip({ id: 'clip-2', url: 'blob:clip-2', startTime: 4 }),
    ]);
    // Widen the window so both clips are inside the visible range and mount.
    setViewport(container, 1200);
    expect(waveSurferInstances).toHaveLength(2);
    expect(waveSurferInstances.map((i) => i.options.url)).toEqual(['blob:clip-1', 'blob:clip-2']);
  });
});
