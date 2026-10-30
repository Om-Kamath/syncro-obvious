import { addQuoteOverlay } from './exportUtils';

/**
 * A/B thumbnail variants.
 *
 * `generateVariantSpecs` and `describeVariant` are pure so the variant plan is
 * unit-testable without a canvas; `applyThumbnailVariant` is the canvas glue
 * that renders one captured frame into a concrete variant image.
 */

/** How a captured frame is cropped. `zoom` > 1 punches in; `anchorY` picks the kept region. */
export interface ThumbnailCrop {
  zoom: number;
  anchorY: 'top' | 'center' | 'bottom';
}

/** Where the quote overlay sits, or `'none'` for a clean frame. */
export type ThumbnailOverlayPosition = 'bottom' | 'top' | 'none';

export interface ThumbnailVariantSpec {
  /** Variant letter shown in the compare grid (A, B, C…). */
  label: string;
  crop: ThumbnailCrop;
  overlay: ThumbnailOverlayPosition;
}

/** One rendered variant of a key moment, ready for the compare grid. */
export interface ThumbnailVariant {
  label: string;
  imageDataUrl: string;
  description: string;
}

/** A key moment plus its rendered variants. */
export interface ThumbnailMomentVariants {
  id: string;
  timestamp: number;
  quote: string;
  reason: string;
  variants: ThumbnailVariant[];
}

/**
 * Fixed catalog of distinct crop/overlay combinations. Variants must stay
 * visually distinct — each entry differs from the others in crop or overlay.
 */
const VARIANT_CATALOG: ThumbnailVariantSpec[] = [
  { label: 'A', crop: { zoom: 1, anchorY: 'center' }, overlay: 'bottom' },
  { label: 'B', crop: { zoom: 1.2, anchorY: 'center' }, overlay: 'none' },
  { label: 'C', crop: { zoom: 1.2, anchorY: 'top' }, overlay: 'top' },
  { label: 'D', crop: { zoom: 1.2, anchorY: 'bottom' }, overlay: 'bottom' },
];

export const MAX_VARIANT_COUNT = VARIANT_CATALOG.length;
export const DEFAULT_VARIANT_COUNT = 2;
export const VARIANT_COUNT_OPTIONS = [2, 3, 4];

/**
 * Return the first `count` variant specs. Non-positive or non-finite counts
 * yield an empty plan; counts beyond the catalog are clamped — the catalog has
 * no filler entries, so N > MAX cannot produce distinct variants.
 */
export function generateVariantSpecs(count: number): ThumbnailVariantSpec[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  return VARIANT_CATALOG.slice(0, Math.min(Math.floor(count), MAX_VARIANT_COUNT));
}

/** Human-readable one-liner for a spec, shown under each variant in the grid. */
export function describeVariant(spec: ThumbnailVariantSpec): string {
  const cropPart =
    spec.crop.zoom === 1
      ? 'Full frame'
      : spec.crop.anchorY === 'top'
        ? 'Punch-in, framed high'
        : spec.crop.anchorY === 'bottom'
          ? 'Punch-in, framed low'
          : 'Punch-in';
  const overlayPart =
    spec.overlay === 'none'
      ? 'no quote'
      : spec.overlay === 'top'
        ? 'quote at top'
        : 'quote at bottom';
  return `${cropPart} · ${overlayPart}`;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Failed to load image for variant'));
    img.onload = () => resolve(img);
    img.src = dataUrl;
  });
}

/** Render the crop portion of a spec: punch in around the anchored region. */
async function cropFrame(baseFrame: string, crop: ThumbnailCrop): Promise<string> {
  if (crop.zoom === 1) return baseFrame;

  const img = await loadImage(baseFrame);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  const sw = img.width / crop.zoom;
  const sh = img.height / crop.zoom;
  const sx = (img.width - sw) / 2;
  const sy =
    crop.anchorY === 'top' ? 0 : crop.anchorY === 'bottom' ? img.height - sh : (img.height - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.93);
}

/**
 * Render one variant of a captured frame: crop first, then the quote overlay
 * (unless the spec opts out). Rejects if the base frame is unusable.
 */
export async function applyThumbnailVariant(
  baseFrame: string,
  spec: ThumbnailVariantSpec,
  quote: string
): Promise<ThumbnailVariant> {
  const cropped = await cropFrame(baseFrame, spec.crop);
  const imageDataUrl =
    spec.overlay === 'none' ? cropped : await addQuoteOverlay(cropped, quote, spec.overlay);
  return { label: spec.label, imageDataUrl, description: describeVariant(spec) };
}
