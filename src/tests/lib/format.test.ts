import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../lib/format';

describe('formatDateTime', () => {
  it('shows summer UTC late evening as next day in Madrid', () => {
    expect(formatDateTime('2025-07-14T23:30:00Z')).toMatch(/^15\/7\/25,? 1:30$/);
  });

  it('uses CET in winter', () => {
    expect(formatDateTime(new Date('2025-01-10T23:30:00Z'))).toMatch(/^11\/1\/25,? 0:30$/);
  });
});
