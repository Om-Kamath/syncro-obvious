import type { CaptionSegment, Chapter, WordTiming } from '../types';

export type { CaptionSegment };

// Word-level timing for a single spoken word. Structurally the same shape as
// CaptionSegment; the distinct name documents intent at call sites.
export type CaptionWord = { text: string; start: number; end: number };

/** Word- and/or segment-level timestamps carried by a transcription response. */
export interface TranscriptTimestamps {
  words?: WordTiming[];
  segments?: CaptionSegment[];
}

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

/**
 * Formats seconds as a YouTube chapter timestamp: m:ss, or h:mm:ss once the
 * video passes an hour. YouTube's chapter detection requires this "0:00"
 * style — no zero-padded minutes and no hour part unless needed.
 */
export function formatChapterTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${pad2(m)}:${pad2(sec)}`;
  return `${m}:${pad2(sec)}`;
}

/**
 * Renders chapters as a YouTube chapters list — one "m:ss label" line per
 * chapter. YouTube only activates chapters when timestamps are in this style
 * and appear in order, so sort ascending before formatting.
 */
export function generateChaptersTxt(chapters: Chapter[]): string {
  return [...chapters]
    .sort((a, b) => a.time - b.time)
    .map(c => `${formatChapterTime(c.time)} ${c.label.trim()}`)
    .join('\n');
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

// -------------------------------------------------------------------
// Caption timing — real timestamps when the transcription response has
// them, character-proportional estimation otherwise.
// -------------------------------------------------------------------

// Fallback when a response carries no timestamps: split into sentences and
// distribute the total duration proportionally by character count. Mirrors the
// legacy gemini.ts copy exactly (pinned by a differential test) so the service
// can re-point here when it starts requesting real timestamps.
export function estimateSegments(text: string, totalDuration: number): CaptionSegment[] {
  const sentences = (text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]*$/g) ?? [text])
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [{ text, start: 0, end: totalDuration }];

  const totalChars = sentences.reduce((s, t) => s + t.length, 0);
  const segments: CaptionSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < sentences.length; i++) {
    const segDuration = (sentences[i].length / totalChars) * totalDuration;
    const end = i === sentences.length - 1 ? totalDuration : parseFloat((cursor + segDuration).toFixed(3));
    segments.push({ text: sentences[i], start: parseFloat(cursor.toFixed(3)), end });
    cursor = end;
  }
  return segments;
}

// `HH:MM:SS.mmm` / `MM:SS.mmm` / `MM:SS,mmm` / `MM:SS` — hours optional,
// fractional part optional (1–3 digits, WebVTT-style: ".5" means 500 ms).
const TIME_PATTERN = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?`;
const timeRangeRe = new RegExp(`(${TIME_PATTERN})\\s*-->\\s*(${TIME_PATTERN})`);
const tokenRe = /\[([^\]]*)\]|(\S+)/g;

function parseTimestamp(raw: string): number | null {
  const m = raw.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const hours = m[1] !== undefined ? parseInt(m[1], 10) : 0;
  const ms = m[4] !== undefined ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
  return hours * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + ms / 1000;
}

// Parse the inline timestamps Gemini can emit in transcription text:
//   • per-word/phrase bracket markers — "[00:01.250] word [00:01.750] next"
//   • cue-range lines — "00:01.250 --> 00:01.750 words of the cue"
// Bracket markers become word timings (each word ends where the next begins;
// the last word ends at totalDuration). Range lines become segment timings.
// Words before the first marker start at 0; bare sequence-number lines (SRT
// echoes) are ignored. When both forms appear, word timings win (finer
// granularity). Returns null when no timestamp marker appears at all — the
// caller falls back to estimateSegments rather than fabricating timings.
export function parseTimestampedTranscription(raw: string, totalDuration: number): TranscriptTimestamps | null {
  const words: Array<{ word: string; start: number }> = [];
  const segments: CaptionSegment[] = [];
  let markerTime = 0;
  let markerSeen = false;

  for (const line of raw.split('\n')) {
    if (/^\d+$/.test(line.trim())) continue; // SRT sequence-number artifact
    const range = line.match(timeRangeRe);
    if (range) {
      const start = parseTimestamp(range[1]);
      const end = parseTimestamp(range[2]);
      const text = line.replace(timeRangeRe, '').trim();
      if (start !== null && end !== null && end >= start && text) {
        segments.push({ text, start, end });
      }
      continue;
    }
    for (const token of line.matchAll(tokenRe)) {
      if (token[1] !== undefined) {
        const t = parseTimestamp(token[1]);
        if (t !== null) {
          markerTime = t;
          markerSeen = true;
        } else words.push({ word: token[0], start: markerTime }); // "[music]" and friends stay as cue text
      } else {
        words.push({ word: token[2], start: markerTime });
      }
    }
  }

  if (markerSeen && words.length > 0) {
    // Playback order, not document order: markers emitted out of order still
    // yield a monotone, non-overlapping word stream.
    const sorted = [...words].sort((a, b) => a.start - b.start);
    return {
      words: sorted.map((w, i) => ({
        word: w.word,
        start: w.start,
        end: i < sorted.length - 1 ? sorted[i + 1].start : Math.max(w.start, totalDuration),
      })),
    };
  }
  if (segments.length > 0) {
    return { segments: [...segments].sort((a, b) => a.start - b.start) };
  }
  return null;
}

/**
 * Builds caption cues for a transcription: real word timings when available
 * (words are grouped into cues at sentence-ending punctuation, with their
 * WordTiming[] attached — the shape resolveWordTimings consumers already
 * prefer), else real segment timings, else the character-proportional
 * estimate. Cue shape stays compatible with existing CaptionSegment
 * consumers. Structured `timestamps` are trusted as given (words in playback
 * order); parsed-and-sanitized data comes from parseTimestampedTranscription.
 */
export function buildCaptionSegments(
  transcription: string,
  totalDuration: number,
  timestamps?: TranscriptTimestamps | null
): CaptionSegment[] {
  const words = (timestamps?.words ?? []).filter(
    w => typeof w.word === 'string' && Number.isFinite(w.start) && w.start >= 0 && Number.isFinite(w.end) && w.end >= w.start
  );
  if (words.length > 0) return groupWordsIntoCues(words);

  const segments = (timestamps?.segments ?? []).filter(
    s => typeof s.text === 'string' && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start
  );
  if (segments.length > 0) return segments.map(({ text, start, end }) => ({ text, start, end }));

  return estimateSegments(transcription, totalDuration);
}

// Groups a word stream into cues at sentence-ending punctuation — the same
// split points estimateSegments uses. Unpunctuated input yields one cue
// holding every word, mirroring the fallback's single-segment behavior.
function groupWordsIntoCues(words: WordTiming[]): CaptionSegment[] {
  const cues: CaptionSegment[] = [];
  let group: WordTiming[] = [];

  const flush = () => {
    if (group.length === 0) return;
    cues.push({
      text: group.map(w => w.word).join(' '),
      start: group[0].start,
      end: group[group.length - 1].end,
      words: group,
    });
    group = [];
  };

  for (const word of words) {
    group.push(word);
    if (/[.!?]$/.test(word.word)) flush();
  }
  flush();
  return cues;
}
