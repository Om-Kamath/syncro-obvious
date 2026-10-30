// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CaptionStyleEditor } from './CaptionStyleEditor';
import { DEFAULT_CAPTION_STYLE } from '../utils/captionStyle';
import type { CaptionStyle } from '../types';

afterEach(() => {
  cleanup();
});

function renderEditor(style: CaptionStyle = DEFAULT_CAPTION_STYLE) {
  const onChange = vi.fn();
  render(<CaptionStyleEditor style={style} onChange={onChange} />);
  return { onChange };
}

describe('CaptionStyleEditor', () => {
  it('renders the current style values into its controls', () => {
    const style: CaptionStyle = {
      ...DEFAULT_CAPTION_STYLE,
      fontFamily: 'Georgia, serif',
      fontSize: 24,
      color: '#ffcc00',
      bgColor: '#001100',
      position: 'top',
    };
    renderEditor(style);

    expect((screen.getByLabelText('Font') as HTMLSelectElement).value).toBe('Georgia, serif');
    expect((screen.getByLabelText('Font Size') as HTMLInputElement).value).toBe('24');
    expect((screen.getByLabelText('Text Color') as HTMLInputElement).value).toBe('#ffcc00');
    expect((screen.getByLabelText('Background') as HTMLInputElement).value).toBe('#001100');
    expect(screen.getByRole('button', { name: 'top' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'bottom' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('emits a merged style when the font family changes', () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText('Font'), { target: { value: 'Georgia, serif' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CAPTION_STYLE, fontFamily: 'Georgia, serif' });
  });

  it('emits the font size when the slider moves', () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText('Font Size'), { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CAPTION_STYLE, fontSize: 30 });
  });

  it('emits text and background color changes', () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText('Text Color'), { target: { value: '#ffee00' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_CAPTION_STYLE, color: '#ffee00' });
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#101010' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_CAPTION_STYLE, bgColor: '#101010' });
  });

  it('emits the per-word fill color in word-highlight mode', () => {
    const { onChange } = renderEditor({ ...DEFAULT_CAPTION_STYLE, mode: 'word-highlight' });
    fireEvent.change(screen.getByLabelText('Per-word Fill'), { target: { value: '#ff00aa' } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_CAPTION_STYLE,
      mode: 'word-highlight',
      wordHighlightColor: '#ff00aa',
    });
  });

  it('shows the per-word fill control only in word-highlight mode', () => {
    renderEditor();
    expect(screen.queryByLabelText('Per-word Fill')).toBeNull();
  });

  it('emits position and mode changes from the toggle buttons', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'top' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_CAPTION_STYLE, position: 'top' });
    fireEvent.click(screen.getByRole('button', { name: /Word Highlight/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_CAPTION_STYLE, mode: 'word-highlight' });
  });

  it('keeps an unknown stored font family selectable', () => {
    renderEditor({ ...DEFAULT_CAPTION_STYLE, fontFamily: 'Rubik, sans-serif' });
    const select = screen.getByLabelText('Font') as HTMLSelectElement;
    expect(select.value).toBe('Rubik, sans-serif');
    expect(screen.getByRole('option', { name: 'Rubik' })).toBeDefined();
  });
});
