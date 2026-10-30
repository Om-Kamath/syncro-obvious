// Sample-domain audio mixing for the export audio bus.
// The export path decodes narration and music in ONE AudioContext (decodeAudioData
// resamples both to the context rate), mixes them with the pure functions below,
// and plays the resulting buffer into the recorder's MediaStreamDestination.

export interface AudioSampleView {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

// Structural so the real AudioContext and test doubles both satisfy it.
export interface AudioBufferFactory {
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
}

export interface AudioChannels {
  readonly channels: readonly Float32Array[];
  readonly sampleRate: number;
}

const clampSample = (sample: number): number => (sample < -1 ? -1 : sample > 1 ? 1 : sample);

// Missing channels upmix by reusing the last available one (mono → stereo duplicates ch 0).
const channelAt = (channels: readonly Float32Array[], index: number): Float32Array =>
  channels[Math.min(index, channels.length - 1)];

/**
 * One output channel: narration at 100% plus music scaled by musicGain,
 * clamped to [-1, 1]. Output length is max(narration.length, music.length);
 * the shorter source continues as silence.
 */
export function mixChannel(narration: Float32Array, music: Float32Array, musicGain: number): Float32Array {
  const length = Math.max(narration.length, music.length);
  const mixed = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const narrationSample = i < narration.length ? narration[i] : 0;
    const musicSample = i < music.length ? music[i] * musicGain : 0;
    mixed[i] = clampSample(narrationSample + musicSample);
  }
  return mixed;
}

/** Mix narration with optional music, channel-aware. No music → narration unchanged. */
export function mixAudio(narration: AudioChannels, music: AudioChannels | null, musicGain: number): AudioChannels {
  if (!music) return narration;
  if (narration.sampleRate !== music.sampleRate) {
    throw new Error(`Cannot mix audio: sample rates differ (${narration.sampleRate} vs ${music.sampleRate})`);
  }
  const channelCount = Math.max(narration.channels.length, music.channels.length);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < channelCount; ch++) {
    channels.push(mixChannel(channelAt(narration.channels, ch), channelAt(music.channels, ch), musicGain));
  }
  return { channels, sampleRate: narration.sampleRate };
}

/** Per-channel sample window for source time [fromSec, toSec), clamped to the buffer. */
export function sliceAudioWindow(source: AudioSampleView, fromSec: number, toSec: number): AudioChannels {
  const first = Math.max(0, Math.floor(fromSec * source.sampleRate));
  const last = Math.min(source.length, Math.floor(toSec * source.sampleRate));
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    channels.push(source.getChannelData(ch).subarray(first, last));
  }
  return { channels, sampleRate: source.sampleRate };
}

/** Wrap every channel of a decoded buffer (no copies — views into the buffer). */
export function audioChannelsOf(source: AudioSampleView): AudioChannels {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    channels.push(source.getChannelData(ch));
  }
  return { channels, sampleRate: source.sampleRate };
}

/** Copy mixed channels into a freshly allocated AudioBuffer. */
export function toAudioBuffer(source: AudioChannels, factory: AudioBufferFactory): AudioBuffer {
  const length = source.channels[0]?.length ?? 0;
  const out = factory.createBuffer(source.channels.length, length, source.sampleRate);
  for (let ch = 0; ch < source.channels.length; ch++) {
    out.getChannelData(ch).set(source.channels[ch]);
  }
  return out;
}

// Pure mix-gain model shared by preview playback and the export recorder.
// A gain of 0 means the source contributes silence to the mix.
export type MixSourceKind = 'clip' | 'voiceover';

export interface MixSource {
  readonly id: string;
  readonly kind: MixSourceKind;
}

// The voiceover is the narration bed and always passes through; only the
// source clips (the "original audio") respond to the mute toggle.
export function sourceGain(kind: MixSourceKind, muteOriginalAudio: boolean): number {
  if (kind === 'voiceover') return 1;
  return muteOriginalAudio ? 0 : 1;
}

export function computeMixGains(sources: readonly MixSource[], muteOriginalAudio: boolean): Record<string, number> {
  return Object.fromEntries(sources.map(s => [s.id, sourceGain(s.kind, muteOriginalAudio)]));
}
