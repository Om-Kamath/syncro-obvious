import { describe, it, expect } from 'vitest';
import { generateSRT, generateVTT } from './captionUtils';

const segments = [
  { text: 'Hello', start: 0, end: 1.5 },
  { text: 'World', start: 61.25, end: 3661 },
];

describe('generateSRT', () => {
  it('formats entries with 1-based numbering and comma millisecond timestamps', () => {
    expect(generateSRT(segments)).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n' +
      '2\n00:01:01,250 --> 01:01:01,000\nWorld'
    );
  });

  it('pads hours, minutes, seconds and milliseconds', () => {
    const out = generateSRT([{ text: 'x', start: 0, end: 0.001 }]);
    expect(out).toBe('1\n00:00:00,000 --> 00:00:00,001\nx');
  });

  it('returns an empty string for no segments', () => {
    expect(generateSRT([])).toBe('');
  });
});

describe('generateVTT', () => {
  it('starts with the WEBVTT header and uses dot millisecond separator', () => {
    expect(generateVTT(segments)).toBe(
      'WEBVTT\n\n' +
      '00:00:00.000 --> 00:00:01.500\nHello\n\n' +
      '00:01:01.250 --> 01:01:01.000\nWorld'
    );
  });

  it('returns a bare header for no segments', () => {
    expect(generateVTT([])).toBe('WEBVTT\n\n');
  });
});
