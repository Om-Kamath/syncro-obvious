// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { UsageDashboard } from './UsageDashboard';
import type { LogEntry } from '../services/logger';
import { MODELS } from '../services/models';

// The stacked usage-capture PR adds these token fields to LogEntry additively;
// the intersection keeps this fixture compiling against both shapes.
type EntryFixture = LogEntry & { inputTokens?: number; outputTokens?: number };

function makeEntry(overrides: Partial<EntryFixture> & Pick<LogEntry, 'fn' | 'model'>): EntryFixture {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: new Date(),
    status: 'success',
    detail: 'test input',
    ...overrides,
  };
}

describe('UsageDashboard', () => {
  afterEach(cleanup);

  it('shows the empty state with no entries', () => {
    render(<UsageDashboard entries={[]} />);
    expect(screen.getByText('No usage yet — run a Gemini operation')).toBeDefined();
  });

  it('renders session totals and one bar row per operation', () => {
    const entries: EntryFixture[] = [
      makeEntry({ fn: 'TTS Generate', model: MODELS.tts, inputTokens: 200, outputTokens: 5000 }),
      makeEntry({ fn: 'Analyze Video', model: MODELS.flashLite, inputTokens: 1000, outputTokens: 100 }),
    ];
    render(<UsageDashboard entries={entries} />);

    // Session total = 0.0451 (TTS) + 0.00055 (flashLite) — assert the 4-decimal USD shape
    // and the exact TTS row rather than a hand-computed float string.
    expect(screen.getByTitle('Estimated cost across all logged calls').textContent).toMatch(/^\$\d+\.\d{4}$/);
    expect(screen.getByText('$0.0451')).toBeDefined();
    expect(screen.getByText('Session usage')).toBeDefined();
    expect(screen.getByText(/^2 calls ·/)).toBeDefined();

    expect(screen.getByText('TTS Generate')).toBeDefined();
    expect(screen.getByText('Analyze Video')).toBeDefined();
    // Most expensive op listed first.
    const rows = screen.getAllByRole('img');
    expect(rows[0].getAttribute('aria-label')).toContain('TTS Generate');
  });

  it('flags calls on models without pricing instead of hiding them', () => {
    const entries: EntryFixture[] = [
      makeEntry({ fn: 'Legacy Op', model: 'mystery-model', inputTokens: 10, outputTokens: 10 }),
    ];
    render(<UsageDashboard entries={entries} />);

    expect(screen.getByText('1 unpriced')).toBeDefined();
    expect(screen.getByText(/Pricing unknown for 1 call/)).toBeDefined();
  });
});
