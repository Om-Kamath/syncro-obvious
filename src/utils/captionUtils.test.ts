import { describe, it, expect } from 'vitest';
import {
  generateSRT,
  generateVTT,
  formatChapterTime,
  generateChaptersTxt,
  estimateSegments,
  parseTimestampedTranscription,
  buildCaptionSegments,
  type TranscriptTimestamps,
} from './captionUtils';
import type { Chapter } from '../types';
// Unmocked on purpose: the module is side-effect-free at import time (the
// Gemini client is constructed lazily), and the differential test below pins
// the utils fallback to the service copy it mirrors.
import { estimateSegments as serviceEstimateSegments } from '../services/gemini';

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

describe('estimateSegments (fallback)', () => {
  it('splits sentences and distributes duration proportionally by character count', () => {
    // "aa." (3 chars) and "bbbbbbbbbb." (11 chars) → 14 total chars over 28s
    expect(estimateSegments('aa. bbbbbbbbbb.', 28)).toEqual([
      { text: 'aa.', start: 0, end: 6 },
      { text: 'bbbbbbbbbb.', start: 6, end: 28 },
    ]);
  });

  it('keeps segments contiguous and ends the last segment exactly at totalDuration', () => {
    const text = 'First sentence here. Second one is longer and takes more time. Done.';
    const result = estimateSegments(text, 30);

    expect(result[0].start).toBe(0);
    expect(result[result.length - 1].end).toBe(30);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].start).toBe(result[i - 1].end);
    }
  });

  it('rounds interior boundaries to 3 decimals while preserving contiguity', () => {
    // 4/6 and 2/6 of 1s → 0.667 (rounded) then exact end at 1
    expect(estimateSegments('aaa. b.', 1)).toEqual([
      { text: 'aaa.', start: 0, end: 0.667 },
      { text: 'b.', start: 0.667, end: 1 },
    ]);
  });

  it('gives a longer sentence a proportionally longer window', () => {
    // "ab." (3 chars) and "cdefghij." (9 chars) → 12 total chars over 24s
    const [shortSeg, longSeg] = estimateSegments('ab. cdefghij.', 24);
    expect(longSeg.end - longSeg.start).toBeGreaterThan(shortSeg.end - shortSeg.start);
    expect(shortSeg.end - shortSeg.start).toBeCloseTo(6, 3);
    expect(longSeg.end - longSeg.start).toBeCloseTo(18, 3);
  });

  it('handles a single sentence spanning the whole duration', () => {
    expect(estimateSegments('only one sentence here', 12)).toEqual([
      { text: 'only one sentence here', start: 0, end: 12 },
    ]);
  });

  it('falls back to a single full-duration segment for empty input', () => {
    expect(estimateSegments('', 8)).toEqual([{ text: '', start: 0, end: 8 }]);
    expect(estimateSegments('   ', 8)).toEqual([{ text: '   ', start: 0, end: 8 }]);
  });

  it('handles text with no sentence punctuation as one segment', () => {
    expect(estimateSegments('just words here', 10)).toEqual([
      { text: 'just words here', start: 0, end: 10 },
    ]);
  });

  it('produces zero-width segments when totalDuration is 0 (degenerate input, no throw)', () => {
    const result = estimateSegments('aa. bbb.', 0);
    expect(result).toHaveLength(2);
    expect(result[result.length - 1].end).toBe(0);
  });
});

describe('parseTimestampedTranscription', () => {
  it('turns bracket markers into word timings; each word ends where the next begins', () => {
    const t = parseTimestampedTranscription('[00:00.000] Hello [00:00.420] world [00:01.100] today', 2);
    expect(t?.words).toEqual([
      { word: 'Hello', start: 0, end: 0.42 },
      { word: 'world', start: 0.42, end: 1.1 },
      { word: 'today', start: 1.1, end: 2 },
    ]);
    expect(t?.segments).toBeUndefined();
  });

  it('starts words that precede the first marker at 0', () => {
    const t = parseTimestampedTranscription('Hello [00:00.500] world', 3);
    expect(t?.words).toEqual([
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'world', start: 0.5, end: 3 },
    ]);
  });

  it('accepts MM:SS, MM:SS,mmm, HH:MM:SS.mmm, and pads short fractions WebVTT-style', () => {
    const t = parseTimestampedTranscription('[0:01] a [1:02,250] b [01:02:03.5] c', 10);
    expect(t?.words?.map(w => w.start)).toEqual([1, 62.25, 3723.5]);
    // Last word starts beyond totalDuration → closes at itself, never negative-width.
    expect(t?.words?.[2]).toEqual({ word: 'c', start: 3723.5, end: 3723.5 });
  });

  it('converts cue-range lines into segment timings', () => {
    const t = parseTimestampedTranscription(
      '00:00.000 --> 00:01.500 Hello there\n00:01.500 --> 00:02.000 more words',
      4
    );
    expect(t?.segments).toEqual([
      { text: 'Hello there', start: 0, end: 1.5 },
      { text: 'more words', start: 1.5, end: 2 },
    ]);
    expect(t?.words).toBeUndefined();
  });

  it('prefers word timings when both markers and range lines appear', () => {
    const t = parseTimestampedTranscription('00:00.000 --> 00:01.500 Hello there\n[00:00.100] word', 4);
    expect(t?.words).toHaveLength(1);
    expect(t?.segments).toBeUndefined();
  });

  it('sorts words into playback order even when markers are emitted out of order', () => {
    const t = parseTimestampedTranscription('[00:02.000] late [00:00.500] early', 5);
    expect(t?.words).toEqual([
      { word: 'early', start: 0.5, end: 2 },
      { word: 'late', start: 2, end: 5 },
    ]);
  });

  it('ignores SRT-style sequence-number lines instead of captioning them', () => {
    const t = parseTimestampedTranscription(
      '1\n00:00.000 --> 00:01.000 Hello\n2\n00:01.000 --> 00:02.000 world',
      3
    );
    expect(t?.segments).toEqual([
      { text: 'Hello', start: 0, end: 1 },
      { text: 'world', start: 1, end: 2 },
    ]);
  });

  it('keeps non-timestamp brackets as literal cue text', () => {
    const t = parseTimestampedTranscription('[music] [00:00.500] hello', 2);
    expect(t?.words?.[0]).toEqual({ word: '[music]', start: 0, end: 0.5 });
    expect(t?.words?.[1]).toEqual({ word: 'hello', start: 0.5, end: 2 });
  });

  it('returns null when the text carries no timestamps', () => {
    expect(parseTimestampedTranscription('plain transcription text', 5)).toBeNull();
    expect(parseTimestampedTranscription('', 5)).toBeNull();
  });

  it('drops range lines whose end precedes their start', () => {
    expect(parseTimestampedTranscription('00:02.000 --> 00:01.000 backwards', 5)).toBeNull();
  });
});

describe('buildCaptionSegments', () => {
  const wordTimings: TranscriptTimestamps = {
    words: [
      { word: 'Hello', start: 0, end: 0.4 },
      { word: 'world.', start: 0.4, end: 1 },
      { word: 'Big', start: 1, end: 1.3 },
      { word: 'news!', start: 1.3, end: 2 },
    ],
  };

  it('groups word timings into cues at sentence punctuation with words attached', () => {
    const cues = buildCaptionSegments('Hello world. Big news!', 2, wordTimings);
    expect(cues).toEqual([
      {
        text: 'Hello world.',
        start: 0,
        end: 1,
        words: [
          { word: 'Hello', start: 0, end: 0.4 },
          { word: 'world.', start: 0.4, end: 1 },
        ],
      },
      {
        text: 'Big news!',
        start: 1,
        end: 2,
        words: [
          { word: 'Big', start: 1, end: 1.3 },
          { word: 'news!', start: 1.3, end: 2 },
        ],
      },
    ]);
  });

  it('keeps unpunctuated words as a single cue spanning all words', () => {
    const cues = buildCaptionSegments('just words', 2, {
      words: [
        { word: 'just', start: 0.25, end: 0.5 },
        { word: 'words', start: 0.5, end: 1.75 },
      ],
    });
    expect(cues).toEqual([
      { text: 'just words', start: 0.25, end: 1.75, words: expect.any(Array) },
    ]);
  });

  it('uses real segment timings when only segments are provided', () => {
    const cues = buildCaptionSegments('Hello world.', 2, {
      segments: [{ text: 'Hello world.', start: 0.2, end: 1.9 }],
    });
    expect(cues).toEqual([{ text: 'Hello world.', start: 0.2, end: 1.9 }]);
  });

  it('falls back to the character-proportional estimate without timestamps', () => {
    const expected = estimateSegments('aa. bbbbbbbbbb.', 28);
    expect(buildCaptionSegments('aa. bbbbbbbbbb.', 28, undefined)).toEqual(expected);
    expect(buildCaptionSegments('aa. bbbbbbbbbb.', 28, null)).toEqual(expected);
  });

  it('falls back when the provided words are all invalid', () => {
    const expected = estimateSegments('aa. b.', 4);
    expect(buildCaptionSegments('aa. b.', 4, { words: [{ word: 'x', start: Number.NaN, end: 1 }] })).toEqual(expected);
    expect(buildCaptionSegments('aa. b.', 4, { words: [{ word: 'x', start: -1, end: 0 }] })).toEqual(expected);
    expect(buildCaptionSegments('aa. b.', 4, { words: [] })).toEqual(expected);
  });

  it('falls back when provided segment timings are invalid', () => {
    const expected = estimateSegments('aa. b.', 4);
    expect(buildCaptionSegments('aa. b.', 4, { segments: [{ text: 'x', start: 2, end: 1 }] })).toEqual(expected);
  });

  it('the fallback path carries no words property', () => {
    const cues = buildCaptionSegments('aa. b.', 4);
    expect(cues.every(c => c.words === undefined)).toBe(true);
  });

  it('pins the fallback to the legacy service implementation it mirrors', () => {
    const corpus = [
      'aa. bbbbbbbbbb.',
      'just words here',
      '',
      '   ',
      'aaa. b.',
      'First sentence here. Second one is longer and takes more time. Done.',
      'Multiple!!! Punctuation??? Marks.',
      'ends without dot',
      'a.b.c. d. e',
      'Numbered 1. Two. Three!',
    ];
    for (const text of corpus) {
      for (const dur of [0, 1, 8, 30, 61.25]) {
        expect(estimateSegments(text, dur)).toEqual(serviceEstimateSegments(text, dur));
      }
    }
  });

  it('feeds real-timing cues straight into SRT generation', () => {
    const cues = buildCaptionSegments('Hello world. Big news!', 2, wordTimings);
    expect(generateSRT(cues)).toBe(
      '1\n00:00:00,000 --> 00:00:01,000\nHello world.\n\n' +
      '2\n00:00:01,000 --> 00:00:02,000\nBig news!'
    );
  });
});
