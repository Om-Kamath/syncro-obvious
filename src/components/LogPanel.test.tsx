// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LogPanel } from './LogPanel';
import { startLog, finishLog, resetLogs } from '../services/logger';

function seedCall(fn: string, model: string, tokens?: { inputTokens: number; outputTokens: number }, error?: string) {
  const entry = startLog(fn, model, 'seeded input');
  finishLog(entry, error, undefined, tokens);
}

describe('LogPanel cost display', () => {
  afterEach(() => {
    cleanup();
    resetLogs();
  });

  it('renders a per-call estimated cost chip for priced entries', () => {
    seedCall('TTS Generate', 'gemini-3.8-flash-tts', { inputTokens: 1000, outputTokens: 500 });
    seedCall('Transcribe Voiceover', 'gemini-3.5-flash-lite', { inputTokens: 2000, outputTokens: 100 });
    render(<LogPanel onClose={() => {}} />);

    expect(screen.getByText('$0.0055')).toBeDefined(); // 1000·$0.50/1M + 500·$10.00/1M
    expect(screen.getByText('$0.0002')).toBeDefined(); // 2000·$0.10/1M + 100·$0.40/1M
  });

  it('shows a session total of tokens and estimated cost', () => {
    seedCall('TTS Generate', 'gemini-3.8-flash-tts', { inputTokens: 1000, outputTokens: 500 });
    seedCall('Transcribe Voiceover', 'gemini-3.5-flash-lite', { inputTokens: 2000, outputTokens: 100 });
    render(<LogPanel onClose={() => {}} />);

    expect(screen.getByText(/3,000 tok in · 600 tok out · ≈\$0\.0057/)).toBeDefined();
  });

  it('shows token counts and estimated cost in the expanded entry detail', () => {
    seedCall('TTS Generate', 'gemini-3.8-flash-tts', { inputTokens: 1000, outputTokens: 500 });
    render(<LogPanel onClose={() => {}} />);

    fireEvent.click(screen.getByText('TTS Generate'));
    expect(screen.getByText(/1,000 in \/ 500 out/)).toBeDefined();
    expect(screen.getByText(/est\. cost:/)).toBeDefined();
    expect(screen.getAllByText('$0.0055').length).toBeGreaterThan(0); // row chip + expanded detail
  });

  it('shows no usage data when no entry carried token usage', () => {
    seedCall('Analyze Video', 'gemini-3.8-flash'); // pending — never finished
    seedCall('TTS Generate', 'gemini-3.8-flash-tts', undefined, 'boom'); // failed without usage
    render(<LogPanel onClose={() => {}} />);

    expect(screen.getByText('Session total')).toBeDefined();
    expect(screen.getByText('no usage data')).toBeDefined();
    expect(screen.queryByText(/tok in/)).toBeNull();
  });

  it('hides the session total footer when there are no entries', () => {
    render(<LogPanel onClose={() => {}} />);

    expect(screen.getByText('No API calls yet')).toBeDefined();
    expect(screen.queryByText('Session total')).toBeNull();
  });
});
