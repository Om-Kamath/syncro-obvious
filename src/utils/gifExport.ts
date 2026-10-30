/**
 * GIF export: pure frame-budget planning plus DOM-side canvas rendering into a
 * gifenc encoder. The plan math and duration helpers are unit-tested;
 * renderGif runs in the browser only (video decode + canvas 2D).
 */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { CaptionStyle, VideoClip, Voiceover } from '../types';
import { ExportPreset, computeDrawGeometry } from './exportPresets';
import { getClipAtTime } from './exportUtils';
import { drawCaptionOnCanvas } from './captionDraw';

// ── Frame-budget limits ─────────────────────────────────────────────────────
/** The planner clamps any fps/width input into these ranges. */
export const GIF_MIN_FPS = 1;
export const GIF_MAX_FPS = 24;
export const GIF_MIN_WIDTH = 120;
export const GIF_MAX_WIDTH = 720;
/** Hard cap on encoded frames so a long range can't produce a runaway encode. */
export const MAX_GIF_FRAMES = 300;

/** Sensible presets the UI offers inside the clamped ranges. */
export const GIF_FPS_OPTIONS = [5, 10, 15, 24];
export const GIF_WIDTH_OPTIONS = [240, 360, 480, 640];

export interface GifFramePlan {
  /** Clamped frames-per-second actually used. */
  fps: number;
  /** Canvas width in px (clamped). */
  width: number;
  /** Canvas height in px, derived from the aspect preset. */
  height: number;
  /** duration × fps, floored to whole frames, capped at MAX_GIF_FRAMES. */
  frameCount: number;
  /** Per-frame delay in ms fed to the encoder (GIF stores centiseconds internally). */
  frameDelayMs: number;
  /** Requested range length in seconds, before truncation. */
  sourceDurationSec: number;
  /** Loop length of the finished GIF: frameCount / fps. */
  exportDurationSec: number;
  /** True when the frame budget cut the range short. */
  truncated: boolean;
}

export interface GifFramePlanOptions {
  durationSec: number;
  fps: number;
  width: number;
  preset: ExportPreset;
}

/**
 * Frame budget for a GIF render: duration × fps floored to whole frames, then
 * capped at MAX_GIF_FRAMES. fps and width are clamped defensively; height
 * follows the aspect preset so the GIF matches the video export's shape.
 */
export function computeGifFramePlan(opts: GifFramePlanOptions): GifFramePlan {
  const fps = clamp(Math.round(opts.fps), GIF_MIN_FPS, GIF_MAX_FPS);
  const width = clamp(Math.round(opts.width), GIF_MIN_WIDTH, GIF_MAX_WIDTH);
  const height = Math.max(1, Math.round(width * (opts.preset.height / opts.preset.width)));
  const sourceDurationSec = Math.max(0, opts.durationSec);
  const uncappedFrames = Math.floor(sourceDurationSec * fps);
  const frameCount = Math.min(uncappedFrames, MAX_GIF_FRAMES);
  return {
    fps,
    width,
    height,
    frameCount,
    frameDelayMs: Math.round(1000 / fps),
    sourceDurationSec,
    exportDurationSec: frameCount / fps,
    truncated: uncappedFrames > MAX_GIF_FRAMES,
  };
}

/**
 * Length of the range a GIF render covers: the trimmed voiceover window when a
 * voiceover exists (the same range the video exporter records), otherwise the
 * chain of effective clip durations.
 */
export function getTimelineDurationSec(clips: VideoClip[], voiceover: Voiceover | null): number {
  if (voiceover) {
    return Math.max(0, (voiceover.trimEnd ?? voiceover.duration) - (voiceover.trimStart ?? 0));
  }
  return Math.max(0, clips.reduce((sum, c) => sum + (c.trimmedDuration ?? c.duration), 0));
}

// ── DOM-side render ─────────────────────────────────────────────────────────

export class GifExportCancelledError extends Error {
  constructor() {
    super('GIF export cancelled');
    this.name = 'GifExportCancelledError';
  }
}

export interface GifCaptionOverlay {
  segments: NonNullable<Voiceover['segments']>;
  style: CaptionStyle;
}

export interface GifRenderOptions {
  clips: VideoClip[];
  plan: GifFramePlan;
  preset: ExportPreset;
  /** Burned-in captions, rendered identically to the video exporter. */
  captions?: GifCaptionOverlay | null;
  onProgress?: (framesDone: number, frameCount: number) => void;
  /** Polled before each frame; return true to abort with GifExportCancelledError. */
  shouldCancel?: () => boolean;
}

/**
 * Render the timeline range described by `plan` into an animated GIF blob.
 * Frames are seek-decoded (not real-time recorded) so frame timing is
 * deterministic and faster than wall-clock playback.
 */
export async function renderGif(opts: GifRenderOptions): Promise<Blob> {
  const { clips, plan, preset } = opts;
  if (clips.length === 0) throw new Error('No video clips to export');
  if (plan.frameCount <= 0) throw new Error('The selected range is empty — nothing to export');

  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  const renderVids = await loadRenderVideos(clips);
  if (Object.keys(renderVids).length === 0) {
    throw new Error('None of the clips could be decoded — GIF was not rendered');
  }

  try {
    const encoder = GIFEncoder();
    for (let frame = 0; frame < plan.frameCount; frame++) {
      if (opts.shouldCancel?.()) throw new GifExportCancelledError();

      const t = frame / plan.fps;
      const hit = getClipAtTime(clips, t);
      const activeVideo = hit ? renderVids[hit.clip.id] : undefined;
      if (activeVideo && hit) await seekVideo(activeVideo, hit.localTime);

      drawTimelineFrame(ctx, { plan, preset, activeVideo, time: t, captions: opts.captions ?? null });

      const { data } = ctx.getImageData(0, 0, plan.width, plan.height);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      encoder.writeFrame(index, plan.width, plan.height, { palette, delay: plan.frameDelayMs });

      opts.onProgress?.(frame + 1, plan.frameCount);
      // Yield to the event loop so the progress UI paints between seeks.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    encoder.finish();
    return new Blob([encoder.bytes()], { type: 'image/gif' });
  } finally {
    Object.values(renderVids).forEach(v => { v.pause(); v.remove(); });
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Preload one muted video element per clip; broken sources resolve null and are skipped (like the video exporter). */
function loadRenderVideos(clips: VideoClip[]): Promise<Record<string, HTMLVideoElement>> {
  return Promise.all(
    clips.map(clip => new Promise<[string, HTMLVideoElement] | null>(resolve => {
      const v = document.createElement('video');
      v.src = clip.url;
      v.muted = true;
      v.preload = 'auto';
      v.addEventListener('loadeddata', () => resolve([clip.id, v]), { once: true });
      v.addEventListener('error', () => resolve(null), { once: true });
      v.load();
    }))
  ).then(results => Object.fromEntries(results.filter((e): e is [string, HTMLVideoElement] => e !== null)));
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    // Some codecs never fire `seeked` — proceed with the last decoded frame after 3s.
    const timer = setTimeout(done, 3000);
    video.addEventListener('seeked', done);
    video.currentTime = time;
  });
}

interface FrameDrawContext {
  plan: GifFramePlan;
  preset: ExportPreset;
  activeVideo: HTMLVideoElement | undefined;
  time: number;
  captions: GifCaptionOverlay | null;
}

function drawTimelineFrame(ctx: CanvasRenderingContext2D, frame: FrameDrawContext): void {
  const { plan, preset } = frame;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, plan.width, plan.height);

  if (frame.activeVideo) {
    try {
      const g = computeDrawGeometry(preset, frame.activeVideo.videoWidth, frame.activeVideo.videoHeight);
      ctx.drawImage(frame.activeVideo, g.dx, g.dy, g.dWidth, g.dHeight);
    } catch {
      // Frame not decodable this tick — draw black, matching the video exporter's skip.
    }
  }

  if (frame.captions) {
    const seg = frame.captions.segments.find(s => frame.time >= s.start && frame.time <= s.end);
    if (seg) drawCaptionOnCanvas(ctx, plan.width, plan.height, seg.text, frame.captions.style);
  }
}
