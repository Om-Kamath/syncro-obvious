// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThumbnailCompareGrid } from './ThumbnailCompareGrid';
import { generateVariantSpecs, type ThumbnailMomentVariants } from '../utils/thumbnailVariants';

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

function makeMoment(id: string, timestamp: number, variantCount: number): ThumbnailMomentVariants {
  return {
    id,
    timestamp,
    quote: `Quote for ${id}`,
    reason: `Why ${id} matters`,
    variants: generateVariantSpecs(variantCount).map(spec => ({
      label: spec.label,
      imageDataUrl: PIXEL,
      description: `${spec.crop.zoom}x ${spec.crop.anchorY} ${spec.overlay}`,
    })),
  };
}

describe('ThumbnailCompareGrid', () => {
  afterEach(cleanup);

  it('renders nothing when there are no moments', () => {
    const { container } = render(<ThumbnailCompareGrid moments={[]} />);
    expect(container.children).toHaveLength(0);
  });

  it('renders one compare section per key moment with its quote and reason', () => {
    const moments = [
      makeMoment('thumb-0', 12, 2),
      makeMoment('thumb-1', 75, 2),
    ];
    render(<ThumbnailCompareGrid moments={moments} />);

    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getByText('"Quote for thumb-0"')).toBeDefined();
    expect(screen.getByText('"Quote for thumb-1"')).toBeDefined();
    expect(screen.getByText('Why thumb-0 matters')).toBeDefined();
  });

  it('renders every variant card with label, description, and image', () => {
    render(<ThumbnailCompareGrid moments={[makeMoment('thumb-0', 12, 4)]} />);

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(4);
    const specs = generateVariantSpecs(4);
    for (const spec of specs) {
      const description = `${spec.crop.zoom}x ${spec.crop.anchorY} ${spec.overlay}`;
      expect(screen.getByText(description)).toBeDefined();
      expect(screen.getByAltText(new RegExp(`Variant ${spec.label}:`))).toBeDefined();
    }
  });

  it('offers a download per variant', () => {
    const moments = [makeMoment('thumb-0', 12, 2), makeMoment('thumb-1', 75, 1)];
    render(<ThumbnailCompareGrid moments={moments} />);

    // Every moment starts at variant A, so "Download A" appears once per moment.
    expect(screen.getAllByRole('button', { name: 'Download A' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Download B' })).toBeDefined();
  });
});
