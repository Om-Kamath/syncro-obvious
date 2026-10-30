// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react';
import { CaptionsTab, ExportTab } from './PostProcessingPanel';
import { CAPTION_PRESETS, CAPTION_PRESET_ORDER, applyPreset, DEFAULT_CAPTION_STYLE } from '../utils/captionPresets';
import { downloadFile } from '../utils/exportUtils';
import type { CaptionStyle, VideoClip, Voiceover } from '../types';

vi.mock('../utils/exportUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/exportUtils')>();
  return { ...actual, downloadFile: vi.fn() } as typeof import('../utils/exportUtils');
});

const mockedDownload = vi.mocked(downloadFile);

// ── Browser APIs jsdom lacks: MediaRecorder, MediaStream, AudioContext ──────
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'video/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.onstop?.();
  }
}

class FakeMediaStream {
  constructor(private tracks: unknown[] = []) {}
  getTracks() { return this.tracks; }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  destination = {};
  close = vi.fn(async () => {});
  // Stand-in for a decoded audio buffer: 1s of 2-channel silence at 48kHz.
  decoded = {
    sampleRate: 48000,
    numberOfChannels: 2,
    length: 48000,
    getChannelData: () => new Float32Array(48000),
  };
  decodeAudioData = vi.fn(async () => this.decoded);
  createBuffer = vi.fn((numberOfChannels: number, length: number, sampleRate: number) => ({
    numberOfChannels,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  }));
  createBufferSource = vi.fn(() => ({
    buffer: null as unknown,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }));
  createMediaStreamDestination = vi.fn(() => ({ stream: new FakeMediaStream([{ kind: 'audio' }]) }));
  constructor() { FakeAudioContext.instances.push(this); }
}

// Media-load stubs: jsdom media elements never fire load events, so the stubs
// resolve them synchronously — unless a test holds them to simulate slow I/O.
let holdVideoLoad = false;
const pendingVideoLoads: HTMLVideoElement[] = [];
// jsdom does not define captureStream at all — save/restore its descriptor.
let captureStreamOriginal: PropertyDescriptor | undefined;

// Canvas 2D stub: jsdom returns null from getContext without the `canvas` pkg.
const canvasCtx = {
  fillStyle: '',
  font: '',
  textAlign: '',
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 10 })),
  beginPath: vi.fn(),
  rect: vi.fn(),
  roundRect: vi.fn(),
  fill: vi.fn(),
} as unknown as CanvasRenderingContext2D;

const VOICEOVER: Voiceover = {
  url: 'blob:test-voiceover',
  duration: 8,
  transcription: 'Welcome to the demo. Second segment here.',
  segments: [
    { text: 'Welcome to the demo', start: 0, end: 4 },
    { text: 'Second segment here', start: 4, end: 8 },
  ],
};

// Stateful harness so preset application flows back into captionStyle the way
// App.tsx wires setCaptionStyle in production.
function PresetHarness({ onStyleChange }: { onStyleChange: (s: CaptionStyle) => void }) {
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  return (
    <CaptionsTab
      voiceover={VOICEOVER}
      captionStyle={style}
      captionsEnabled
      onStyleChange={s => { setStyle(s); onStyleChange(s); }}
      onEnabledChange={() => {}}
      onImportCaptions={() => {}}
    />
  );
}

const captionStyle: CaptionStyle = {
  mode: 'lower-third',
  fontSize: 24,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
};

const makeVoiceover = (): Voiceover => ({
  url: 'blob:voiceover',
  duration: 5,
  transcription: 'Hello world',
  segments: [{ text: 'Hello world', start: 0, end: 5 }],
});

const makeClip = (): VideoClip => ({
  id: 'clip-1',
  file: new File([''], 'clip.mp4'),
  url: 'blob:clip-1',
  duration: 10,
  startTime: 0,
  name: 'clip.mp4',
});

function renderPanel() {
  return render(
    <ExportTab
      voiceover={makeVoiceover()}
      videoClips={[makeClip()]}
      captionStyle={captionStyle}
      captionsEnabled={false}
    />
  );
}

describe('CaptionsTab preset picker', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const presetsGrid = () => within(screen.getByText('Presets').nextElementSibling as HTMLElement);

  it('lists the four shipped presets', () => {
    render(<PresetHarness onStyleChange={() => {}} />);
    for (const name of CAPTION_PRESET_ORDER) {
      expect(presetsGrid().getByRole('button', { name: new RegExp(CAPTION_PRESETS[name].label) })).toBeDefined();
    }
  });

  it('applies the full preset style on click', () => {
    const onStyleChange = vi.fn();
    render(<PresetHarness onStyleChange={onStyleChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Bold Pop/ }));
    expect(onStyleChange).toHaveBeenCalledTimes(1);
    expect(onStyleChange).toHaveBeenCalledWith({ ...CAPTION_PRESETS['bold-pop'].style, preset: 'bold-pop' });
  });

  it('marks the applied preset as active', () => {
    render(<PresetHarness onStyleChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Karaoke/ }));
    const karaokeBtn = presetsGrid().getByRole('button', { name: /Karaoke/ });
    expect(karaokeBtn.getAttribute('aria-pressed')).toBe('true');
    const minimalBtn = presetsGrid().getByRole('button', { name: /Minimal/ });
    expect(minimalBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('manual tweaks clear the preset stamp', () => {
    const onStyleChange = vi.fn();
    render(<PresetHarness onStyleChange={onStyleChange} />);
    // Apply a preset, then tweak the text color by hand.
    fireEvent.click(screen.getByRole('button', { name: /Bold Pop/ }));
    fireEvent.change(screen.getByDisplayValue('#ffffff'), { target: { value: '#ff0000' } });

    expect(onStyleChange).toHaveBeenCalledTimes(2);
    const last = onStyleChange.mock.calls[1][0] as CaptionStyle;
    expect(last.color).toBe('#ff0000');
    expect(last.preset).toBeUndefined();
    // The rest of the preset look is untouched by the manual tweak.
    expect(last.bgColor).toBe(CAPTION_PRESETS['bold-pop'].style.bgColor);
    expect(last.fontSize).toBe(CAPTION_PRESETS['bold-pop'].style.fontSize);
  });

  it('preview starts on the Classic preset by default', () => {
    render(<PresetHarness onStyleChange={() => {}} />);
    const classicBtn = presetsGrid().getByRole('button', { name: /Classic/ });
    expect(classicBtn.getAttribute('aria-pressed')).toBe('true');
    expect(DEFAULT_CAPTION_STYLE).toEqual(applyPreset('classic'));
  });
});

async function startExport() {
  fireEvent.click(screen.getByRole('button', { name: 'Start Export' }));
  // Flush the resolved media/fetch/decode microtask chain so recording starts.
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

describe('ExportTab — progress + cancel', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('MediaStream', FakeMediaStream);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    // The export engine fetches narration bytes when no File is attached.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));

    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function loadStub(this: HTMLMediaElement) {
      if (holdVideoLoad) { pendingVideoLoads.push(this as HTMLVideoElement); return; }
      this.dispatchEvent(new Event('loadeddata'));
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasCtx);
    captureStreamOriginal = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'captureStream');
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      writable: true,
      value: vi.fn(() => new FakeMediaStream([{ kind: 'video' }]) as unknown as MediaStream),
    });
  });

  afterEach(() => {
    cleanup();
    mockedDownload.mockClear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (captureStreamOriginal) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', captureStreamOriginal);
    } else {
      delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).captureStream;
    }
    FakeMediaRecorder.instances.length = 0;
    FakeAudioContext.instances.length = 0;
    pendingVideoLoads.length = 0;
    holdVideoLoad = false;
  });

  it('shows a live progress bar with percent, elapsed time, and cancel while exporting', async () => {
    renderPanel();
    await startExport();

    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Start Export' })).toBeNull();

    // 1s into a 5s export → ~20%.
    await act(async () => { vi.advanceTimersByTime(1000); });

    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    const now = Number(bar.getAttribute('aria-valuenow'));
    expect(now).toBeGreaterThanOrEqual(15);
    expect(now).toBeLessThanOrEqual(25);
    expect(screen.getByText('Recording…')).toBeDefined();
    expect(screen.getByText(/of 0:05/)).toBeDefined();
  });

  it('downloads the finished file and returns to idle when the export completes', async () => {
    renderPanel();
    await startExport();

    await act(async () => { vi.advanceTimersByTime(5200); });

    expect(mockedDownload).toHaveBeenCalledTimes(1);
    const [blob, name] = mockedDownload.mock.calls[0];
    expect(name).toBe('syncvoice-export.mp4');
    expect(blob).toBeInstanceOf(Blob);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start Export' })).toBeDefined();
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
  });

  it('cancel discards the partial recording — no file is downloaded', async () => {
    renderPanel();
    await startExport();
    await act(async () => { vi.advanceTimersByTime(1000); });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText(/no file was saved/i)).toBeDefined();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start Export' })).toBeDefined();

    // The draw loop must be dead — no late progress, and definitely no download.
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(mockedDownload).not.toHaveBeenCalled();
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
  });

  it('cancel works while media is still preloading, and a late load cannot start the recorder', async () => {
    holdVideoLoad = true;
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Start Export' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/no file was saved/i)).toBeDefined();

    holdVideoLoad = false;
    await act(async () => {
      pendingVideoLoads.forEach(v => v.dispatchEvent(new Event('loadeddata')));
      await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(10000); });

    expect(FakeMediaRecorder.instances).toHaveLength(0); // recording never started
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it('surfaces a narration fetch failure instead of failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Start Export' }));
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

    expect(screen.getByText(/Export failed: Narration audio unavailable/)).toBeDefined();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(mockedDownload).not.toHaveBeenCalled();
    // Resources loaded before the failure are released.
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
  });
});
