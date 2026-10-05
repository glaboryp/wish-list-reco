export type PaymentSource = 'paypal' | 'card';

export const FEE_SCHEDULE: Record<PaymentSource, { rate: number; fixed: number }> = {
  paypal: { rate: 0.029, fixed: 0.35 },
  card: { rate: 0.012, fixed: 0.35 },
};

export function parsePaymentSource(value: unknown): PaymentSource {
  return value === 'card' ? 'card' : 'paypal';
}

export function amountWithFees(net: number, source: PaymentSource): number {
  const { rate, fixed } = FEE_SCHEDULE[source];
  return Math.round(((net + fixed) / (1 - rate)) * 100) / 100;
}
