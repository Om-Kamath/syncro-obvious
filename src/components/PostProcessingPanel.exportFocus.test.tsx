// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ExportTab } from './PostProcessingPanel';
import { MusicPanel } from './MusicPanel';
import type { VideoClip, Voiceover, CaptionStyle } from '../types';

// Keyboard users must get a visible focus indicator on every export
// settings control: each carries the app-wide :focus-visible ring
// (the same convention the timeline controls use).
const FOCUS_RING_CLASSES = [
  'focus:outline-none',
  'focus-visible:ring-2',
  'focus-visible:ring-violet-500',
  'focus-visible:ring-offset-1',
] as const;

const captionStyle: CaptionStyle = {
  mode: 'lower-third',
  fontSize: 18,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
};

const voiceover: Voiceover = {
  url: 'blob:voiceover',
  duration: 8,
  transcription: 'We hiked the ridge at dawn.',
  segments: [{ text: 'We hiked the ridge at dawn.', start: 0, end: 4 }],
  startTime: 0,
};

function clip(): VideoClip {
  return {
    id: 'clip-1',
    name: 'clip.mp4',
    file: new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
    url: 'blob:clip',
    duration: 10,
    startTime: 0,
  };
}

function expectFocusRing(el: HTMLElement) {
  for (const cls of FOCUS_RING_CLASSES) {
    expect(el.className).toContain(cls);
  }
}

function renderExportTab() {
  return render(
    <ExportTab
      voiceover={voiceover}
      videoClips={[clip()]}
      captionStyle={captionStyle}
      captionsEnabled={false}
    />
  );
}

describe('export settings focus visibility', () => {
  afterEach(() => {
    cleanup();
  });

  it('every export settings control carries the :focus-visible ring', () => {
    renderExportTab();

    // Asset + caption download buttons.
    for (const download of screen.getAllByRole('button', { name: 'Download' })) {
      expectFocusRing(download);
    }
    expectFocusRing(screen.getByRole('button', { name: 'SRT Captions' }));
    expectFocusRing(screen.getByRole('button', { name: 'VTT Captions' }));

    // Music, aspect preset, and format controls.
    expectFocusRing(screen.getByRole('button', { name: /Add music track/ }));
    for (const name of [/16:9/, /9:16/, /1:1/, /WebM/, /MP4/]) {
      expectFocusRing(screen.getByRole('button', { name }));
    }

    // The primary action.
    expectFocusRing(screen.getByRole('button', { name: /Start Export/ }));
  });

  it('keyboard focus lands on the export settings controls', () => {
    renderExportTab();

    const preset = screen.getByRole('button', { name: /9:16/ });
    preset.focus();
    expect(document.activeElement).toBe(preset);
    expectFocusRing(preset);

    const startExport = screen.getByRole('button', { name: /Start Export/ });
    startExport.focus();
    expect(document.activeElement).toBe(startExport);
    expectFocusRing(startExport);
  });

  it('music panel controls carry the ring once a track is picked', () => {
    render(
      <MusicPanel
        file={new File(['x'], 'music.mp3', { type: 'audio/mpeg' })}
        volume={0.5}
        onFileChange={() => {}}
        onVolumeChange={() => {}}
      />
    );

    const remove = screen.getByRole('button', { name: 'Remove background music' });
    expectFocusRing(remove);

    const slider = screen.getByRole('slider', { name: 'Background music volume' });
    expectFocusRing(slider);
    slider.focus();
    expect(document.activeElement).toBe(slider);
  });
});
