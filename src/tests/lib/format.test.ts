import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDonorCount } from '../../lib/format';

describe('formatDateTime', () => {
  it('shows summer UTC late evening as next day in Madrid', () => {
    expect(formatDateTime('2025-07-14T23:30:00Z')).toMatch(/^15\/7\/25,? 1:30$/);
  });

  it('uses CET in winter', () => {
    expect(formatDateTime(new Date('2025-01-10T23:30:00Z'))).toMatch(/^11\/1\/25,? 0:30$/);
  });
});

describe('formatDonorCount', () => {
  it('hides the counter when nobody has donated', () => {
    expect(formatDonorCount(0)).toBeNull();
  });

  it('uses the singular for one donor', () => {
    expect(formatDonorCount(1)).toBe('1 persona ha donado');
  });

  it('uses the plural otherwise', () => {
    expect(formatDonorCount(2)).toBe('2 personas han donado');
    expect(formatDonorCount(120)).toBe('120 personas han donado');
  });
});
