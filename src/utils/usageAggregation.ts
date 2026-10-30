import { estimateCost } from '../services/pricing';

/**
 * Structural view of a log entry for usage aggregation. `LogEntry` satisfies
 * it; the token fields are optional so pending/failed calls (which have no
 * usage yet) degrade to zeros instead of special-casing.
 */
export interface UsageEntry {
  fn: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Per-operation rollup for the usage dashboard bar list. */
export interface UsageOpRow {
  fn: string;
  /** Distinct models seen for this op, first-seen order. */
  models: string[];
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** inputTokens + outputTokens — bar-length basis. */
  totalTokens: number;
  /** USD, priced calls only (see unpricedCalls). */
  estimatedCost: number;
  /** Calls whose model has no pricing entry — excluded from estimatedCost. */
  unpricedCalls: number;
}

export interface UsageAggregate {
  /** Sorted by estimated cost desc, then tokens desc, then fn — deterministic. */
  ops: UsageOpRow[];
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    unpricedCalls: number;
  };
}

/**
 * Aggregates session log entries for the usage dashboard: groups by operation
 * (`fn`), sums input/output tokens, and applies the cost model per entry.
 * Entries without token data still count toward `calls` — an unmeasured call
 * is real spend the API may still bill for.
 */
export function aggregateUsage(entries: Iterable<UsageEntry>): UsageAggregate {
  const byOp = new Map<string, UsageOpRow>();

  for (const entry of entries) {
    let row = byOp.get(entry.fn);
    if (!row) {
      row = { fn: entry.fn, models: [], calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, unpricedCalls: 0 };
      byOp.set(entry.fn, row);
    }
    row.calls += 1;
    if (!row.models.includes(entry.model)) row.models.push(entry.model);

    const inputTokens = entry.inputTokens ?? 0;
    const outputTokens = entry.outputTokens ?? 0;
    row.inputTokens += inputTokens;
    row.outputTokens += outputTokens;
    row.totalTokens += inputTokens + outputTokens;

    const cost = estimateCost(entry.model, inputTokens, outputTokens);
    if (cost === null) row.unpricedCalls += 1;
    else row.estimatedCost += cost;
  }

  const ops = [...byOp.values()].sort(compareOps);

  const totals = ops.reduce(
    (acc, op) => ({
      calls: acc.calls + op.calls,
      inputTokens: acc.inputTokens + op.inputTokens,
      outputTokens: acc.outputTokens + op.outputTokens,
      totalTokens: acc.totalTokens + op.totalTokens,
      estimatedCost: acc.estimatedCost + op.estimatedCost,
      unpricedCalls: acc.unpricedCalls + op.unpricedCalls,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, unpricedCalls: 0 },
  );

  return { ops, totals };
}

/** Money first, then volume, then name — keeps the list stable for equal rows. */
function compareOps(a: UsageOpRow, b: UsageOpRow): number {
  if (b.estimatedCost !== a.estimatedCost) return b.estimatedCost - a.estimatedCost;
  if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
  return a.fn.localeCompare(b.fn);
}
