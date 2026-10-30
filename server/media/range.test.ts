import { describe, expect, it } from 'vitest';
import { parseRange } from './range';

describe('parseRange', () => {
  it.each([
    ['no header', undefined, 10, 'ignore'],
    ['empty header', '', 10, 'ignore'],
    ['bare unit with no spec', 'bytes=', 10, 'ignore'],
    ['different range unit', 'items=0-5', 10, 'ignore'],
    ['multi-range request', 'bytes=0-1,3-4', 10, 'ignore'],
    ['non-numeric spec', 'bytes=abc', 10, 'ignore'],
    ['end before start', 'bytes=5-2', 10, 'ignore'],
    ['extra dash', 'bytes=1-2-3', 10, 'ignore'],
  ])('ignores: %s', (_label, header, size, expected) => {
    expect(parseRange(header, size)).toBe(expected);
  });

  it.each([
    ['start at size', 'bytes=10-', 10],
    ['start beyond size', 'bytes=999-', 10],
    ['open range on empty blob', 'bytes=0-', 0],
    ['suffix range on empty blob', 'bytes=-3', 0],
    ['zero-length suffix', 'bytes=-0', 10],
  ])('responds unsatisfiable: %s', (_label, header, size) => {
    expect(parseRange(header, size)).toBe('unsatisfiable');
  });

  it.each([
    ['open-ended start', 'bytes=0-', 10, { start: 0, end: 9 }],
    ['bounded range', 'bytes=2-5', 10, { start: 2, end: 5 }],
    ['single byte', 'bytes=9-9', 10, { start: 9, end: 9 }],
    ['first byte', 'bytes=0-0', 10, { start: 0, end: 0 }],
    ['end clamped to last byte', 'bytes=8-99', 10, { start: 8, end: 9 }],
    ['suffix shorter than blob', 'bytes=-3', 10, { start: 7, end: 9 }],
    ['suffix longer than blob', 'bytes=-100', 10, { start: 0, end: 9 }],
    ['leading zeros', 'bytes=007-', 10, { start: 7, end: 9 }],
  ])('parses %s into a single byte range', (_label, header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});
