import { describe, it, expect } from 'vitest';
import {
  generateVariantSpecs,
  describeVariant,
  MAX_VARIANT_COUNT,
  DEFAULT_VARIANT_COUNT,
  VARIANT_COUNT_OPTIONS,
} from './thumbnailVariants';

describe('generateVariantSpecs', () => {
  it('returns the default A/B pair in catalog order', () => {
    const specs = generateVariantSpecs(DEFAULT_VARIANT_COUNT);
    expect(specs.map(s => s.label)).toEqual(['A', 'B']);
  });

  it('returns one spec for count 1', () => {
    expect(generateVariantSpecs(1)).toHaveLength(1);
  });

  it('returns an empty plan for zero, negative, and non-finite counts', () => {
    expect(generateVariantSpecs(0)).toEqual([]);
    expect(generateVariantSpecs(-2)).toEqual([]);
    expect(generateVariantSpecs(Number.NaN)).toEqual([]);
    expect(generateVariantSpecs(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('clamps counts beyond the catalog instead of repeating variants', () => {
    const specs = generateVariantSpecs(MAX_VARIANT_COUNT + 10);
    expect(specs).toHaveLength(MAX_VARIANT_COUNT);
    expect(generateVariantSpecs(2.7)).toHaveLength(2); // fractional counts floor
  });

  it('produces distinct variants — every (crop, overlay) pair is unique', () => {
    const specs = generateVariantSpecs(MAX_VARIANT_COUNT);
    const keys = specs.map(s => `${s.crop.zoom}:${s.crop.anchorY}:${s.overlay}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('labels variants with sequential letters starting at A', () => {
    const specs = generateVariantSpecs(MAX_VARIANT_COUNT);
    expect(specs.map(s => s.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps variant A as the classic look: full frame with a bottom quote', () => {
    const [first] = generateVariantSpecs(1);
    expect(first).toBeDefined();
    expect(first!.crop).toEqual({ zoom: 1, anchorY: 'center' });
    expect(first!.overlay).toBe('bottom');
  });

  it('is deterministic — same count, same plan', () => {
    expect(generateVariantSpecs(3)).toEqual(generateVariantSpecs(3));
  });

  it('exposes UI count options within catalog bounds', () => {
    for (const n of VARIANT_COUNT_OPTIONS) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(MAX_VARIANT_COUNT);
      expect(generateVariantSpecs(n)).toHaveLength(n);
    }
  });
});

describe('describeVariant', () => {
  it('describes each catalog entry in creator terms', () => {
    const specs = generateVariantSpecs(MAX_VARIANT_COUNT);
    expect(describeVariant(specs[0])).toBe('Full frame · quote at bottom');
    expect(describeVariant(specs[1])).toBe('Punch-in · no quote');
    expect(describeVariant(specs[2])).toBe('Punch-in, framed high · quote at top');
    expect(describeVariant(specs[3])).toBe('Punch-in, framed low · quote at bottom');
  });
});
