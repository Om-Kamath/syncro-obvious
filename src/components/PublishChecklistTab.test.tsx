// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PublishChecklistTab } from './PublishChecklistTab';
import { generateSRT } from '../utils/captionUtils';
import { downloadDataUrl } from '../utils/exportUtils';
import { loadChecklistState, saveChecklistState } from '../services/publishChecklistStore';
import type { ThumbnailCandidate, VideoDescription, Voiceover } from '../types';

vi.mock('../utils/captionUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/captionUtils')>();
  return { ...actual, downloadTextFile: vi.fn() };
});
vi.mock('../utils/exportUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/exportUtils')>();
  return { ...actual, downloadDataUrl: vi.fn() };
});

const downloadTextFile = vi.mocked(
  await import('../utils/captionUtils').then(m => m.downloadTextFile)
);

const segments = [
  { text: 'Hello world', start: 0, end: 2.5 },
  { text: 'Second line', start: 2.5, end: 5 },
];
const voiceover: Voiceover = {
  url: 'blob:voiceover',
  duration: 5,
  transcription: 'Hello world. Second line.',
  segments,
};
const description: VideoDescription = {
  summary: 'A quick tour of Syncro.',
  chapters: [
    { time: 0, label: 'Intro' },
    { time: 65, label: 'Deep dive' },
  ],
  hashtags: ['aivideo', 'syncro'],
};
const thumbnails: ThumbnailCandidate[] = [
  { id: 'thumb-0', timestamp: 12, quote: 'Key quote', reason: 'Hook moment', imageDataUrl: 'data:image/jpeg;base64,AAAA' },
];

describe('PublishChecklistTab', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders every publish asset section when everything is ready', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.change(screen.getByLabelText('Video title'), { target: { value: 'My Video' } });

    expect(screen.getByText('Publish Checklist')).toBeDefined();
    expect(screen.getByText('6 of 6 ready')).toBeDefined();
    expect(screen.getByLabelText('Video title')).toBeDefined();
    expect(screen.getByText('A quick tour of Syncro.')).toBeDefined();
    expect(screen.getByText('Deep dive')).toBeDefined();
    expect(screen.getByAltText('Key quote')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Download SRT' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Download VTT' })).toBeDefined();
    for (const label of ['YouTube', 'YouTube Shorts', 'TikTok', 'Instagram']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined();
    }
    // Platform copy <pre>: whitespace-normalized concatenation of the YouTube
    // copy (title + summary + chapters + hashtags) — unique to that node.
    expect(
      screen.getByText('My Video A quick tour of Syncro. 0:00 Intro 1:05 Deep dive #aivideo #syncro')
    ).toBeDefined();
  });

  it('copies the chosen title as typed', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.change(screen.getByLabelText('Video title'), { target: { value: 'My Video' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy title' }));
    expect(writeText).toHaveBeenCalledWith('My Video');
  });

  it('copies the description with chapters and hashtags', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy description' }));
    expect(writeText).toHaveBeenCalledWith(
      'A quick tour of Syncro.\n\n0:00 Intro\n1:05 Deep dive\n\n#aivideo #syncro'
    );
  });

  it('copies chapters as formatted timestamp lines', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy chapters' }));
    expect(writeText).toHaveBeenCalledWith('0:00 Intro\n1:05 Deep dive');
  });

  it('copies platform-shaped copy for the selected platform', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'TikTok' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy platform copy' }));
    expect(writeText).toHaveBeenCalledWith('A quick tour of Syncro.\n\n#aivideo #syncro');
  });

  it('copies the whole publish package with title on top', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.change(screen.getByLabelText('Video title'), { target: { value: 'My Video' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy all publish assets' }));
    expect(writeText).toHaveBeenCalledWith(
      'My Video\n\nA quick tour of Syncro.\n\n0:00 Intro\n1:05 Deep dive\n\n#aivideo #syncro'
    );
  });

  it('downloads SRT and VTT caption files from the real segments', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download SRT' }));
    expect(downloadTextFile).toHaveBeenCalledWith(generateSRT(segments), 'captions.srt', 'text/plain');
    fireEvent.click(screen.getByRole('button', { name: 'Download VTT' }));
    expect(downloadTextFile).toHaveBeenCalledWith(expect.stringContaining('WEBVTT'), 'captions.vtt', 'text/vtt');
  });

  it('downloads captured thumbnails', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download thumbnail 1' }));
    expect(downloadDataUrl).toHaveBeenCalledWith(
      'data:image/jpeg;base64,AAAA',
      'thumbnail-1-12s.jpg'
    );
  });

  it('shows pending hints and hides copy actions for missing assets', () => {
    render(
      <PublishChecklistTab voiceover={null} description={null} thumbnails={[]} />
    );

    expect(screen.getByText('0 of 6 ready')).toBeDefined();
    expect(screen.getAllByText('Pending').length).toBe(6);
    expect(screen.getByText('Generate a summary in the Description tab first.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Copy description' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy all publish assets' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download SRT' })).toBeNull();
  });

  it('marks the title ready once typed, without other assets', () => {
    render(
      <PublishChecklistTab voiceover={null} description={null} thumbnails={[]} />
    );
    fireEvent.change(screen.getByLabelText('Video title'), { target: { value: 'Solo title' } });
    expect(screen.getByText('1 of 6 ready')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy title' })).toBeDefined();
  });

  it('restores the saved title and selected platform on mount', () => {
    saveChecklistState({
      activePlatform: 'tiktok',
      platforms: { tiktok: { title: 'Saved title' } },
    });

    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );

    expect((screen.getByLabelText('Video title') as HTMLInputElement).value).toBe('Saved title');
    expect(screen.getByRole('button', { name: 'TikTok' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('persists typed titles and platform switches for the next load', () => {
    render(
      <PublishChecklistTab
        voiceover={voiceover}
        description={description}
        thumbnails={thumbnails}
      />
    );
    fireEvent.change(screen.getByLabelText('Video title'), { target: { value: 'Persisted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));

    const saved = loadChecklistState();
    expect(saved.activePlatform).toBe('instagram');
    expect(saved.platforms.youtube?.title).toBe('Persisted');
  });

  it('starts empty instead of crashing when saved checklist state is corrupted', () => {
    // The storage key lives in publishChecklistStore; seed it directly to
    // simulate a payload corrupted outside the app.
    localStorage.setItem('syncro_publish_checklist', '{not valid json');

    render(
      <PublishChecklistTab voiceover={null} description={null} thumbnails={[]} />
    );

    expect((screen.getByLabelText('Video title') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('0 of 6 ready')).toBeDefined();
  });
});
