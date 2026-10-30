/**
 * Filmstrip thumbnails for timeline clips: at import, sample N evenly spaced
 * frames from the video and store them as small JPEG data URLs on the clip.
 * Timeline renders the strip as the clip block's background.
 */

export const FILMSTRIP_FRAME_COUNT = 6;

const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;
const JPEG_QUALITY = 0.6;
const LOAD_TIMEOUT_MS = 5000;
const SEEK_TIMEOUT_MS = 3000;

/**
 * Pure frame-sampling schedule: the midpoint of each of `count` equal
 * segments across [0, duration]. Midpoints avoid the file's very first and
 * last frames — the two most common seek failures — and guarantee distinct,
 * evenly spaced seek targets for any positive duration.
 */
export function computeThumbnailTimestamps(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const frames = Number.isInteger(count) ? count : Math.floor(count);
  if (frames <= 0) return [];
  const segment = duration / frames;
  return Array.from({ length: frames }, (_, i) => (i + 0.5) * segment);
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Seek to ${time}s timed out`));
    }, SEEK_TIMEOUT_MS);
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(`Seek to ${time}s failed`)); };
    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    }
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}

/**
 * Capture `count` frames from the video at `url` (the caller owns the URL's
 * lifecycle). Throws if the media cannot load at all — callers surface that;
 * individual frames that fail to seek are skipped so a partial filmstrip
 * still renders.
 */
export async function captureFilmstrip(url: string, duration: number, count = FILMSTRIP_FRAME_COUNT): Promise<string[]> {
  if (duration <= 0) return [];

  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Timed out loading video metadata')), LOAD_TIMEOUT_MS);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error('Video failed to load')); };
    });

    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    const canvas = ctx.canvas;
    canvas.width = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;

    const frames: string[] = [];
    for (const time of computeThumbnailTimestamps(duration, count)) {
      try {
        await seek(video, time);
        ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        frames.push(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch {
        // Undecodable frame: skip it and keep the rest of the strip.
      }
    }
    return frames;
  } finally {
    // Release the media element's decoder resources for the blob URL.
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();
  }
}
