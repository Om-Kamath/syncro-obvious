// Probe a video blob URL for duration and presentation frame rate, so trims
// can snap to the source's real frame grid. Detection degrades gracefully:
// whatever fails, the caller still gets a duration (0 when unplayable) and the
// trim math falls back to DEFAULT_FPS.

export interface VideoProbe {
  /** Seconds; 0 when the file is unplayable or metadata never loads. */
  duration: number;
  /** Detected presentation rate (frames/second); undefined when unknown. */
  fps?: number;
}

/** Rates the detected rate snaps to when it lands within ~3.5% of one. */
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60] as const;

/** Collapse a measured rate onto the nearest well-known rate (NTSC, PAL, …). */
export function snapToCommonFps(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 30;
  const best = COMMON_FPS.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a));
  if (Math.abs(best - rate) <= best * 0.035) return best;
  return Math.round(rate * 1000) / 1000;
}

interface FrameMetadata {
  mediaTime: number;
}

interface RvfcVideo {
  requestVideoFrameCallback?: (cb: (now: number, metadata: FrameMetadata) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * MediaRecorder-produced WebM (and some screen-recorder files) report
 * duration Infinity until the element seeks past the end; force that seek so
 * the real duration becomes readable.
 */
function normalizeDuration(video: HTMLVideoElement): Promise<void> {
  if (Number.isFinite(video.duration)) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; video.onseeked = null; resolve(); } };
    video.onseeked = finish;
    try { video.currentTime = 1e7; } catch { finish(); }
    setTimeout(finish, 750);
  });
}

/**
 * Load a video and measure its duration plus frame rate. Frame-rate detection
 * plays the element muted and times frame presentations via
 * requestVideoFrameCallback; unsupported browsers, blocked playback, or
 * timeout resolve with duration only.
 */
export function probeVideo(url: string, sampleFrames = 8, timeoutMs = 1500): Promise<VideoProbe> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    const rvfc = video as unknown as RvfcVideo;
    let settled = false;
    let lastMediaTime: number | null = null;
    const deltas: number[] = [];
    let rvfcHandle: number | null = null;

    const finish = (fps?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (rvfcHandle !== null && rvfc.cancelVideoFrameCallback) rvfc.cancelVideoFrameCallback(rvfcHandle);
      video.pause();
      video.removeAttribute('src');
      video.load(); // release the media decoder for GC
      resolve({ duration: Number.isFinite(video.duration) ? video.duration : 0, fps });
    };

    const timer = setTimeout(() => finish(), timeoutMs);

    video.onerror = () => finish();
    video.onloadeddata = () => {
      void (async () => {
        if (settled) return;
        await normalizeDuration(video);
        if (settled) return;
        if (!rvfc.requestVideoFrameCallback) { finish(); return; }
        try { await video.play(); } catch { finish(); return; }
        if (settled) return;
        const onFrame = (_now: number, metadata: FrameMetadata): void => {
          if (lastMediaTime !== null && metadata.mediaTime > lastMediaTime) {
            deltas.push(metadata.mediaTime - lastMediaTime);
          }
          lastMediaTime = metadata.mediaTime;
          if (deltas.length >= sampleFrames) {
            finish(snapToCommonFps(1 / median(deltas)));
            return;
          }
          rvfcHandle = rvfc.requestVideoFrameCallback!(onFrame);
        };
        rvfcHandle = rvfc.requestVideoFrameCallback!(onFrame);
      })();
    };

    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    video.load();
  });
}
