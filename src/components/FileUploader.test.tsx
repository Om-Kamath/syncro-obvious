// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FileUploader } from './FileUploader';

function renderUploader(overrides: Partial<Parameters<typeof FileUploader>[0]> = {}) {
  const onFilesAdded = vi.fn();
  render(
    <FileUploader
      accept={{ 'video/*': ['.mp4', '.mov', '.webm'] }}
      label="Add Videos"
      onFilesAdded={onFilesAdded}
      {...overrides}
    />
  );
  return { onFilesAdded };
}

describe('FileUploader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the idle hint without a busy state by default', () => {
    renderUploader();

    expect(screen.getByText('Add Videos')).not.toBeNull();
    expect(screen.getByText('Drag & drop or click to select')).not.toBeNull();
    expect(document.querySelector('[aria-busy]')).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('exposes the file input by label', () => {
    renderUploader();

    expect(screen.getByLabelText('Add Videos')).not.toBeNull();
  });

  it('shows a busy state with spinner and status text while importing', () => {
    renderUploader({ busy: true });

    expect(screen.getByText('Importing…')).not.toBeNull();
    expect(screen.getByText('Add Videos')).not.toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });
});
