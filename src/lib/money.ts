export function toCents(value: number | string): number {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Math.round(Number((parsed * 100).toPrecision(15)));
}

export const fromCents = (cents: number): number => cents / 100;

export const centsToDecimalString = (cents: number): string => (cents / 100).toFixed(2);

export function remainingCents(goal: number | string, raised: number | string): number {
  return Math.max(0, toCents(goal) - toCents(raised));
}

/**
 * PayPal refunds the gross captured amount (donation plus the fee the donor covered).
 * The part that stops counting for the item is proportional: refunded * amount / (amount + fee),
 * rounded to the cent and clamped to [0, amount].
 */
export function netRefundedAmount(refundedGross: number | string, amount: number | string, fee: number | string): string {
  const amountCents = toCents(amount);
  const grossCents = amountCents + toCents(fee);
  const refundedCents = Math.max(0, toCents(refundedGross));
  if (grossCents <= 0) return centsToDecimalString(0);
  const net = Math.round((refundedCents * amountCents) / grossCents);
  return centsToDecimalString(Math.min(amountCents, Math.max(0, net)));
}

export function countedAmount(amount: number | string, refunded: number | string): number {
  return fromCents(Math.max(0, toCents(amount) - toCents(refunded)));
}
