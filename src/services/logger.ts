export type LogStatus = 'pending' | 'success' | 'error';

/**
 * Cost state for a finished call. `billed` is true only when the API reports
 * token usage — a call that fails before any tokens are consumed is logged as
 * 0 tokens / not billed rather than left blank.
 */
export interface FailureCost {
  tokensConsumed: number;
  billed: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  status: LogStatus;
  fn: string;          // human-readable function name
  model: string;       // Gemini model used
  detail: string;      // short description of the input
  durationMs?: number; // set on success/error
  error?: string;
  tokensConsumed?: number; // set when the call finishes with observed cost state
  billed?: boolean;        // false = the failure cost nothing
  // Token accounting from the response's usageMetadata (set on success when
  // the model reports counts). Named for cost math, not the SDK's ids.
  inputTokens?: number;  // usageMetadata.promptTokenCount
  outputTokens?: number; // usageMetadata.candidatesTokenCount
  totalTokens?: number;  // usageMetadata.totalTokenCount
}

type Listener = (entries: LogEntry[]) => void;

const entries: LogEntry[] = [];
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(l => l([...entries]));
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  cb([...entries]);
  return () => listeners.delete(cb);
}

export function startLog(fn: string, model: string, detail: string): LogEntry {
  const entry: LogEntry = {
    id: Math.random().toString(36).slice(2),
    timestamp: new Date(),
    status: 'pending',
    fn,
    model,
    detail,
  };
  entries.unshift(entry); // newest first
  notify();
  return entry;
}

export function finishLog(entry: LogEntry, error?: string, cost?: FailureCost) {
  entry.durationMs = Date.now() - entry.timestamp.getTime();
  entry.status = error ? 'error' : 'success';
  if (error) entry.error = error;
  // Cost is only set when provided: a caller re-finishing an entry (e.g. the
  // outer catch in gemini.ts after the wrapper already recorded cost) must
  // not wipe the captured state.
  if (cost) {
    entry.tokensConsumed = cost.tokensConsumed;
    entry.billed = cost.billed;
  }
  notify();
}
