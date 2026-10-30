import React, { useMemo } from 'react';
import { BarChart3, Coins } from 'lucide-react';
import type { LogEntry } from '../services/logger';
import { aggregateUsage } from '../utils/usageAggregation';
import { formatTokenCount, formatCostUsd } from '../utils/usageFormat';

interface UsageDashboardProps {
  entries: LogEntry[];
}

/**
 * Session usage dashboard: one bar per Gemini operation, charting total
 * tokens (bar length) with the estimated cost as the headline number.
 * Bars are scaled relative to the largest operation so the list stays
 * readable when one op dominates.
 */
export const UsageDashboard: React.FC<UsageDashboardProps> = ({ entries }) => {
  const aggregate = useMemo(() => aggregateUsage(entries), [entries]);
  const { ops, totals } = aggregate;
  const maxTokens = ops.reduce((max, op) => Math.max(max, op.totalTokens), 0);

  if (totals.calls === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
        <BarChart3 className="w-8 h-8 opacity-30" />
        <p className="text-xs">No usage yet — run a Gemini operation</p>
      </div>
    );
  }

  return (
    <div>
      {/* Session totals */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Session usage</span>
          </div>
          <span className="text-sm font-bold font-mono text-gray-800" title="Estimated cost across all logged calls">
            {formatCostUsd(totals.estimatedCost)}
          </span>
        </div>
        <p className="mt-1 text-[10px] font-mono text-gray-400">
          {totals.calls} calls · {formatTokenCount(totals.inputTokens)} in · {formatTokenCount(totals.outputTokens)} out tokens
        </p>
        {totals.unpricedCalls > 0 && (
          <p className="mt-1 text-[10px] text-amber-600">
            Pricing unknown for {totals.unpricedCalls} call{totals.unpricedCalls === 1 ? '' : 's'} — not included.
          </p>
        )}
      </div>

      {/* Per-operation bar list */}
      {ops.map(op => {
        const widthPct = maxTokens > 0 ? (op.totalTokens / maxTokens) * 100 : 0;
        return (
          <div key={op.fn} className="px-4 py-2.5 border-b border-gray-50 last:border-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-gray-800 truncate">{op.fn}</span>
              <span className="text-[10px] font-mono text-gray-500 shrink-0">{formatCostUsd(op.estimatedCost)}</span>
            </div>
            <div
              className="mt-1.5 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden"
              role="img"
              aria-label={`${op.fn}: ${op.totalTokens} tokens, estimated cost ${formatCostUsd(op.estimatedCost)}`}
            >
              <div className="h-full bg-violet-500 rounded-full" style={{ width: `${widthPct}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-mono text-gray-400">
              <span>
                {op.calls} call{op.calls === 1 ? '' : 's'} · {formatTokenCount(op.inputTokens)} in · {formatTokenCount(op.outputTokens)} out
              </span>
              {op.unpricedCalls > 0 ? (
                <span className="text-amber-600 shrink-0">{op.unpricedCalls} unpriced</span>
              ) : (
                <span className="truncate shrink-0" title={op.models.join(', ')}>
                  {op.models[0]}
                  {op.models.length > 1 && ` +${op.models.length - 1}`}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
