import { describe, expect, it } from 'vitest';
import {
  audioChannelsOf,
  mixAudio,
  mixChannel,
  sliceAudioWindow,
  toAudioBuffer,
  type AudioBufferFactory,
  type AudioSampleView,
} from './audioMix';

// Binary-exact fixtures (halves and quarters) so sums round-trip exactly in Float32.
const NARRATION = Float32Array.from([0.5, -0.25, 0, 0.75]);
const MUSIC = Float32Array.from([1, 0.5, -1, 0.25]);

function fakeView(channels: number[][], sampleRate: number): AudioSampleView {
  const data = channels.map(c => Float32Array.from(c));
  return {
    numberOfChannels: data.length,
    length: data[0]?.length ?? 0,
    sampleRate,
    getChannelData: ch => data[ch],
  };
}

// Recording double: captures createBuffer calls and serves real Float32 backing
// stores so toAudioBuffer's writes are observable. The only AudioBuffer cast in
// the codebase lives here — the DOM interface needs members beyond what the
// mixing code touches.
interface CreatedBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  data: Float32Array[];
}

function recordingFactory(): AudioBufferFactory & { created: CreatedBuffer[] } {
  const created: CreatedBuffer[] = [];
  return {
    created,
    createBuffer(numberOfChannels, length, sampleRate) {
      const data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      created.push({ numberOfChannels, length, sampleRate, data });
      return {
        numberOfChannels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (ch: number) => data[ch],
      } as unknown as AudioBuffer;
    },
  };
}

describe('mixChannel', () => {
  it('keeps narration at 100% and adds music scaled by the set gain', () => {
    const mixed = mixChannel(NARRATION, MUSIC, 0.25);
    expect(Array.from(mixed)).toEqual([0.75, -0.125, -0.25, 0.8125]);
  });

  it('passes narration through untouched when music gain is 0', () => {
    const mixed = mixChannel(NARRATION, MUSIC, 0);
    expect(Array.from(mixed)).toEqual([0.5, -0.25, 0, 0.75]);
  });

  it('adds music at full volume when gain is 1', () => {
    const mixed = mixChannel(Float32Array.from([0]), Float32Array.from([0.75]), 1);
    expect(mixed[0]).toBeCloseTo(0.75, 6);
  });

  it('clamps the summed sample to [-1, 1]', () => {
    const up = mixChannel(Float32Array.from([0.75]), Float32Array.from([0.75]), 1);
    const down = mixChannel(Float32Array.from([-0.75]), Float32Array.from([-0.75]), 1);
    expect(up[0]).toBe(1);
    expect(down[0]).toBe(-1);
  });

  it('runs to the longer source: music continues under silent narration', () => {
    const narration = Float32Array.from([0.5, -0.25]);
    const music = Float32Array.from([1, 1, 0.5, -1]);
    const mixed = mixChannel(narration, music, 0.5);
    expect(mixed.length).toBe(4);
    expect(Array.from(mixed)).toEqual([1, 0.25, 0.25, -0.5]);
  });

  it('keeps the full narration when music is shorter', () => {
    const mixed = mixChannel(NARRATION, Float32Array.from([1]), 0);
    expect(mixed.length).toBe(NARRATION.length);
    expect(Array.from(mixed)).toEqual([0.5, -0.25, 0, 0.75]);
  });
});

describe('mixAudio', () => {
  const mono = (samples: number[], sampleRate = 48000) => ({
    channels: [Float32Array.from(samples)],
    sampleRate,
  });

  it('throws when sample rates differ instead of mixing misaligned samples', () => {
    expect(() => mixAudio(mono([0.5], 44100), mono([0.5], 48000), 0.5)).toThrow(/sample rates differ/i);
  });

  it('upmixes mono narration into a stereo mix by reusing channel 0', () => {
    const mixed = mixAudio(
      mono([0.5]),
      { channels: [Float32Array.from([1]), Float32Array.from([0])], sampleRate: 48000 },
      0.5,
    );
    expect(mixed.channels.length).toBe(2);
    expect(Array.from(mixed.channels[0])).toEqual([1]);
    expect(Array.from(mixed.channels[1])).toEqual([0.5]);
  });

  it('downmixes mono music onto every channel of stereo narration', () => {
    const mixed = mixAudio(
      { channels: [Float32Array.from([0.5]), Float32Array.from([0.25])], sampleRate: 48000 },
      mono([1], 48000),
      0.5,
    );
    expect(mixed.channels.length).toBe(2);
    expect(Array.from(mixed.channels[0])).toEqual([1]);
    expect(Array.from(mixed.channels[1])).toEqual([0.75]);
  });

  it('returns the narration unchanged when there is no music', () => {
    const narration = mono([0.5, -0.25]);
    const mixed = mixAudio(narration, null, 0.25);
    expect(mixed).toBe(narration);
  });
});

describe('sliceAudioWindow', () => {
  it('extracts the [fromSec, toSec) window per channel', () => {
    const view = fakeView([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]], 10);
    const win = sliceAudioWindow(view, 0.2, 0.7);
    expect(win.sampleRate).toBe(10);
    expect(Array.from(win.channels[0])).toEqual([2, 3, 4, 5, 6]);
    expect(Array.from(win.channels[1])).toEqual([12, 13, 14, 15, 16]);
  });

  it('clamps the window to the buffer length', () => {
    const view = fakeView([[0, 1, 2, 3]], 10);
    const win = sliceAudioWindow(view, 0, 99);
    expect(Array.from(win.channels[0])).toEqual([0, 1, 2, 3]);
  });
});

describe('audioChannelsOf', () => {
  it('wraps every channel of the view without copying', () => {
    const view = fakeView([[1, 2], [3, 4]], 24000);
    const channels = audioChannelsOf(view);
    expect(channels.channels.length).toBe(2);
    expect(channels.sampleRate).toBe(24000);
    expect(channels.channels[0]).toBe(view.getChannelData(0));
  });
});

describe('toAudioBuffer', () => {
  it('allocates a buffer of max channel count and combined length and copies the samples in', () => {
    const factory = recordingFactory();
    const mixed = mixAudio(
      sliceAudioWindow(fakeView([[0.5, -0.25, 0, 0.75]], 48000), 0, 4 / 48000),
      audioChannelsOf(fakeView([[1, 0.5, -1, 0.25, 0.5, 0.5]], 48000)),
      0.25,
    );
    const buf = toAudioBuffer(mixed, factory);

    expect(factory.created).toHaveLength(1);
    expect(factory.created[0]).toMatchObject({ numberOfChannels: 1, length: 6, sampleRate: 48000 });
    expect(Array.from(factory.created[0].data[0])).toEqual([0.75, -0.125, -0.25, 0.8125, 0.125, 0.125]);
    expect(buf.getChannelData(0)).toBe(factory.created[0].data[0]);
  });
});
