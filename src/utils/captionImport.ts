import type { CaptionSegment } from './captionUtils';

export type CueFormat = 'srt' | 'vtt';

export interface CaptionParseResult {
  segments: CaptionSegment[];
  errors: string[];
}

// Accepts "HH:MM:SS,mmm" (SRT), "HH:MM:SS.mmm" and "MM:SS.mmm" (VTT), with
// either decimal separator and 1-3 millisecond digits — real-world files mix these.
const TIMESTAMP_RE = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/;

export function parseTimestamp(raw: string): number | null {
  const match = TIMESTAMP_RE.exec(raw.trim());
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const ms = Number(match[4].padEnd(3, '0'));
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

// Cues are separated by blank lines; text lines themselves are never blank in
// either format. A `\uFEFF` BOM precedes the first cue index on Windows-authored files.
function toBlocks(content: string): string[] {
  return content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map(block => block.trim())
    .filter(Boolean);
}

// VTT reserved block types that carry no cues; SRT has no reserved words.
function isNonCueBlock(block: string, format: CueFormat): boolean {
  if (format !== 'vtt') return false;
  const firstLine = block.split('\n', 1)[0] ?? '';
  return firstLine.startsWith('WEBVTT') || /^(NOTE|STYLE|REGION)\b/.test(firstLine);
}

function parseTimingLine(line: string): { start: number; end: number } | null {
  const parts = line.split('-->');
  if (parts.length !== 2) return null;
  // Trailing cue settings (VTT "align:start line:0", SRT "X1:.. X2:..") are ignored.
  const endToken = parts[1].trim().split(/\s+/)[0] ?? '';
  const start = parseTimestamp(parts[0]);
  const end = parseTimestamp(endToken);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function parseCueBlocks(content: string, format: CueFormat): CaptionParseResult {
  const segments: CaptionSegment[] = [];
  const errors: string[] = [];
  const blocks = toBlocks(content);

  blocks.forEach((block, blockIdx) => {
    const cueNumber = blockIdx + 1;
    if (isNonCueBlock(block, format)) return;

    const lines = block.split('\n');
    const arrowIdx = lines.findIndex(line => line.includes('-->'));
    if (arrowIdx === -1) {
      errors.push(`cue ${cueNumber}: missing timing line`);
      return;
    }

    const timing = parseTimingLine(lines[arrowIdx]);
    if (!timing) {
      errors.push(`cue ${cueNumber}: invalid timing line "${lines[arrowIdx].trim()}"`);
      return;
    }

    // Strip inline tags: SRT styling (<i>, <font ...>) and VTT voice/timestamp tags (<v Name>, <00:00:01.000><c>).
    const text = lines
      .slice(arrowIdx + 1)
      .map(line => line.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean)
      .join(' ');
    if (!text) {
      errors.push(`cue ${cueNumber}: no caption text`);
      return;
    }

    segments.push({ text, ...timing });
  });

  segments.sort((a, b) => a.start - b.start);
  return { segments, errors };
}

export function parseSRT(content: string): CaptionParseResult {
  return parseCueBlocks(content, 'srt');
}

export function parseVTT(content: string): CaptionParseResult {
  return parseCueBlocks(content, 'vtt');
}

// Format-agnostic entry point: a WEBVTT header means VTT, anything else is
// treated as SRT (the more forgiving block shape is identical otherwise).
export function parseCaptionFile(content: string): CaptionParseResult {
  const firstLine = content.replace(/^\uFEFF/, '').trimStart().split('\n', 1)[0] ?? '';
  return firstLine.startsWith('WEBVTT') ? parseVTT(content) : parseSRT(content);
}

// Rebuilds a plain-text transcript from cue texts — used when an imported file
// replaces the AI transcription, so description/thumbnail generation keeps working.
export function segmentsToTranscription(segments: CaptionSegment[]): string {
  return segments.map(seg => seg.text).join(' ');
}

