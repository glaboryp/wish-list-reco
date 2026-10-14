import { describe, expect, it } from 'vitest';
import { centsToDecimalString, countedAmount, fromCents, netRefundedAmount, remainingCents, toCents } from '../../lib/money';

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

describe('netRefundedAmount', () => {
  it('attributes a gross refund to the donation in proportion to amount over amount plus fee', () => {
    expect(netRefundedAmount('5.33', '10.00', '0.66')).toBe('5.00');
    expect(netRefundedAmount('2.00', '10.00', '0.66')).toBe('1.88');
  });

  it('takes the whole refund when the donor did not cover the fee', () => {
    expect(netRefundedAmount('4.00', '10.00', '0')).toBe('4.00');
  });

  it('rounds to the nearest cent', () => {
    expect(netRefundedAmount('0.01', '10.00', '0.66')).toBe('0.01');
    expect(netRefundedAmount('3.33', '20.00', '1.00')).toBe('3.17');
  });

  it('never exceeds the donation nor goes below zero', () => {
    expect(netRefundedAmount('10.66', '10.00', '0.66')).toBe('10.00');
    expect(netRefundedAmount('50.00', '10.00', '0.66')).toBe('10.00');
    expect(netRefundedAmount('0', '10.00', '0.66')).toBe('0.00');
    expect(netRefundedAmount('-1', '10.00', '0.66')).toBe('0.00');
  });
});

describe('countedAmount', () => {
  it('subtracts the refunded part without floating point noise', () => {
    expect(countedAmount('10.10', '5.03')).toBe(5.07);
    expect(countedAmount('10.00', '0')).toBe(10);
    expect(countedAmount('10.00', '12')).toBe(0);
  });
});
