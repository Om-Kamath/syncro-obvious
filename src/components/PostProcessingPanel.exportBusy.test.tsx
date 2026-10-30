// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Export-button busy-state layout: while an export runs, the primary button
// must keep its identity — spinner rendered alongside the label (never
// replacing it or the whole button), aria-busy set, clicks disabled — with
// Cancel offered as a separate sibling button.

class MockMediaRecorder {
  static isTypeSupported(): boolean {
    return true;
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start(): void {}
  stop(): void {
    this.onstop?.();
  }
  constructor(_stream: MediaStream, _opts?: MediaRecorderOptions) {}
}

class MockAudioContext {
  destination: object = {};
  close = vi.fn();
  decodeAudioData = vi.fn(async () => fakeAudioBuffer());
  createBuffer = vi.fn((_ch: number, length: number, _rate: number) => fakeAudioBuffer(length));
  createBufferSource = vi.fn(() => ({ buffer: null, connect: vi.fn(), start: vi.fn() }));
  createMediaStreamDestination = vi.fn(() => ({ stream: { getTracks: () => [] } }));
}

function fakeAudioBuffer(length = 48000): AudioBuffer {
  return {
    sampleRate: 48000,
    length,
    duration: length / 48000,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

import { ExportTab } from './PostProcessingPanel';
import type { VideoClip, Voiceover, CaptionStyle } from '../types';

const captionStyle: CaptionStyle = {
  mode: 'lower-third',
  fontSize: 24,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
};

function voiceover(): Voiceover {
  return {
    file: new File([new Uint8Array(8)], 'narration.mp3', { type: 'audio/mpeg' }),
    url: 'blob:voiceover',
    duration: 8,
    startTime: 0,
  };
}

function clip(): VideoClip {
  return {
    id: 'clip-1',
    name: 'clip.mp4',
    file: new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
    url: 'blob:clip',
    duration: 10,
    startTime: 0,
  };
}

describe('export button busy state', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', MockMediaRecorder as unknown as typeof MediaRecorder);
    vi.stubGlobal(
      'MediaStream',
      class {
        constructor(_tracks?: unknown) {}
      } as unknown as typeof MediaStream
    );
    vi.stubGlobal('AudioContext', MockAudioContext as unknown as typeof AudioContext);
    // Deterministic frame loop in jsdom (no native rAF here).
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 16)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    (HTMLCanvasElement.prototype as unknown as { captureStream: unknown }).captureStream = vi.fn(
      () => ({ getTracks: () => [] })
    );
    // Resolve the export's video preload step immediately (broken-clip path).
    vi.spyOn(HTMLVideoElement.prototype, 'load').mockImplementation(function load(this: HTMLVideoElement) {
      this.dispatchEvent(new Event('error'));
    });
    URL.createObjectURL = vi.fn(() => 'blob:download');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    cleanup();
  });

  it('keeps the button stable while exporting: aria-busy, spinner beside the label, Cancel as a sibling', async () => {
    render(<ExportTab voiceover={voiceover()} videoClips={[clip()]} captionStyle={captionStyle} captionsEnabled={false} />);

    const startButton = screen.getByRole('button', { name: /start export/i });
    fireEvent.click(startButton);

    // Busy state: the same button element survives — label reserved, not swapped.
    const busyButton = await waitFor(() => screen.getByRole('button', { name: /exporting/i }));
    expect(busyButton).toBe(startButton);
    expect(busyButton.getAttribute('aria-busy')).toBe('true');
    expect(busyButton.hasAttribute('disabled')).toBe(true);
    // Spinner and label coexist inside the button (no overlap, no replacement).
    expect(busyButton.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.getByText('Exporting…')).toBeDefined();
    // Cancel is a separate sibling action, not the primary button's replacement.
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton).not.toBe(busyButton);

    fireEvent.click(cancelButton);

    // Cancelling returns the same button to idle and drops aria-busy.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /start export/i }).getAttribute('aria-busy')).toBe('false')
    );
    expect(screen.getByRole('button', { name: /start export/i })).toBe(startButton);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
