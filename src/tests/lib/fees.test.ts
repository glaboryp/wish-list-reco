import { describe, expect, it } from 'vitest';
const REDUCED_CARD_SCHEDULE = { paypal: { rate: 0.029, fixed: 0.35 }, card: { rate: 0.012, fixed: 0.35 } };
import { DEFAULT_FEE_SCHEDULE, amountWithFees, feeScheduleFromRow, parsePaymentSource } from '../../lib/fees';

describe('amountWithFees', () => {
  it.each([
    ['paypal', 10, 10.66],
    ['paypal', 790, 813.95],
    ['card', 10, 10.66],
    ['card', 790, 813.95],
  ] as const)('charges %s for %d euros as %d with the default fees', (source, net, total) => {
    expect(amountWithFees(net, source)).toBe(total);
  });

  it.each([
    [10, 10.48],
    [790, 799.95],
  ])('charges the reduced card fees of %d euros as %d', (net, total) => {
    expect(amountWithFees(net, 'card', REDUCED_CARD_SCHEDULE)).toBe(total);
  });

  it('leaves the center with the full donation after PayPal takes its fee', () => {
    const real = { paypal: [0.029, 0.35], card: [0.012, 0.35] } as const;
    for (const source of ['paypal', 'card'] as const) {
      for (const net of [1, 9, 20, 63, 790]) {
        const total = amountWithFees(net, source, REDUCED_CARD_SCHEDULE);
        const [rate, fixed] = real[source];
        expect(Math.abs(total - (total * rate + fixed) - net)).toBeLessThan(0.01);
      }
    }
  });
});

describe('amountWithFees with a custom schedule', () => {
  it('uses the rates of the center', () => {
    const schedule = { ...DEFAULT_FEE_SCHEDULE, card: { rate: 0.012, fixed: 0.35 } };
    expect(amountWithFees(10, 'card', schedule)).toBe(10.48);
    expect(amountWithFees(10, 'paypal', schedule)).toBe(10.66);
  });
});

describe('feeScheduleFromRow', () => {
  it('converts the stored percentages into rates', () => {
    const schedule = feeScheduleFromRow({ paypal_fee_percent: '2.90', paypal_fee_fixed: '0.35', card_fee_percent: '1.20', card_fee_fixed: '0.35' });
    expect(schedule).toEqual({ paypal: { rate: 0.029, fixed: 0.35 }, card: { rate: 0.012, fixed: 0.35 } });
  });

  it('falls back to the defaults when the columns are missing', () => {
    expect(feeScheduleFromRow({})).toEqual(DEFAULT_FEE_SCHEDULE);
  });
});

describe('parsePaymentSource', () => {
  it('only accepts card explicitly and defaults to the higher PayPal fees', () => {
    expect(parsePaymentSource('card')).toBe('card');
    expect(parsePaymentSource('paypal')).toBe('paypal');
    expect(parsePaymentSource(undefined)).toBe('paypal');
    expect(parsePaymentSource('anything')).toBe('paypal');
  });
});
