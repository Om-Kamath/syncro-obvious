import type { VideoClip, Voiceover } from '../types';

/** All sources render into one buffer at this rate; decoded audio resamples to match. */
const MIXDOWN_SAMPLE_RATE = 44_100;

type ClipTiming = Pick<VideoClip, 'startTime' | 'duration' | 'trimmedDuration' | 'trimStart'>;
type VoiceoverTiming = Pick<Voiceover, 'duration' | 'trimStart' | 'trimEnd' | 'startTime'>;

/**
 * Total length of the mixed track: the last audible end across clips and the
 * voiceover. Clip span mirrors chainClips (`trimmedDuration ?? duration`);
 * a lone trimStart (without trimmedDuration) shortens the span so playback
 * never runs past the file end.
 */
export function computeMixdownDuration(clips: readonly ClipTiming[], voiceover: VoiceoverTiming | null): number {
  let end = 0;
  for (const clip of clips) {
    const span = clip.trimmedDuration ?? (clip.duration - (clip.trimStart ?? 0));
    end = Math.max(end, clip.startTime + span);
  }
  if (voiceover) {
    const span = (voiceover.trimEnd ?? voiceover.duration) - (voiceover.trimStart ?? 0);
    end = Math.max(end, (voiceover.startTime ?? 0) + span);
  }
  return Math.max(0, end);
}

export interface MixdownResult {
  buffer: AudioBuffer;
  /** Sources that had no decodable audio and were left out of the mix. */
  skippedSources: string[];
}

interface ScheduledSource {
  audio: AudioBuffer;
  /** Timeline position in seconds. */
  start: number;
  /** Offset into the decoded audio (file trim start). */
  offset: number;
  /** How long the source plays. */
  span: number;
}

/**
 * Renders the project's mixed audio track offline: every clip's audio plus
 * the voiceover, positioned and trimmed exactly like preview/playback
 * (offline rendering — no real-time wall-clock wait like the video export).
 *
 * Sources whose audio cannot be decoded (silent video files, unsupported
 * codecs) are skipped and reported instead of failing the whole export.
 */
export async function mixTimelineAudio(clips: readonly VideoClip[], voiceover: Voiceover | null): Promise<MixdownResult> {
  const duration = computeMixdownDuration(clips, voiceover);

  // Decoding does not depend on the render length — use a scratch context so
  // the render context can be sized after the sources are examined.
  const decodeCtx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: 1,
    sampleRate: MIXDOWN_SAMPLE_RATE,
  });

  const scheduled: ScheduledSource[] = [];
  const skippedSources: string[] = [];

  for (const clip of clips) {
    const span = clip.trimmedDuration ?? (clip.duration - (clip.trimStart ?? 0));
    if (span <= 0) {
      // A zero-span clip occupies no timeline time — it cannot add audio.
      skippedSources.push(clip.name);
      continue;
    }
    try {
      const audio = await decodeAudioData(decodeCtx, await readSourceBytes(clip.file, clip.url));
      scheduled.push({ audio, start: clip.startTime, offset: clip.trimStart ?? 0, span });
    } catch {
      skippedSources.push(clip.name);
    }
  }

  if (voiceover) {
    const span = (voiceover.trimEnd ?? voiceover.duration) - (voiceover.trimStart ?? 0);
    const name = voiceover.file?.name ?? 'voiceover';
    if (span <= 0) {
      skippedSources.push(name);
    } else {
      try {
        const audio = await decodeAudioData(decodeCtx, await readSourceBytes(voiceover.file, voiceover.url));
        scheduled.push({ audio, start: voiceover.startTime ?? 0, offset: voiceover.trimStart ?? 0, span });
      } catch {
        skippedSources.push(name);
      }
    }
  }

  if (scheduled.length === 0) {
    throw new Error(
      skippedSources.length > 0
        ? `Export failed — no sources produced audio. Skipped: ${skippedSources.join(', ')}.`
        : 'Export failed — no sources produced audio.',
    );
  }

  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(duration * MIXDOWN_SAMPLE_RATE),
    sampleRate: MIXDOWN_SAMPLE_RATE,
  });

  for (const { audio, start, offset, span } of scheduled) {
    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(ctx.destination);
    source.start(start, offset, span);
  }

  return { buffer: await ctx.startRendering(), skippedSources };
}

async function readSourceBytes(file: File | undefined, url: string): Promise<ArrayBuffer> {
  if (file) return file.arrayBuffer();
  // AI-generated audio has no File — read its blob URL instead.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to read audio from ${url}`);
  return res.arrayBuffer();
}

function decodeAudioData(ctx: OfflineAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return ctx.decodeAudioData(bytes);
}
