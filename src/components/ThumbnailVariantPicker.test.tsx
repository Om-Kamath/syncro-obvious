// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThumbnailVariantPicker, type ThumbnailVariantOption } from './ThumbnailVariantPicker';

const VARIANTS: ThumbnailVariantOption[] = [
  { id: 'thumb-0', label: 'Moment one', imageDataUrl: 'data:image/jpeg;base64,AAA', description: 'hook quote' },
  { id: 'thumb-1', label: 'Moment two', imageDataUrl: 'data:image/jpeg;base64,BBB', description: 'payoff quote' },
  { id: 'thumb-2', label: 'Moment three', imageDataUrl: 'data:image/jpeg;base64,CCC' },
];

function renderPicker(overrides: Partial<Parameters<typeof ThumbnailVariantPicker>[0]> = {}) {
  const onSelect = vi.fn();
  const props = {
    variants: VARIANTS,
    selectedId: null,
    onSelect,
    ...overrides,
  };
  const view = render(<ThumbnailVariantPicker {...props} />);
  return { onSelect, ...view };
}

describe('ThumbnailVariantPicker', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders one radio per variant inside a labelled radiogroup', () => {
    renderPicker();
    expect(screen.getByRole('radiogroup', { name: 'Publish thumbnail variants' })).toBeDefined();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(VARIANTS.length);
    expect(screen.getByAltText('Moment one')).toBeDefined();
    expect(screen.getByText('Moment three')).toBeDefined();
  });

  it('shows nothing selected when selectedId is null', () => {
    renderPicker();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('aria-checked')).toBe('false');
    }
    expect(screen.queryByText(/Selected variant is marked/)).toBeNull();
  });

  it('marks only the selected variant as checked', () => {
    renderPicker({ selectedId: 'thumb-1' });
    const radios = screen.getAllByRole('radio');
    expect(radios[0].getAttribute('aria-checked')).toBe('false');
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(radios[2].getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Selected variant is marked/)).toBeDefined();
  });

  it('treats a dangling selectedId (regenerated variants) as no selection', () => {
    renderPicker({ selectedId: 'thumb-gone' });
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('calls onSelect with the clicked variant id', () => {
    const { onSelect } = renderPicker();
    fireEvent.click(screen.getAllByRole('radio')[2]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('thumb-2');
  });

  it('reflects a controlled selection change after re-render', () => {
    const { rerender } = render(
      <ThumbnailVariantPicker variants={VARIANTS} selectedId={null} onSelect={vi.fn()} />,
    );
    rerender(<ThumbnailVariantPicker variants={VARIANTS} selectedId="thumb-0" onSelect={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(radios[1].getAttribute('aria-checked')).toBe('false');
  });

  it('selects the next variant on ArrowRight from a focused radio', () => {
    const { onSelect } = renderPicker({ selectedId: 'thumb-1' });
    const radios = screen.getAllByRole('radio');
    radios[1].focus();
    fireEvent.keyDown(radios[1], { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('thumb-2');
  });

  it('selects the previous variant on ArrowLeft, wrapping from the first', () => {
    const { onSelect } = renderPicker({ selectedId: 'thumb-0' });
    const radios = screen.getAllByRole('radio');
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith('thumb-2');
  });

  it('gives roving tabindex to the selection, or the first radio when none is selected', () => {
    const first = renderPicker();
    const radios = screen.getAllByRole('radio');
    expect(radios[0].getAttribute('tabindex')).toBe('0');
    expect(radios[1].getAttribute('tabindex')).toBe('-1');
    cleanup();

    renderPicker({ selectedId: 'thumb-2' });
    const radiosAfter = screen.getAllByRole('radio');
    expect(radiosAfter[2].getAttribute('tabindex')).toBe('0');
    expect(first.onSelect).not.toHaveBeenCalled();
  });
});
