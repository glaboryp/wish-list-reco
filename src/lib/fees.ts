import { fromCents, toCents } from './money';

export type PaymentSource = 'paypal' | 'card';

export interface FeeRate {
  rate: number;
  fixed: number;
}

export type FeeSchedule = Record<PaymentSource, FeeRate>;

export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  paypal: { rate: 0.029, fixed: 0.35 },
  card: { rate: 0.029, fixed: 0.35 },
};

export function parsePaymentSource(value: unknown): PaymentSource {
  return value === 'card' ? 'card' : 'paypal';
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function feeScheduleFromRow(row: Record<string, unknown>): FeeSchedule {
  const percent = (value: unknown, fallback: number) => Math.round(numberOr(value, fallback * 100) * 100) / 10000;
  return {
    paypal: {
      rate: percent(row.paypal_fee_percent, DEFAULT_FEE_SCHEDULE.paypal.rate),
      fixed: numberOr(row.paypal_fee_fixed, DEFAULT_FEE_SCHEDULE.paypal.fixed),
    },
    card: {
      rate: percent(row.card_fee_percent, DEFAULT_FEE_SCHEDULE.card.rate),
      fixed: numberOr(row.card_fee_fixed, DEFAULT_FEE_SCHEDULE.card.fixed),
    },
  };
}

export function amountWithFees(net: number, source: PaymentSource, schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE): number {
  const { rate, fixed } = schedule[source];
  return fromCents(Math.round((toCents(net) + toCents(fixed)) / (1 - rate)));
}
