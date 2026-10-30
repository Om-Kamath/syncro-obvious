import { describe, it, expect } from 'vitest';
import { parseTimestamp, parseSRT, parseVTT, parseCaptionFile, segmentsToTranscription } from './captionImport';
import { generateSRT, generateVTT } from './captionUtils';

describe('parseTimestamp', () => {
  it.each([
    ['00:00:01,500', 1.5],
    ['00:00:01.500', 1.5],
    ['01:01:01,250', 3661.25],
    ['01:01:01.250', 3661.25],
    ['02:03.500', 123.5],          // VTT allows omitting hours
    ['00:00:00,001', 0.001],
    ['00:00:01.5', 1.5],           // 1-2 digit milliseconds tolerated
  ])('parses %s to %f seconds', (raw, expected) => {
    expect(parseTimestamp(raw)).toBe(expected);
  });

  it.each([
    ['1:2'],                              // missing milliseconds
    ['00:00:01'],                         // missing milliseconds
    ['aa:00:01,000'],                     // non-numeric field
    ['00:00:60,000'],                     // seconds out of range
    ['00:61:00,000'],                     // minutes out of range
    ['00:00:01,000 --> 00:00:02,000'],    // a whole timing line, not one timestamp
    [''],
  ])('rejects %s', raw => {
    expect(parseTimestamp(raw)).toBeNull();
  });
});

describe('parseSRT', () => {
  it('parses indexed cues with comma millisecond separators', () => {
    const { segments, errors } = parseSRT(
      '1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n' +
      '2\n00:01:00,000 --> 01:01:01,250\nSecond cue'
    );
    expect(errors).toEqual([]);
    expect(segments).toEqual([
      { text: 'Hello there', start: 1, end: 2.5 },
      { text: 'Second cue', start: 60, end: 3661.25 },
    ]);
  });

  it('parses cues without index lines', () => {
    const { segments, errors } = parseSRT('00:00:01,000 --> 00:00:02,000\nNo index');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'No index', start: 1, end: 2 }]);
  });

  it('joins multi-line cue text with spaces', () => {
    const { segments, errors } = parseSRT('1\n00:00:01,000 --> 00:00:02,000\nLine one\nLine two');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'Line one Line two', start: 1, end: 2 }]);
  });

  it('strips inline styling tags from cue text', () => {
    const { segments, errors } = parseSRT('1\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i> <font color="#fff">world</font>');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'Hello world', start: 1, end: 2 }]);
  });

  it('handles CRLF line endings and a leading BOM', () => {
    const { segments, errors } = parseSRT('\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nCRLF cue');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'CRLF cue', start: 1, end: 2 }]);
  });

  it('skips malformed cues and reports them without losing valid ones', () => {
    const { segments, errors } = parseSRT(
      '1\n00:00:01,000 --> 00:00:02,000\nValid cue\n\n' +
      '2\n00:00:05,000 -> 00:00:06,000\nBad arrow\n\n' +
      '3\n00:00:aa,000 --> 00:00:06,000\nBad timestamp\n\n' +
      '4\n00:00:07,000 --> 00:00:06,000\nInverted times\n\n' +
      '5\n00:00:08,000 --> 00:00:09,000\n\n\n' +
      'orphan block with no timing'
    );
    expect(segments).toEqual([{ text: 'Valid cue', start: 1, end: 2 }]);
    expect(errors).toHaveLength(5);
    expect(errors[0]).toContain('cue 2');
    expect(errors[1]).toContain('cue 3');
    expect(errors[2]).toContain('cue 4');
    expect(errors[3]).toContain('cue 5');
    expect(errors[4]).toContain('cue 6');
  });

  it('sorts out-of-order cues by start time', () => {
    const { segments, errors } = parseSRT(
      '1\n00:00:10,000 --> 00:00:11,000\nLater\n\n' +
      '2\n00:00:00,000 --> 00:00:01,000\nEarlier'
    );
    expect(errors).toEqual([]);
    expect(segments.map(s => s.text)).toEqual(['Earlier', 'Later']);
  });

  it('reports an error for a garbage file instead of throwing', () => {
    // An empty file legitimately has nothing to report — zero cues, zero issues.
    expect(parseSRT('')).toEqual({ segments: [], errors: [] });
    const garbage = parseSRT('hello world\nnot a caption file');
    expect(garbage.segments).toEqual([]);
    expect(garbage.errors.length).toBeGreaterThan(0);
  });
});

describe('parseVTT', () => {
  it('parses cues with identifiers and dot millisecond separators', () => {
    const { segments, errors } = parseVTT(
      'WEBVTT\n\n' +
      'intro-cue\n00:00:01.000 --> 00:00:02.500\nHello there\n\n' +
      '00:02:00.000 --> 00:03:00.000\nSecond cue'
    );
    expect(errors).toEqual([]);
    expect(segments).toEqual([
      { text: 'Hello there', start: 1, end: 2.5 },
      { text: 'Second cue', start: 120, end: 180 },
    ]);
  });

  it('parses timestamps without an hours component', () => {
    const { segments, errors } = parseVTT('WEBVTT\n\n01:02.500 --> 01:03.000\nShort clock');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'Short clock', start: 62.5, end: 63 }]);
  });

  it('ignores cue settings after the timing line', () => {
    const { segments, errors } = parseVTT('WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start line:0\nPositioned cue');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'Positioned cue', start: 1, end: 2 }]);
  });

  it('skips NOTE, STYLE and REGION blocks', () => {
    const { segments, errors } = parseVTT(
      'WEBVTT\n\n' +
      'NOTE This is a comment\nspanning lines\n\n' +
      'STYLE\n::cue { color: red }\n\n' +
      'REGION\nid:fred width:40%\n\n' +
      '00:00:01.000 --> 00:00:02.000\nReal cue'
    );
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'Real cue', start: 1, end: 2 }]);
  });

  it('strips VTT voice and timestamp tags from cue text', () => {
    const { segments, errors } = parseVTT('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Speaker>Hello <00:00:01.500><c>world</c>');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'Hello world', start: 1, end: 2 }]);
  });

  it('reports malformed timing lines and garbage files', () => {
    const { segments, errors } = parseVTT('WEBVTT\n\n00:00:aa.000 --> 00:00:02.000\nBad timestamp');
    expect(segments).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('invalid timing line');

    // A single-dash arrow means the line has no cue separator at all.
    const badArrow = parseVTT('WEBVTT\n\n00:00:01.000 -> 00:00:02.000\nBad arrow');
    expect(badArrow.segments).toEqual([]);
    expect(badArrow.errors[0]).toContain('missing timing line');

    const garbage = parseVTT('WEBVTT\n\nno cues in here');
    expect(garbage.segments).toEqual([]);
    expect(garbage.errors.length).toBeGreaterThan(0);
  });
});

describe('parseCaptionFile', () => {
  it('sniffs the WEBVTT header and dispatches to the VTT parser', () => {
    const { segments, errors } = parseCaptionFile('WEBVTT\n\n01:02.500 --> 01:03.000\nVtt cue');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'Vtt cue', start: 62.5, end: 63 }]);
  });

  it('treats files without a WEBVTT header as SRT', () => {
    const { segments, errors } = parseCaptionFile('1\n00:00:01,000 --> 00:00:02,000\nSrt cue');
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ text: 'Srt cue', start: 1, end: 2 }]);
  });
});

describe('round-trip with captionUtils exporters', () => {
  it('parses back what generateSRT emits', () => {
    const original = [
      { text: 'First caption', start: 0, end: 1.5 },
      { text: 'Second caption', start: 61.25, end: 3661 },
    ];
    expect(parseSRT(generateSRT(original)).segments).toEqual(original);
  });

  it('parses back what generateVTT emits', () => {
    const original = [{ text: 'Only caption', start: 0, end: 2 }];
    expect(parseVTT(generateVTT(original)).segments).toEqual(original);
  });
});

describe('segmentsToTranscription', () => {
  it('joins cue texts into a plain transcript', () => {
    expect(segmentsToTranscription([
      { text: 'One', start: 0, end: 1 },
      { text: 'Two', start: 1, end: 2 },
    ])).toBe('One Two');
  });
});
