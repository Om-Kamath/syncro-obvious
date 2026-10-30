// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import App from './App';

// The media library pane (Video Clips sidebar) must never fall back to a bare
// dropzone: a fresh session shows the illustrated empty state plus its
// Import Media CTA, so the pane reads as intentional rather than broken.
describe('App media library empty state', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the illustrated empty state and import CTA when no media is loaded', () => {
    render(<App />);

    expect(screen.getByText('Your media library is empty')).toBeDefined();
    expect(screen.getByText(/Import videos below/i)).toBeDefined();
    // The pane's dropzone doubles as the import CTA and stays mounted.
    expect(screen.getByText('Import Media')).toBeDefined();
  });
});
