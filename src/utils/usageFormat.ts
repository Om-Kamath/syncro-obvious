/** 1234 → "1.2k", 5200000 → "5.2M" — compact labels for the usage bar rows. */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 0 → "$0", 0.00001 → "<$0.0001", else 4-decimal USD. */
export function formatCostUsd(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.0001) return '<$0.0001';
  return `$${cost.toFixed(4)}`;
}
