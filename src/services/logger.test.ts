import { describe, it, expect } from 'vitest';
import { startLog, finishLog, type LogEntry } from './logger';

function newEntry(): LogEntry {
  return startLog('Test Op', 'gemini-test', 'detail');
}

describe('finishLog', () => {
  it('marks success without cost fields when no cost is passed', () => {
    const entry = newEntry();
    finishLog(entry);

    expect(entry.status).toBe('success');
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.tokensConsumed).toBeUndefined();
    expect(entry.billed).toBeUndefined();
  });

  it('records duration and error without cost when no cost is passed', () => {
    const entry = newEntry();
    finishLog(entry, 'boom');

    expect(entry.status).toBe('error');
    expect(entry.error).toBe('boom');
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.tokensConsumed).toBeUndefined();
    expect(entry.billed).toBeUndefined();
  });

  it('sets tokensConsumed and billed when cost state is passed', () => {
    const entry = newEntry();
    finishLog(entry, 'failed after processing', { tokensConsumed: 137, billed: true });

    expect(entry.status).toBe('error');
    expect(entry.error).toBe('failed after processing');
    expect(entry.tokensConsumed).toBe(137);
    expect(entry.billed).toBe(true);
  });

  it('preserves captured cost state when re-finished without cost', () => {
    const entry = newEntry();
    finishLog(entry, 'first failure', { tokensConsumed: 42, billed: true });
    finishLog(entry, 'second failure');

    expect(entry.error).toBe('second failure');
    expect(entry.tokensConsumed).toBe(42);
    expect(entry.billed).toBe(true);
  });

  it('overwrites cost state when a new cost is provided', () => {
    const entry = newEntry();
    finishLog(entry, 'first failure', { tokensConsumed: 42, billed: true });
    finishLog(entry, 'second failure', { tokensConsumed: 0, billed: false });

    expect(entry.tokensConsumed).toBe(0);
    expect(entry.billed).toBe(false);
  });
});
