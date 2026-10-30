/**
 * HTTP client for the /api/media blob endpoints. The persistence layer
 * (projectPersistence) depends on this — and tests depend on its transport
 * interface — so the eventual projects API client (campaign PR 26) can absorb
 * these two calls without touching restore logic.
 */

export interface MediaUploadResult {
  readonly id: string;
  readonly size: number;
}

/** 404 from the media API — the saved blob no longer exists. */
export class MediaNotFoundError extends Error {
  readonly status = 404 as const;

  constructor(mediaId: string) {
    super(`Media not found: ${mediaId}`);
    this.name = 'MediaNotFoundError';
  }
}

/** Upload or fetch failed for a non-404 reason (network, 5xx, malformed response). */
export class MediaRequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'MediaRequestError';
    this.status = status;
  }
}

interface MediaUploadResponse {
  id?: unknown;
  size?: unknown;
}

/**
 * Upload a blob, identifying it via the `?filename=` query param so the body
 * stays raw bytes (no multipart dependency). The server prefers the query
 * param over the `x-filename` header, and Express decodes it — arbitrary
 * unicode filenames round-trip exactly.
 */
export async function uploadMediaBlob(
  blob: Blob,
  filename: string,
  mime: string = blob.type || 'application/octet-stream',
): Promise<MediaUploadResult> {
  const params = new URLSearchParams({ filename });
  const res = await fetch(`/api/media?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': mime,
    },
    body: blob,
  });
  if (!res.ok) {
    throw new MediaRequestError(`Media upload failed (${res.status})`, res.status);
  }
  const payload = (await res.json()) as MediaUploadResponse;
  if (typeof payload.id !== 'string' || payload.id.length === 0) {
    throw new MediaRequestError('Media upload response did not include an id', res.status);
  }
  return { id: payload.id, size: typeof payload.size === 'number' ? payload.size : blob.size };
}

/** Fetch a stored blob. 404 maps to MediaNotFoundError so callers can classify missing media. */
export async function fetchMediaBlob(mediaId: string): Promise<Blob> {
  const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}`);
  if (res.status === 404) throw new MediaNotFoundError(mediaId);
  if (!res.ok) {
    throw new MediaRequestError(`Media fetch failed (${res.status})`, res.status);
  }
  return res.blob();
}
