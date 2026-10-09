export function toCents(value: number | string): number {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Math.round(Number((parsed * 100).toPrecision(15)));
}

export const fromCents = (cents: number): number => cents / 100;

export const centsToDecimalString = (cents: number): string => (cents / 100).toFixed(2);

export function remainingCents(goal: number | string, raised: number | string): number {
  return Math.max(0, toCents(goal) - toCents(raised));
}
