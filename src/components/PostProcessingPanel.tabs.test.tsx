// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Tab-level tests for surfaced errors: when the Gemini-backed service rejects
// (malformed model JSON, missing key, API failure), the tab must show the
// actionable message instead of a generic "try again" line.
const { generateDescriptionMock, identifyKeyMomentsMock } = vi.hoisted(() => ({
  generateDescriptionMock: vi.fn(),
  identifyKeyMomentsMock: vi.fn(),
}));

vi.mock('../services/postProcessing', () => ({
  generateDescription: generateDescriptionMock,
  identifyKeyMoments: identifyKeyMomentsMock,
}));

import { DescriptionTab, ThumbnailsTab } from './PostProcessingPanel';
import type { VideoClip, Voiceover } from '../types';

const voiceover: Voiceover = {
  url: 'blob:voiceover',
  duration: 8,
  transcription: 'We hiked the ridge at dawn and found an abandoned cabin.',
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

describe('surfaced postProcessing errors', () => {
  afterEach(() => {
    cleanup();
    generateDescriptionMock.mockReset();
    identifyKeyMomentsMock.mockReset();
  });

  it('Description tab: shows the actionable parse-error message, not a generic failure', async () => {
    generateDescriptionMock.mockRejectedValue(
      new Error('Description generation: Gemini returned malformed JSON — got: {{broken')
    );
    render(<DescriptionTab voiceover={voiceover} videoClips={[clip()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(screen.getByText(/Gemini returned malformed JSON/)).toBeDefined()
    );
    expect(screen.queryByText('Failed to generate description. Please try again.')).toBeNull();
  });

  it('Description tab: surfaces the missing-API-key guidance', async () => {
    generateDescriptionMock.mockRejectedValue(
      new Error('No Gemini API key set. Click the key icon in the header to add one.')
    );
    render(<DescriptionTab voiceover={voiceover} videoClips={[clip()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(screen.getByText(/Click the key icon in the header/)).toBeDefined()
    );
  });

  it('Thumbnails tab: shows the actionable parse-error message, not a generic failure', async () => {
    identifyKeyMomentsMock.mockRejectedValue(
      new Error('Thumbnail key-moment identification: Gemini returned an empty response.')
    );
    render(
      <ThumbnailsTab
        voiceover={voiceover}
        videoClips={[clip()]}
        selectedThumbnailId={null}
        onThumbnailSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(screen.getByText(/returned an empty response/)).toBeDefined()
    );
    expect(screen.queryByText('Failed to identify key moments. Please try again.')).toBeNull();
  });
});
