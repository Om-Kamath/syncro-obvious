// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Captions-tab spacing regression (preset era, post-#75): every section label
// sits 12px (space-y-3) above its content — the panel's uniform rhythm. The
// Presets and Style sections already carry the rhythm; these assertions lock
// the normalized classes on the remaining sections so future edits don't
// reintroduce off-scale gaps (8px stragglers, or the inline slider's
// inflated visual gap).
import { PostProcessingPanel } from './PostProcessingPanel';
import type { CaptionStyle, Voiceover } from '../types';

const voiceover: Voiceover = {
  url: 'blob:voiceover',
  duration: 8,
  transcription: 'We hiked the ridge at dawn and found an abandoned cabin.',
  segments: [{ text: 'We hiked the ridge at dawn.', start: 0, end: 4 }],
  startTime: 0,
};

const defaultStyle: CaptionStyle = {
  mode: 'lower-third',
  fontSize: 16,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
};

async function openCaptionsTab(style: CaptionStyle = defaultStyle) {
  const onStyleChange = vi.fn();
  const onEnabledChange = vi.fn();
  const { container } = render(
    <PostProcessingPanel
      voiceover={voiceover}
      videoClips={[]}
      currentTime={0}
      captionStyle={style}
      captionsEnabled
      onCaptionStyleChange={onStyleChange}
      onCaptionsEnabledChange={onEnabledChange}
      onImportCaptions={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Captions' }));
  // AnimatePresence mode="wait" mounts the new tab after the old one's exit
  // animation, so the Captions content appears asynchronously.
  const tab = await waitFor(() => {
    const el = container.querySelector('.space-y-6');
    if (!el) throw new Error('Captions tab container not rendered yet');
    return el as HTMLElement;
  });
  return { tab, onStyleChange, onEnabledChange };
}

describe('Captions tab spacing rhythm', () => {
  afterEach(cleanup);

  it('renders every section label on the uniform 12px (space-y-3) rhythm', async () => {
    const { tab } = await openCaptionsTab();
    for (const label of ['Font Size', 'Text Color', 'Background', 'Position', 'Templates']) {
      const p = [...tab.querySelectorAll('p')].find(e => e.textContent === label);
      expect(p, `label "${label}" should render`).toBeDefined();
      // Font Size's label nests one level deeper (flex row with the px readout),
      // so assert on the nearest ancestor that carries the section rhythm.
      const holder = p!.closest('[class*="space-y-"]');
      expect(holder, `rhythm holder for "${label}"`).toBeDefined();
      expect(holder!.className, label).toContain('space-y-3');
    }
    // The Presets and Style sections were normalized upstream (#75); they must stay there.
    for (const label of ['Presets', 'Style']) {
      const p = [...tab.querySelectorAll('p')].find(e => e.textContent === label);
      expect(p, `label "${label}" should render`).toBeDefined();
      expect(p!.parentElement!.className, label).toContain('space-y-3');
    }
  });

  it('keeps the font-size slider block-level so its gap matches the rhythm', async () => {
    const { tab } = await openCaptionsTab();
    const slider = tab.querySelector('input[type="range"]');
    expect(slider).toBeDefined();
    expect(slider!.className).toContain('block');
  });

  it('matches the Captions tab DOM snapshot', async () => {
    const { tab } = await openCaptionsTab();
    expect(tab).toMatchSnapshot();
  });
});

describe('Captions tab interaction', () => {
  afterEach(cleanup);

  it('clicking a style mode reports the new mode and clears the preset', async () => {
    const { onStyleChange } = await openCaptionsTab();
    fireEvent.click(screen.getByRole('button', { name: /Word Highlight/ }));
    expect(onStyleChange).toHaveBeenCalledTimes(1);
    expect(onStyleChange.mock.calls[0][0]).toMatchObject({ mode: 'word-highlight', preset: undefined });
  });

  it('toggling the live caption preview reports through onCaptionsEnabledChange', async () => {
    const { tab, onEnabledChange } = await openCaptionsTab();
    // The toggle is the first button in the tab (Live Caption Preview row
    // precedes the Presets grid).
    const toggle = tab.querySelector('button');
    expect(toggle).toBeDefined();
    fireEvent.click(toggle!);
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });
});
