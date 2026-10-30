// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Timeline } from './Timeline';
import type { VideoClip } from '../types';

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

// jsdom applies no CSS, so styling state is asserted at the class level: the
// classes ARE the component's style contract and the fix is a class swap.
function clipEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-clip="true"]');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe('Timeline clip selection (keyboard)', () => {
  beforeEach(() => resetWaveSurfer());
  afterEach(() => cleanup());

  it('Enter on a focused clip selects it and Enter again deselects it', () => {
    const { container } = renderTimeline([makeClip()]);
    const el = clipEl(container);
    el.focus();

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(el.getAttribute('aria-pressed')).toBe('true');

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  it('Space selects a focused clip', () => {
    const { container } = renderTimeline([makeClip()]);
    const el = clipEl(container);
    el.focus();

    fireEvent.keyDown(el, { key: ' ' });
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });

  it('Escape clears the selection', () => {
    const { container } = renderTimeline([makeClip()]);
    const el = clipEl(container);
    el.focus();

    fireEvent.keyDown(el, { key: 'Enter' });
    expect(el.getAttribute('aria-pressed')).toBe('true');

    fireEvent.keyDown(el, { key: 'Escape' });
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  it('mouse down on a clip selects it', () => {
    const { container } = renderTimeline([makeClip()]);
    const el = clipEl(container);

    fireEvent.mouseDown(el);
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Timeline selection vs focus outline treatments', () => {
  beforeEach(() => resetWaveSurfer());
  afterEach(() => cleanup());

  it('keyboard focus uses an outline, never the ring that selection uses', () => {
    const { container } = renderTimeline([makeClip()]);
    const el = clipEl(container);
    const className = el.className;

    // Focus treatment is outline-based…
    expect(className).toContain('focus-visible:outline-sky-600');
    // …and does not use ring utilities, which a selected clip also needs
    // (ring is box-shadow, so a ring focus indicator erases the selection ring).
    expect(className).not.toContain('focus-visible:ring-');
    expect(className).not.toContain('focus-visible:ring-violet-500');
  });

  it('a selected clip keeps the violet selection ring alongside the focus outline', () => {
    const { container } = renderTimeline([makeClip()]);
    const el = clipEl(container);
    el.focus();

    fireEvent.keyDown(el, { key: 'Enter' });
    const className = el.className;
    expect(el.getAttribute('aria-pressed')).toBe('true');
    // Both treatments compose: selection ring (box-shadow) + focus outline.
    expect(className).toContain('ring-violet-600');
    expect(className).toContain('focus-visible:outline-sky-600');
  });

  it('the focus treatment is identical on the playhead control', () => {
    const { container } = renderTimeline([makeClip()]);
    const playhead = container.querySelector('[role="slider"][aria-label="Playhead position"]');
    expect(playhead).not.toBeNull();
    expect((playhead as HTMLElement).className).toContain('focus-visible:outline-sky-600');
    expect((playhead as HTMLElement).className).not.toContain('focus-visible:ring-');
  });
});
