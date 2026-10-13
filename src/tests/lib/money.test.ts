import { describe, expect, it } from 'vitest';
import { centsToDecimalString, fromCents, remainingCents, toCents } from '../../lib/money';

describe('toCents', () => {
  it.each([
    [0.1 + 0.2, 30],
    [1.005, 101],
    [2.675, 268],
    [10.005, 1001],
    [19.99, 1999],
    [0, 0],
    ['12.34', 1234],
    ['0.29', 29],
    [813.95, 81395],
  ])('converts %s to %d cents', (value, cents) => {
    expect(toCents(value)).toBe(cents);
  });
});

describe('fromCents and centsToDecimalString', () => {
  it('converts back to euros', () => {
    expect(fromCents(1999)).toBe(19.99);
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(1234)).toBe('12.34');
  });
});

describe('remainingCents', () => {
  it('subtracts without floating point noise', () => {
    expect(remainingCents(0.3, 0.1 + 0.2)).toBe(0);
    expect(remainingCents(100, 33.33)).toBe(6667);
    expect(fromCents(remainingCents(10.1, 0.2))).toBe(9.9);
  });

  it('never goes below zero', () => {
    expect(remainingCents(10, 12)).toBe(0);
  });
});
