/**
 * Peak normalization for the export audio path.
 *
 * The export records the voiceover element through the Web Audio graph; the
 * gain applied is computed by scanning the decoded audio over the exact
 * window that will be recorded (trim start → trim end), then scaling the
 * loudest sample to the target dBFS ceiling.
 */

/** Target ceiling for peak normalization. −1.0 dBFS is the standard headroom value (avoids inter-sample clipping). */
export const DEFAULT_TARGET_DBFS = -1.0;

/**
 * Upper bound on amplification, in dB. Peak normalization of a near-silent
 * buffer would otherwise multiply the noise floor into the thousands.
 */
export const MAX_NORMALIZATION_GAIN_DB = 12;

/** Minimal AudioBuffer surface this module needs — structural so tests can pass fakes. */
export interface AudioBufferLike {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** Linear amplitude of a dBFS value: amplitude = 10^(dbfs/20). */
export function dbfsToAmplitude(dbfs: number): number {
  return 10 ** (dbfs / 20);
}

/** dBFS of a linear amplitude; null for silence (log of zero is undefined). */
export function amplitudeToDbfs(amplitude: number): number | null {
  if (amplitude <= 0) return null;
  return 20 * Math.log10(amplitude);
}

/** Loudest |sample| across all channel planes. */
export function scanPeak(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const abs = Math.abs(channel[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

/**
 * Linear gain that brings the buffer's peak to `targetDbfs`.
 *
 * Silence returns 1 — there is nothing to scale, and amplifying the noise
 * floor is not normalization. The gain is capped at `maxGainDb` so a
 * near-silent buffer cannot blow up into amplified noise.
 */
export function computeNormalizationGain(
  channels: readonly Float32Array[],
  targetDbfs: number = DEFAULT_TARGET_DBFS,
  maxGainDb: number = MAX_NORMALIZATION_GAIN_DB,
): number {
  const peak = scanPeak(channels);
  if (peak === 0) return 1;
  // A target above 0 dBFS would clip by definition; treat it as full scale.
  const target = dbfsToAmplitude(Math.min(targetDbfs, 0));
  return Math.min(target / peak, dbfsToAmplitude(maxGainDb));
}

/**
 * Channel data restricted to the [trimStart, trimEnd) seconds window — the
 * portion of the audio the export actually records. Values are clamped to
 * the buffer; an empty window yields empty channels (peak 0 → gain 1).
 */
export function trimWindowChannels(
  decoded: AudioBufferLike,
  trimStart: number,
  trimEnd: number,
): Float32Array[] {
  const start = Math.max(0, Math.floor(trimStart * decoded.sampleRate));
  const end = Math.min(decoded.length, Math.ceil(trimEnd * decoded.sampleRate));
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    channels.push(decoded.getChannelData(ch).slice(start, end));
  }
  return channels;
}
