/**
 * Minimal ambient declarations for `gifenc` (the package ships no .d.ts).
 * Only the surface this repo uses is declared.
 *
 * `delay` is milliseconds — gifenc converts to the GIF's centisecond units
 * internally (verified against gifenc 1.0.3 source: `Math.round(delay / 10)`).
 */
declare module 'gifenc' {
  export interface GifEncoderOptions {
    auto?: boolean;
    initialCapacity?: number;
  }

  export interface GifWriteFrameOptions {
    /** Global or local palette: array of [r, g, b] triples. */
    palette?: number[][] | null;
    /** Frame delay in milliseconds. */
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** -1 = play once, 0 = loop forever (default), >0 = repeat count. */
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifWriteFrameOptions): void;
    finish(): void;
    /** Full encoded GIF bytes (copy). Typed over ArrayBuffer so it is a valid BlobPart. */
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: GifEncoderOptions): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean }
  ): number[][];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
  ): Uint8Array;
}
