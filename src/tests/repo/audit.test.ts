import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock('../../lib/db', () => ({ default: mockSql }));

import { AUDIT_PAGE_SIZE, listAudit, recordAudit } from '../../lib/repo/audit';
import { bumpSessionVersion, getSessionVersion } from '../../lib/repo/sessions';

const entry = { centerId: 'c1', actorEmail: 'ana@example.org', action: 'item.update', entityType: 'item', summary: 'x' };

beforeEach(() => mockSql.mockReset());

describe('recordAudit', () => {
  it('writes the entry', async () => {
    mockSql.mockResolvedValue([]);
    await recordAudit(entry);
    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(mockSql.mock.calls[0].slice(1)).toEqual(['c1', 'ana@example.org', 'item.update', 'item', null, 'x']);
  });

  it('never throws when the write fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSql.mockRejectedValueOnce(new Error('db down'));
    await expect(recordAudit(entry)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('listAudit', () => {
  it('pages by the page size and returns the total', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ total: '75' }]);
    const result = await listAudit('c1', 2);
    expect(result).toEqual({ rows: [{ id: 'a' }], total: 75 });
    expect(mockSql.mock.calls[0].slice(1)).toEqual(['c1', AUDIT_PAGE_SIZE, AUDIT_PAGE_SIZE]);
  });
});

describe('session versions', () => {
  it('defaults to 0 when the email has no row', async () => {
    mockSql.mockResolvedValue([]);
    expect(await getSessionVersion('Ana@Example.org')).toBe(0);
    expect(mockSql.mock.calls[0][1]).toBe('ana@example.org');
  });

  it('reads and bumps the stored version', async () => {
    mockSql.mockResolvedValueOnce([{ session_version: 2 }]);
    expect(await getSessionVersion('ana@example.org')).toBe(2);
    mockSql.mockResolvedValueOnce([{ session_version: 3 }]);
    expect(await bumpSessionVersion('ana@example.org')).toBe(3);
  });
});
