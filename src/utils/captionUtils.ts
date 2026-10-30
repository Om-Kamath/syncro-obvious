import type { CaptionSegment } from '../types';

export type { CaptionSegment };

// Word-level timing for a single spoken word. Structurally the same shape as
// CaptionSegment; the distinct name documents intent at call sites.
export type CaptionWord = { text: string; start: number; end: number };

function pad2(n: number) { return String(Math.floor(n)).padStart(2, '0'); }
function pad3(n: number) { return String(Math.floor(n)).padStart(3, '0'); }

function toSRTTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)},${pad3(ms)}`;
}

function toVTTTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}.${pad3(ms)}`;
}

// Word cues take precedence when real timings exist; segments are the fallback.
function toCues(segments: CaptionSegment[], words?: CaptionWord[]): CaptionSegment[] {
  if (words && words.length > 0) {
    return words
      .map(w => ({ text: w.text.trim(), start: w.start, end: w.end }))
      .filter(w => w.text.length > 0);
  }
  return segments;
}

export function generateSRT(segments: CaptionSegment[], words?: CaptionWord[]): string {
  return toCues(segments, words)
    .map((cue, i) =>
      `${i + 1}\n${toSRTTime(cue.start)} --> ${toSRTTime(cue.end)}\n${cue.text}`
    )
    .join('\n\n');
}

export function generateVTT(segments: CaptionSegment[], words?: CaptionWord[]): string {
  const entries = toCues(segments, words)
    .map(cue => `${toVTTTime(cue.start)} --> ${toVTTTime(cue.end)}\n${cue.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${entries}`;
}

export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
