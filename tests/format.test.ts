import { expect, test } from 'vitest';
import { formatAmount } from '../src/ui/format';

test('abbreviates past 10,000', () => {
  expect(formatAmount(9999)).toBe('9,999');
  expect(formatAmount(10000)).toBe('10K');
  expect(formatAmount(12345)).toBe('12.3K');
  expect(formatAmount(1_500_000)).toBe('1.5M');
  expect(formatAmount(2e9)).toBe('2B');
  expect(formatAmount(3.21e15)).toBe('3.21Qa');
  expect(formatAmount(7e18)).toBe('7Qi');
});
