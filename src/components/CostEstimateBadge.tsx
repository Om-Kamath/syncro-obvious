import { formatEstimatedCost } from '../services/costEstimate';
import type { PreRunEstimate } from '../services/costEstimate';

const TOOLTIP = 'Estimated from input size before the request runs — actual usage may differ.';

/** Small "est. $0.0042" label shown next to AI actions before they run. */
export function CostEstimateBadge({
  estimate,
  className = 'text-xs text-gray-400',
}: {
  estimate: PreRunEstimate;
  className?: string;
}) {
  return (
    <span title={TOOLTIP} className={`whitespace-nowrap tabular-nums ${className}`}>
      est. {formatEstimatedCost(estimate.estimatedCostUsd)}
    </span>
  );
}
