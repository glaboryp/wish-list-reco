import { describe, expect, it } from 'vitest';
import { END_OF_LIST } from '../../lib/admin/forms';
import { positionOptions } from '../../lib/admin/positions';

const items = [
  { id: 'a', name: 'Cáliz', status: 'active' },
  { id: 'b', name: 'Proyector', status: 'draft' },
  { id: 'c', name: 'Viejo', status: 'archived' },
];

describe('positionOptions', () => {
  it('offers every visible position plus the end of the list for a new item', () => {
    const options = positionOptions(items);
    expect(options.map((option) => option.value)).toEqual([1, 2, END_OF_LIST]);
    expect(options.find((option) => option.selected)?.value).toBe(END_OF_LIST);
  });

  it('selects the current position of an existing item and skips archived ones', () => {
    const options = positionOptions(items, 'b');
    expect(options.map((option) => option.value)).toEqual([1, 2]);
    expect(options.find((option) => option.selected)).toMatchObject({ value: 2, label: 'Posición 2: la actual' });
    expect(options[0].label).toBe('Posición 1: ahora «Cáliz»');
  });

  it('treats an archived item like a new one', () => {
    const options = positionOptions(items, 'c');
    expect(options.find((option) => option.selected)?.value).toBe(END_OF_LIST);
  });
});
