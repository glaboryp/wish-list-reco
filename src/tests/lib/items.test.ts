import { describe, expect, it } from 'vitest';
import { sortForPublic, toWishlistItem } from '../../lib/items';
import type { ItemRow } from '../../types/database';

const row = (overrides: Partial<ItemRow> = {}): ItemRow => ({
  id: '3f2b8c1e-5a4d-4c8e-9b7a-1d2e3f4a5b6c',
  center_id: '11111111-1111-4111-8111-111111111111',
  name: 'Cáliz',
  description: null,
  goal_amount: '100',
  status: 'active',
  sort_order: 0,
  created_at: '',
  updated_at: '',
  raised_amount: '40',
  image_url: null,
  alt_text: null,
  ...overrides,
});

describe('toWishlistItem', () => {
  it('maps numbers and defaults the description', () => {
    expect(toWishlistItem(row())).toMatchObject({ goal: 100, raised: 40, description: '', status: 'active' });
  });

  it('maps the donor count and defaults it to zero', () => {
    expect(toWishlistItem(row({ donor_count: '3' })).donorCount).toBe(3);
    expect(toWishlistItem(row()).donorCount).toBe(0);
  });

  it('derives funded when raised reaches the goal', () => {
    expect(toWishlistItem(row({ raised_amount: '100' })).status).toBe('funded');
    expect(toWishlistItem(row({ raised_amount: '120.50' })).status).toBe('funded');
  });

  it('stays active just below the goal', () => {
    expect(toWishlistItem(row({ raised_amount: '99.99' })).status).toBe('active');
  });
});

describe('sortForPublic', () => {
  it('puts active items before funded ones and keeps the given order inside each group', () => {
    const mk = (id: string, raised: string) => toWishlistItem(row({ id, raised_amount: raised }));
    const sorted = sortForPublic([mk('a', '100'), mk('b', '0'), mk('c', '100'), mk('d', '5')]);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});
