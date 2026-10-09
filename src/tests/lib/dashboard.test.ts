import { describe, expect, it } from 'vitest';
import { countItemsByStatus, itemsNearCompletion } from '../../lib/dashboard';
import type { AdminItem } from '../../types/database';

const item = (overrides: Partial<AdminItem>): AdminItem => ({
    id: 'x',
    name: 'Item',
    description: '',
    goal: 100,
    raised: 0,
    status: 'active',
    sortOrder: 0,
    imageUrl: null,
    imageAlt: null,
    donationCount: 0,
    blockingDonationCount: 0,
    ...overrides,
});

describe('countItemsByStatus', () => {
    it('splits items into visible, completed, hidden and archived', () => {
        const counts = countItemsByStatus([
            item({}),
            item({ raised: 40 }),
            item({ raised: 100, status: 'funded' }),
            item({ raised: 100 }),
            item({ status: 'draft' }),
            item({ status: 'archived', raised: 100 }),
        ]);
        expect(counts).toEqual({ visible: 2, completed: 2, hidden: 1, archived: 1 });
    });
});

describe('itemsNearCompletion', () => {
    it('keeps unfinished visible items at 75% or more, closest first', () => {
        const result = itemsNearCompletion([
            item({ id: 'a', raised: 75 }),
            item({ id: 'b', raised: 99.5 }),
            item({ id: 'c', raised: 74.99 }),
            item({ id: 'd', raised: 100 }),
            item({ id: 'e', raised: 90, status: 'draft' }),
            item({ id: 'f', raised: 90, status: 'archived' }),
        ]);
        expect(result.map((entry) => entry.id)).toEqual(['b', 'a']);
        expect(result[0].percent).toBe(99);
    });
});
