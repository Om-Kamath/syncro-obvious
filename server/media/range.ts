/**
 * Byte-range parsing for HTTP Range headers (RFC 9110 §14). Pure so the
 * request handler stays thin and the edge cases stay unit-testable.
 */

export interface ByteRange {
  /** First byte offset, inclusive. */
  start: number;
  /** Last byte offset, inclusive. */
  end: number;
}

/**
 * - `{ start, end }`  — serve a 206 with this single range
 * - `'unsatisfiable'` — syntactically valid header, but no bytes match: 416
 * - `'ignore'`        — header absent, malformed, or multi-range: serve the
 *                       full representation instead (RFC-permitted behavior)
 */
export type RangeParseResult = ByteRange | 'unsatisfiable' | 'ignore';

const BYTES_UNIT = 'bytes=';
// start-end | start- | -suffix ; digits on at least one side
const RANGE_SPEC = /^(\d*)-(\d*)$/;

export function parseRange(header: string | undefined, size: number): RangeParseResult {
  if (!header || !header.startsWith(BYTES_UNIT)) return 'ignore';

  const spec = header.slice(BYTES_UNIT.length);
  // Multi-range requests: <video> never sends them and a single range is all
  // seeking needs; the full representation is a compliant answer.
  const match = RANGE_SPEC.exec(spec);
  if (spec.includes(',') || !match) return 'ignore';

  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return 'ignore'; // "bytes=-" is not a valid range

  if (startRaw === '') {
    // Suffix form "bytes=-N": the final N bytes of the representation.
    const suffixLength = Number(endRaw);
    if (suffixLength === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startRaw);
  if (start >= size) return 'unsatisfiable';
  if (endRaw === '') return { start, end: size - 1 };

  const end = Math.min(Number(endRaw), size - 1);
  if (end < start) return 'ignore'; // "bytes=5-2" is invalid → ignore the header
  return { start, end };
}
