import { describe, it, expect } from 'vitest';
import { formatTokenCount, formatCostUsd } from './usageFormat';

describe('formatTokenCount', () => {
  it('formats compact token counts', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1234)).toBe('1.2k');
    expect(formatTokenCount(5_200_000)).toBe('5.2M');
  });
});

describe('formatCostUsd', () => {
  it('formats small USD amounts', () => {
    expect(formatCostUsd(0)).toBe('$0');
    expect(formatCostUsd(0.00001)).toBe('<$0.0001');
    expect(formatCostUsd(0.045925)).toBe('$0.0459');
  });
});
