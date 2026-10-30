import { VideoClip } from '../types';

/**
 * Per-clip audio gain envelope.
 *
 * Syncro is narration-first: clips render as muted visuals and the voiceover is
 * the only audible track, so a clip's fade settings shape the program audio
 * across that clip's span on the timeline. Clips without fades leave the gain
 * neutral (1), which keeps exports byte-identical to the pre-fade behavior.
 */

export interface GainEnvelopeParams {
  /** Seconds since the clip's timeline start. */
  localTime: number;
  /** Seconds the clip occupies on the timeline (trimmedDuration ?? duration). */
  clipDuration: number;
  /** Seconds to ramp the gain linearly from 0 to 1 at the start of the clip. */
  fadeIn?: number;
  /** Seconds to ramp the gain linearly from 1 back to 0 at the end of the clip. */
  fadeOut?: number;
}

/** Linear gain in [0, 1] for a point inside a clip's fade envelope. */
export function computeGainEnvelope({ localTime, clipDuration, fadeIn, fadeOut }: GainEnvelopeParams): number {
  if (!Number.isFinite(localTime) || !Number.isFinite(clipDuration) || clipDuration <= 0) return 0;
  if (localTime < 0 || localTime > clipDuration) return 0;

  // Degenerate fade values (undefined, NaN, negative, zero) mean "no fade": full gain.
  const inSec = fadeIn !== undefined && Number.isFinite(fadeIn) && fadeIn > 0 ? fadeIn : 0;
  const outSec = fadeOut !== undefined && Number.isFinite(fadeOut) && fadeOut > 0 ? fadeOut : 0;

  const gainIn = inSec > 0 ? Math.min(localTime / inSec, 1) : 1;
  const gainOut = outSec > 0 ? Math.min((clipDuration - localTime) / outSec, 1) : 1;
  return Math.min(gainIn, gainOut);
}

/**
 * Seconds input pattern for the fade editor: digits with at most one decimal
 * point (empty string allowed while typing).
 */
export const FADE_SECONDS_INPUT_RE = /^\d*\.?\d*$/;

/**
 * Parse a raw fade-seconds input. Empty, invalid, or non-positive values mean
 * "no fade" and return undefined, matching the clip field's absent default.
 */
export function parseFadeSeconds(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * The clip covering a timeline time, mirroring the preview playback rule in
 * App (highest startTime wins on overlap, trimmedDuration defines the span).
 */
export function activeClipAtTime(
  clips: VideoClip[],
  time: number
): { clip: VideoClip; localTime: number } | null {
  const sorted = [...clips].sort((a, b) => b.startTime - a.startTime);
  const clip = sorted.find(
    c => time >= c.startTime && time < c.startTime + (c.trimmedDuration ?? c.duration)
  );
  return clip ? { clip, localTime: time - clip.startTime } : null;
}

/**
 * Program-audio gain at a timeline time from the clip covering it.
 * Neutral 1 when no clip is active, so gaps keep playing at full volume.
 */
export function programGainAtTime(clips: VideoClip[], time: number): number {
  const hit = activeClipAtTime(clips, time);
  if (!hit) return 1;
  return computeGainEnvelope({
    localTime: hit.localTime,
    clipDuration: hit.clip.trimmedDuration ?? hit.clip.duration,
    fadeIn: hit.clip.fadeIn,
    fadeOut: hit.clip.fadeOut,
  });
}
