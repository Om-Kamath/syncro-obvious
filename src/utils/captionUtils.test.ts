import { describe, it, expect } from 'vitest';
import { generateSRT, generateVTT, formatChapterTime, generateChaptersTxt } from './captionUtils';
import type { Chapter } from '../types';

const segments = [
  { text: 'Hello', start: 0, end: 1.5 },
  { text: 'World', start: 61.25, end: 3661 },
];

// Word timings from a transcription pass — one entry per spoken word.
const words = [
  { text: 'Hello', start: 0, end: 0.4 },
  { text: 'cruel', start: 0.4, end: 0.9 },
  { text: 'World', start: 0.9, end: 1.5 },
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

  it('emits one numbered cue per word when word timings are present', () => {
    expect(generateSRT(segments, words)).toBe(
      '1\n00:00:00,000 --> 00:00:00,400\nHello\n\n' +
      '2\n00:00:00,400 --> 00:00:00,900\ncruel\n\n' +
      '3\n00:00:00,900 --> 00:00:01,500\nWorld'
    );
  });

  it('falls back to segment cues for an empty words array', () => {
    expect(generateSRT(segments, [])).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n' +
      '2\n00:01:01,250 --> 01:01:01,000\nWorld'
    );
  });

  it('omitted words behave the same as empty words', () => {
    expect(generateSRT(segments, undefined)).toBe(generateSRT(segments));
  });

  it('trims word text and skips blank words', () => {
    const messy = [
      { text: '  ', start: 0, end: 0.2 },
      { text: ' Hi ', start: 0.2, end: 0.5 },
    ];
    expect(generateSRT([], messy)).toBe('1\n00:00:00,200 --> 00:00:00,500\nHi');
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

  it('emits per-word cues under the header when word timings are present', () => {
    expect(generateVTT(segments, words)).toBe(
      'WEBVTT\n\n' +
      '00:00:00.000 --> 00:00:00.400\nHello\n\n' +
      '00:00:00.400 --> 00:00:00.900\ncruel\n\n' +
      '00:00:00.900 --> 00:00:01.500\nWorld'
    );
  });

  it('falls back to segment cues when words are omitted or empty', () => {
    expect(generateVTT(segments, [])).toBe(generateVTT(segments));
    expect(generateVTT(segments, undefined)).toBe(generateVTT(segments));
  });
});

const chapters: Chapter[] = [
  { time: 0, label: 'Cold open' },
  { time: 125, label: 'The setup' },
  { time: 754, label: 'Deep dive' },
  { time: 3661, label: 'Bonus teardown' },
];

describe('formatChapterTime (YouTube 0:00 style)', () => {
  it('formats the first chapter timestamp as 0:00', () => {
    expect(formatChapterTime(0)).toBe('0:00');
  });

  it('formats sub-hour times as unpadded m:ss', () => {
    expect(formatChapterTime(5)).toBe('0:05');
    expect(formatChapterTime(65)).toBe('1:05');
    expect(formatChapterTime(599)).toBe('9:59');
    expect(formatChapterTime(3599)).toBe('59:59');
  });

  it('switches to h:mm:ss at one hour', () => {
    expect(formatChapterTime(3600)).toBe('1:00:00');
    expect(formatChapterTime(3661)).toBe('1:01:01');
  });

  it('floors fractional seconds', () => {
    expect(formatChapterTime(65.9)).toBe('1:05');
  });
});

describe('generateChaptersTxt', () => {
  it('renders a YouTube chapters fixture, one "m:ss label" line per chapter', () => {
    expect(generateChaptersTxt(chapters)).toBe(
      '0:00 Cold open\n' +
      '2:05 The setup\n' +
      '12:34 Deep dive\n' +
      '1:01:01 Bonus teardown'
    );
  });

  it('sorts chapters ascending — YouTube requires in-order timestamps', () => {
    expect(
      generateChaptersTxt([
        { time: 90, label: 'Middle' },
        { time: 0, label: 'Intro' },
        { time: 30, label: 'Hook' },
      ])
    ).toBe('0:00 Intro\n0:30 Hook\n1:30 Middle');
  });

  it('trims label whitespace and returns an empty string for no chapters', () => {
    expect(generateChaptersTxt([{ time: 0, label: '  Intro  ' }])).toBe('0:00 Intro');
    expect(generateChaptersTxt([])).toBe('');
  });
});
