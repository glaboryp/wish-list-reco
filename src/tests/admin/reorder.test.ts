import { describe, expect, it } from 'vitest';
import { moveAnnouncement, moveId } from '../../lib/admin/reorder';
import { parseBatch, parseItemIds } from '../../lib/admin/forms';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('moveId', () => {
  it('moves an id up or down and clamps at the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 5)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'a', 5)).toEqual(['b', 'c', 'a']);
  });

  it('ignores unknown ids and does not mutate the input', () => {
    const ids = ['a', 'b'];
    expect(moveId(ids, 'z', 1)).toBe(ids);
    moveId(ids, 'a', 1);
    expect(ids).toEqual(['a', 'b']);
  });

  it('describes the new position', () => {
    expect(moveAnnouncement('Cáliz', 2, 5)).toBe('«Cáliz» movido a la posición 2 de 5.');
  });
});

describe('batch parsing', () => {
  const form = (entries: [string, string][]) => {
    const data = new FormData();
    entries.forEach(([key, value]) => data.append(key, value));
    return data;
  };

  it('keeps valid unique ids only', () => {
    expect(parseItemIds([A, A, 'nope', B, 7])).toEqual([A, B]);
  });

  it('accepts a known action with at least one item', () => {
    expect(parseBatch(form([['batch_action', 'archive'], ['ids', A], ['ids', C]]))).toEqual({ ok: true, value: { action: 'archive', ids: [A, C] } });
  });

  it('rejects unknown actions and empty selections', () => {
    expect(parseBatch(form([['batch_action', 'delete'], ['ids', A]])).ok).toBe(false);
    expect(parseBatch(form([['batch_action', 'show']])).ok).toBe(false);
    expect(parseBatch(form([['batch_action', 'show'], ['ids', 'x']])).ok).toBe(false);
  });
});
