/**
 * Export format (container + codec) options and mimeType selection for the
 * canvas/MediaRecorder exporter.
 *
 * Pure logic — browser support is probed through an injected predicate, so the
 * fallback order is unit-testable without a MediaRecorder global.
 */

export type ExportCodecId = 'webm' | 'mp4';

export interface MimeTypeCandidate {
  mimeType: string;
  /** Human label of the exact format, e.g. "WebM · VP9". */
  label: string;
}

export interface ExportCodec {
  id: ExportCodecId;
  label: string;
  description: string;
  /** File extension recorded by this container. */
  ext: ExportCodecId;
  /** Ordered best-first mimeType candidates for MediaRecorder. */
  candidates: readonly MimeTypeCandidate[];
}

export const EXPORT_CODECS: Record<ExportCodecId, ExportCodec> = {
  webm: {
    id: 'webm',
    label: 'WebM',
    description: 'VP9 · widest support',
    ext: 'webm',
    candidates: [
      { mimeType: 'video/webm;codecs=vp9', label: 'WebM · VP9' },
      { mimeType: 'video/webm;codecs=vp8', label: 'WebM · VP8' },
      { mimeType: 'video/webm', label: 'WebM' },
    ],
  },
  mp4: {
    id: 'mp4',
    label: 'MP4',
    description: 'H.264 · where supported',
    ext: 'mp4',
    candidates: [
      { mimeType: 'video/mp4;codecs=avc1', label: 'MP4 · H.264' },
      { mimeType: 'video/mp4;codecs=h264', label: 'MP4 · H.264' },
      { mimeType: 'video/mp4', label: 'MP4' },
    ],
  },
};

/** MP4 keeps the historical default so untouched exports behave exactly as before. */
export const DEFAULT_EXPORT_CODEC: ExportCodecId = 'mp4';

export interface MimeTypeSelection {
  mimeType: string;
  label: string;
  ext: ExportCodecId;
  /** Container family actually used — differs from `requested` only on cross-container fallback. */
  codec: ExportCodecId;
  /** Container family the user asked for. */
  requested: ExportCodecId;
}

/** Last resort when no candidate of either container probes as supported. */
const HARD_FALLBACK: Omit<MimeTypeSelection, 'requested'> = {
  mimeType: 'video/webm',
  label: 'WebM',
  ext: 'webm',
  codec: 'webm',
};

/**
 * Pick the first supported mimeType for the requested codec family, walking its
 * candidate list best-first (codec-qualified strings before the bare container).
 * If the whole container is unsupported, gracefully falls back to the other
 * container's list; if nothing probes as supported, returns bare WebM —
 * MediaRecorder construction then surfaces the real error to the export flow.
 */
export function selectMimeType(
  requested: ExportCodecId,
  isSupported: (mimeType: string) => boolean
): MimeTypeSelection {
  const other: ExportCodecId = requested === 'webm' ? 'mp4' : 'webm';
  const ordered = [EXPORT_CODECS[requested], EXPORT_CODECS[other]];

  for (const codec of ordered) {
    for (const candidate of codec.candidates) {
      if (isSupported(candidate.mimeType)) {
        return {
          mimeType: candidate.mimeType,
          label: candidate.label,
          ext: codec.ext,
          codec: codec.id,
          requested,
        };
      }
    }
  }
  return { ...HARD_FALLBACK, requested };
}
