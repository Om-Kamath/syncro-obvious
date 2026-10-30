import { describe, it, expect } from 'vitest';
import { encodeWavFromPcm, WAV_HEADER_SIZE } from './wavEncoder';

const f32 = (values: number[]) => Float32Array.from(values);
const chunkId = (pcm: Uint8Array, offset: number) =>
  String.fromCharCode(pcm[offset], pcm[offset + 1], pcm[offset + 2], pcm[offset + 3]);

describe('encodeWavFromPcm header', () => {
  it('writes a canonical 44-byte RIFF/WAVE PCM header for mono input', () => {
    const pcm = encodeWavFromPcm([f32([0])], 44100);
    const view = new DataView(pcm.buffer);

    expect(pcm.length).toBe(WAV_HEADER_SIZE + 2);
    expect(chunkId(pcm, 0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 2); // riff size = 36 + data size
    expect(chunkId(pcm, 8)).toBe('WAVE');
    expect(chunkId(pcm, 12)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1);  // audio format: PCM
    expect(view.getUint16(22, true)).toBe(1);  // mono
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2);  // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(chunkId(pcm, 36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(2);  // data size: 1 frame × 1 ch × 2 bytes
  });

  it('derives byte rate, block align and data size from rate and channel count', () => {
    const pcm = encodeWavFromPcm([f32([0, 0, 0]), f32([0, 0, 0])], 48000);
    const view = new DataView(pcm.buffer);

    expect(view.getUint16(22, true)).toBe(2);          // stereo
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(48000 * 4);  // byte rate
    expect(view.getUint16(32, true)).toBe(4);          // block align
    expect(view.getUint32(40, true)).toBe(3 * 4);      // data size
  });
});

describe('encodeWavFromPcm samples', () => {
  it('scales, clamps and interleaves stereo frames little-endian', () => {
    const pcm = encodeWavFromPcm([f32([0.5, 2]), f32([-0.5, -2])], 8000);
    const view = new DataView(pcm.buffer);

    // Frame 0: +0.5 → 16383.5 → 16384; −0.5 → −16384
    expect(view.getInt16(44, true)).toBe(16384);
    expect(view.getInt16(46, true)).toBe(-16384);
    // Frame 1: clamped to full-scale (−1 → −32768, +1 → 32767)
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(-32768);
  });

  it('encodes full-scale extremes symmetrically', () => {
    const pcm = encodeWavFromPcm([f32([1, -1, 0.75, -0.25])], 44100);
    const view = new DataView(pcm.buffer);

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(24575); // 0.75 × 32767
    expect(view.getInt16(50, true)).toBe(-8192); // −0.25 × 32768
  });
});

describe('encodeWavFromPcm validation', () => {
  it('rejects zero-channel input', () => {
    expect(() => encodeWavFromPcm([], 44100)).toThrow(/at least one channel/);
  });

  it('rejects mismatched channel lengths', () => {
    expect(() => encodeWavFromPcm([f32([0, 0]), f32([0])], 44100)).toThrow(/same length/);
  });

  it('rejects invalid sample rates', () => {
    expect(() => encodeWavFromPcm([f32([0])], 0)).toThrow(/invalid sample rate/);
    expect(() => encodeWavFromPcm([f32([0])], NaN)).toThrow(/invalid sample rate/);
  });
});
