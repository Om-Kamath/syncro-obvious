/**
 * Wall-clock video export engine: canvas + MediaRecorder re-record with real
 * progress and cancellation.
 *
 * Extracted from ExportTab so the export lifecycle lives in one place with
 * testable contracts:
 * - cancel() works from the moment the export starts, including while media is
 *   still preloading (the old inline version wired the cancel button only
 *   after every await, leaving it dead during the load phase).
 * - a cancelled export discards its partial recording instead of downloading
 *   a truncated file.
 * - the AudioContext is closed and preloaded <video> elements released on
 *   every terminal path — browsers cap concurrent AudioContexts, so leaking
 *   one per export eventually hard-fails the export feature.
 */
import { VideoClip, Voiceover, CaptionStyle } from '../types';
import { computeDrawGeometry, type ExportPreset } from '../utils/exportPresets';
import { selectMimeType, DEFAULT_EXPORT_CODEC, type ExportCodecId } from '../utils/exportCodecs';
import { QUALITY_PRESETS, DEFAULT_QUALITY_PRESET, type QualityPresetId } from '../utils/qualityPresets';
import { getClipAtTime, downloadFile } from '../utils/exportUtils';
import { audioChannelsOf, mixAudio, sliceAudioWindow, toAudioBuffer, type AudioChannels } from '../utils/audioMix';

export interface VideoExportOptions {
  voiceover: Voiceover;
  videoClips: VideoClip[];
  preset: ExportPreset;
  /** Requested export container — falls back gracefully when unsupported. */
  codecId?: ExportCodecId;
  /** Requested quality preset — maps to the MediaRecorder bitrate hint. */
  qualityId?: QualityPresetId;
  /** Optional background music mixed under the narration at musicVolume. */
  musicFile?: File | null;
  musicVolume?: number;
  captionsEnabled: boolean;
  captionStyle: CaptionStyle;
  /** Export progress as a 0..1 fraction of the wall-clock duration. */
  onProgress: (fraction: number) => void;
  /** Recording finished and the file was handed to the download sink. */
  onComplete: () => void;
  /** Cancelled before completion — no file is written. */
  onCancelled: () => void;
  /** Unexpected failure — no file is written. */
  onError: (message: string) => void;
  /** Injectable download sink (tests); defaults to a browser file download. */
  download?: (blob: Blob, name: string) => void;
}

export interface VideoExportHandle {
  /** Abort the export. Idempotent; a no-op after any terminal state. */
  cancel: () => void;
}

/**
 * Starts the export. Exactly one of onComplete/onCancelled/onError fires per
 * call, after teardown. Returns a handle whose cancel() is safe to call at
 * any point, including before the recorder exists.
 */
export function startVideoExport(options: VideoExportOptions): VideoExportHandle {
  const {
    voiceover,
    videoClips,
    preset,
    codecId = DEFAULT_EXPORT_CODEC,
    qualityId = DEFAULT_QUALITY_PRESET,
    musicFile,
    musicVolume = 1,
    captionsEnabled,
    captionStyle,
    onProgress,
    onComplete,
    onCancelled,
    onError,
  } = options;
  const quality = QUALITY_PRESETS[qualityId];
  const download = options.download ?? downloadFile;

  let finished = false;
  let cancelled = false;
  let rafId: number | null = null;
  const cleanups: Array<() => void> = [];
  const teardown = () => {
    for (const fn of cleanups.splice(0)) fn();
  };

  const handle: VideoExportHandle = {
    cancel: () => {
      if (finished) return;
      finished = true;
      cancelled = true;
      teardown();
      onCancelled();
    },
  };

  const run = async () => {
    try {
      const W = preset.width;
      const H = preset.height;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      // Pre-load render video elements — only store ones that loaded successfully.
      // Registered as cleanup first so a cancel mid-load still releases them.
      const renderVids: Record<string, HTMLVideoElement> = {};
      cleanups.push(() => {
        Object.values(renderVids).forEach(v => { v.pause(); v.remove(); });
      });

      await Promise.all(videoClips.map(clip =>
        new Promise<void>(res => {
          const v = document.createElement('video');
          v.src = clip.url;
          v.muted = true;
          v.preload = 'auto';
          v.addEventListener('loadeddata', () => { renderVids[clip.id] = v; res(); }, { once: true });
          v.addEventListener('error', () => res(), { once: true }); // skip broken clips, don't store
          v.load();
        })
      ));
      if (cancelled) return;

      // Audio — decode narration (and music) fully, mix them in the sample
      // domain, then record the mixed buffer. Both files decode through the
      // same AudioContext, so their sample rates always match.
      const audioCtx = new AudioContext();
      cleanups.push(() => { void audioCtx.close().catch(() => { /* already closed */ }); });

      const narrationBytes = voiceover.file
        ? await voiceover.file.arrayBuffer()
        : await fetch(voiceover.url).then(r => {
            if (!r.ok) throw new Error(`Narration audio unavailable (HTTP ${r.status})`);
            return r.arrayBuffer();
          });
      const narrationBuffer = await audioCtx.decodeAudioData(narrationBytes);
      if (cancelled) return;

      let musicChannels: AudioChannels | null = null;
      if (musicFile) {
        musicChannels = audioChannelsOf(await audioCtx.decodeAudioData(await musicFile.arrayBuffer()));
        if (cancelled) return;
      }

      const trimStartSec = voiceover.trimStart ?? 0;
      const trimEndSec = voiceover.trimEnd ?? voiceover.duration;
      const mixedBuffer = toAudioBuffer(
        mixAudio(sliceAudioWindow(narrationBuffer, trimStartSec, trimEndSec), musicChannels, musicVolume),
        audioCtx,
      );

      const dest = audioCtx.createMediaStreamDestination();
      const source = audioCtx.createBufferSource();
      source.buffer = mixedBuffer;
      source.connect(dest);
      source.connect(audioCtx.destination);
      cleanups.push(() => {
        try { source.stop(); } catch { /* source not started */ }
        try { source.disconnect(); } catch { /* already disconnected */ }
      });

      // Build combined stream
      const canvasStream = canvas.captureStream(30);
      const combined = new MediaStream([
        ...canvasStream.getTracks(),
        ...dest.stream.getTracks(),
      ]);

      const { mimeType, ext } = selectMimeType(
        codecId,
        m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
      );
      const recorderOptions: MediaRecorderOptions = { mimeType };
      if (quality.videoBitsPerSecond !== null) {
        recorderOptions.videoBitsPerSecond = quality.videoBitsPerSecond;
      }
      const recorder = new MediaRecorder(combined, recorderOptions);
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        if (cancelled) return; // discard the partial recording — a cancel saves nothing
        const blob = new Blob(chunks, { type: mimeType });
        download(blob, `syncvoice-export.${ext}`);
        finished = true;
        teardown();
        onComplete();
      };
      cleanups.push(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      });

      const duration = trimEndSec - trimStartSec;
      const startWall = performance.now();

      const draw = () => {
        if (cancelled || finished) return;
        const elapsed = (performance.now() - startWall) / 1000;
        onProgress(Math.min(elapsed / duration, 1));

        if (elapsed >= duration) {
          if (recorder.state !== 'inactive') recorder.stop();
          if (rafId !== null) cancelAnimationFrame(rafId);
          return;
        }

        // Find active clip
        const hit = getClipAtTime(videoClips, elapsed);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        if (hit) {
          const v = renderVids[hit.clip.id];
          if (v) {
            // Seek if drifted; play (muted) so frames decode
            if (Math.abs(v.currentTime - hit.localTime) > 0.2) v.currentTime = hit.localTime;
            if (v.paused) v.play().catch(() => { /* frame decoding is best-effort */ });
            try {
              const g = computeDrawGeometry(preset, v.videoWidth, v.videoHeight);
              ctx.drawImage(v, g.dx, g.dy, g.dWidth, g.dHeight);
            } catch { /* skip frames the video cannot provide yet */ }
          }
        }

        // Draw captions
        if (captionsEnabled && voiceover.segments) {
          const seg = voiceover.segments.find(s => elapsed >= s.start && elapsed <= s.end);
          if (seg) drawCaptionOnCanvas(ctx, W, H, seg.text, captionStyle);
        }

        rafId = requestAnimationFrame(draw);
      };

      cleanups.push(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
      });

      recorder.start(100);
      source.start();
      rafId = requestAnimationFrame(draw);
    } catch (e) {
      console.error('Export failed:', e);
      if (!finished) {
        finished = true;
        teardown();
        onError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  void run();
  return handle;
}

// ── Canvas caption renderer (used during video export recording) ────────────
function drawCaptionOnCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  text: string,
  style: CaptionStyle
) {
  const fontSize = Math.max(16, Math.round(W * 0.032));
  ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center';

  const maxW = W * 0.8;
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return;
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) return;

  const lh = fontSize * 1.35;
  const padX = 20;
  const padY = 10;
  const boxH = lines.length * lh + padY * 2;
  const maxLineWidth = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const boxW = Math.min(maxLineWidth + padX * 2, W - 40);
  const boxX = (W - boxW) / 2;
  const boxY = style.position === 'bottom' ? H - boxH - 32 : 32;

  ctx.fillStyle = style.bgColor;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();

  ctx.fillStyle = style.color;
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, boxY + padY + (i + 0.82) * lh, maxW);
  });
}
