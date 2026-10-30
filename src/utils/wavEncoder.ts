/**
 * Minimal WAV (RIFF) writer for 16-bit PCM — deliberately dependency-free.
 *
 * `encodeWavFromPcm` is the pure core (unit-testable in Node); `encodeWav`
 * wraps a rendered AudioBuffer for the browser export path.
 */

/** Size in bytes of the canonical 44-byte PCM WAV header. */
export const WAV_HEADER_SIZE = 44;

const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

function writeChunkId(view: DataView, offset: number, id: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, id.charCodeAt(i));
}

/**
 * Interleaves float channels into 16-bit PCM and prepends a canonical WAV header.
 * Channels must share one length; samples are clamped to [-1, 1].
 *
 * Negative samples scale by 0x8000 and positive by 0x7FFF so that ±1 maps to
 * the full int16 range symmetrically (−1 → −32768, +1 → 32767).
 */
export function encodeWavFromPcm(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  if (channels.length === 0) {
    throw new Error('encodeWavFromPcm needs at least one channel');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`encodeWavFromPcm: invalid sample rate ${sampleRate}`);
  }
  const numFrames = channels[0].length;
  if (channels.some(ch => ch.length !== numFrames)) {
    throw new Error('encodeWavFromPcm: all channels must have the same length');
  }

  const numChannels = channels.length;
  const blockAlign = BYTES_PER_SAMPLE * numChannels;
  const dataSize = numFrames * blockAlign;

  const wav = new ArrayBuffer(WAV_HEADER_SIZE + dataSize);
  const view = new DataView(wav);

  writeChunkId(view, 0, 'RIFF');
  view.setUint32(4, WAV_HEADER_SIZE + dataSize - 8, true); // riff chunk size
  writeChunkId(view, 8, 'WAVE');
  writeChunkId(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true);  // audio format: PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeChunkId(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let cursor = WAV_HEADER_SIZE;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const clamped = Math.max(-1, Math.min(1, channels[ch][frame]));
      const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(cursor, Math.round(scaled), true);
      cursor += BYTES_PER_SAMPLE;
    }
  }

  return new Uint8Array(wav);
}

/** Encode a rendered AudioBuffer as a downloadable WAV blob. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
  return new Blob([encodeWavFromPcm(channels, buffer.sampleRate)], { type: 'audio/wav' });
}
