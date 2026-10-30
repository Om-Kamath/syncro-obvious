import React, { useEffect, useState } from 'react';
import { subscribe, LogEntry } from '../services/logger';
import { formatUsd, summarizeCosts } from '../services/costModel';
import { X, Activity, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

interface LogPanelProps {
  onClose: () => void;
}

function timeStr(d: Date) {
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export const LogPanel: React.FC<LogPanelProps> = ({ onClose }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const summary = summarizeCosts(entries);

  useEffect(() => subscribe(setEntries), []);

  const toggle = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  return (
    <div className="fixed top-14 right-0 bottom-0 w-80 z-[90] bg-white border-l border-gray-200 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-bold text-gray-800">API Logs</span>
          {entries.some(e => e.status === 'pending') && (
            <span className="ml-1 w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-gray-400">{entries.length} calls</span>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <Activity className="w-8 h-8 opacity-30" />
            <p className="text-xs">No API calls yet</p>
          </div>
        )}
        {entries.map(entry => {
          const isOpen = expanded.has(entry.id);
          return (
            <div key={entry.id} className="border-b border-gray-50 last:border-0">
              <button
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                onClick={() => toggle(entry.id)}
              >
                {/* Status icon */}
                <div className="mt-0.5 shrink-0">
                  {entry.status === 'pending' && <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />}
                  {entry.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                  {entry.status === 'error' && <XCircle className="w-4 h-4 text-red-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-gray-800 truncate">{entry.fn}</span>
                    {entry.durationMs !== undefined && (
                      <span className={`text-[10px] font-mono shrink-0 ${entry.status === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
                        {entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`}
                      </span>
                    )}
                    {entry.status === 'error' && entry.billed !== undefined && (
                      <span className={`text-[10px] font-mono shrink-0 ${entry.billed ? 'text-amber-500' : 'text-gray-300'}`}>
                        {entry.billed ? `${entry.tokensConsumed} tok · billed` : 'not billed'}
                      </span>
                    )}
                    {entry.estimatedCostUsd !== undefined && (
                      <span className="text-[10px] font-mono text-emerald-600 shrink-0">{formatUsd(entry.estimatedCostUsd)}</span>
                    )}
                    {entry.status === 'pending' && <span className="text-[10px] text-violet-400 shrink-0 font-mono">…</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-md">{entry.model}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{timeStr(entry.timestamp)}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate mt-1">{entry.detail}</p>
                </div>

                <div className="shrink-0 mt-0.5 text-gray-300">
                  {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-[11px] font-mono text-gray-600 space-y-1 border border-gray-100">
                    <div><span className="text-gray-400">fn:</span> {entry.fn}</div>
                    <div><span className="text-gray-400">model:</span> {entry.model}</div>
                    <div><span className="text-gray-400">input:</span> <span className="break-all">{entry.detail}</span></div>
                    <div><span className="text-gray-400">status:</span> <span className={entry.status === 'error' ? 'text-red-500' : entry.status === 'success' ? 'text-emerald-600' : 'text-violet-500'}>{entry.status}</span></div>
                    {entry.durationMs !== undefined && <div><span className="text-gray-400">duration:</span> {entry.durationMs}ms</div>}
                    {(entry.inputTokens !== undefined || entry.outputTokens !== undefined) && (
                      <div><span className="text-gray-400">tokens:</span> {(entry.inputTokens ?? 0).toLocaleString('en-US')} in / {(entry.outputTokens ?? 0).toLocaleString('en-US')} out</div>
                    )}
                    {entry.estimatedCostUsd !== undefined && (
                      <div><span className="text-gray-400">est. cost:</span> {formatUsd(entry.estimatedCostUsd)}</div>
                    )}
                    {entry.error && <div className="text-red-500 break-all"><span className="text-gray-400">error:</span> {entry.error}</div>}
                    {entry.tokensConsumed !== undefined && (
                      <div>
                        <span className="text-gray-400">cost:</span> {entry.tokensConsumed} token{entry.tokensConsumed === 1 ? '' : 's'} consumed
                        {entry.billed !== undefined && (
                          <span className={entry.billed ? 'text-amber-600' : 'text-emerald-600'}>
                            {entry.billed ? ' · billed' : ' · not billed'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Session total */}
      {entries.length > 0 && (
        <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Session total</span>
          {summary.pricedCalls > 0 ? (
            <span className="text-[11px] font-mono text-gray-700 truncate">
              {summary.totalTokensIn.toLocaleString('en-US')} tok in · {summary.totalTokensOut.toLocaleString('en-US')} tok out · ≈{formatUsd(summary.totalCostUsd)}
            </span>
          ) : (
            <span className="text-[11px] font-mono text-gray-400">no usage data</span>
          )}
        </div>
      )}
    </div>
  );
};
