// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import { MediaDropLayer } from './MediaDropLayer';
import { Toast, type ToastState } from './Toast';

const file = (name: string, type: string) => new File(['x'], name, { type });

function fireWindowDragEvent(type: string, transfer: Record<string, unknown>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  // act(): the layer's window listeners call setState, which React flushes
  // asynchronously outside its own event system.
  act(() => { window.dispatchEvent(event); });
  return event;
}

describe('MediaDropLayer', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('dispatches dropped files to the import handler by media kind', () => {
    const onImport = vi.fn();
    const onRejected = vi.fn();
    render(<MediaDropLayer onImport={onImport} onRejected={onRejected} />);

    const mp4 = file('clip.mp4', 'video/mp4');
    const mp3 = file('voice.mp3', 'audio/mpeg');
    const png = file('thumb.png', 'image/png');
    fireWindowDragEvent('drop', { types: ['Files'], files: [mp4, mp3, png] });

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith({ videos: [mp4], audios: [mp3], images: [png] });
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('routes unsupported types to the rejection handler and shows an error toast', () => {
    const onImport = vi.fn();

    // Harness mirrors the App wiring: rejections become an error toast.
    function Harness() {
      const [toast, setToast] = useState<ToastState | null>(null);
      return (
        <>
          <MediaDropLayer
            onImport={onImport}
            onRejected={(files) =>
              setToast({
                kind: 'error',
                message: `Unsupported file type: ${files.map((f) => f.name).join(', ')}. Drop video, audio, or image files.`,
              })
            }
          />
          <Toast toast={toast} onDismiss={() => setToast(null)} />
        </>
      );
    }
    render(<Harness />);

    const pdf = file('deck.pdf', 'application/pdf');
    fireWindowDragEvent('drop', { types: ['Files'], files: [pdf] });

    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Unsupported file type: deck.pdf');
  });

  it('still imports the supported subset of a mixed drop', () => {
    const onImport = vi.fn();
    const onRejected = vi.fn();
    render(<MediaDropLayer onImport={onImport} onRejected={onRejected} />);

    const mp4 = file('clip.mp4', 'video/mp4');
    const exe = file('virus.exe', 'application/x-msdownload');
    fireWindowDragEvent('drop', { types: ['Files'], files: [mp4, exe] });

    expect(onImport).toHaveBeenCalledWith({ videos: [mp4], audios: [], images: [] });
    expect(onRejected).toHaveBeenCalledWith([exe]);
  });

  it('shows the drag overlay while files are dragged over the window and hides it on drop', () => {
    render(<MediaDropLayer onImport={vi.fn()} />);

    expect(screen.queryByText('Drop media to import')).toBeNull();
    fireWindowDragEvent('dragenter', { types: ['Files'], files: [] });
    expect(screen.getByText('Drop media to import')).toBeDefined();

    fireWindowDragEvent('drop', { types: ['Files'], files: [file('clip.mp4', 'video/mp4')] });
    expect(screen.queryByText('Drop media to import')).toBeNull();
  });

  it('ignores drag events that carry no files', () => {
    const onImport = vi.fn();
    const onRejected = vi.fn();
    render(<MediaDropLayer onImport={onImport} onRejected={onRejected} />);

    fireWindowDragEvent('dragenter', { types: ['text/plain'] });
    fireWindowDragEvent('drop', { types: ['text/plain'], files: [] });

    expect(screen.queryByText('Drop media to import')).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('ignores drops aimed at a per-uploader dropzone', () => {
    const onImport = vi.fn();
    const onRejected = vi.fn();
    render(
      <>
        <div data-media-dropzone="true">
          <button>uploader zone</button>
        </div>
        <MediaDropLayer onImport={onImport} onRejected={onRejected} />
      </>
    );

    const dropTarget = screen.getByRole('button', { name: 'uploader zone' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files: [file('clip.mp4', 'video/mp4')] },
    });
    Object.defineProperty(event, 'target', { value: dropTarget });
    act(() => { window.dispatchEvent(event); });

    expect(onImport).not.toHaveBeenCalled();
    expect(onRejected).not.toHaveBeenCalled();
  });
});
