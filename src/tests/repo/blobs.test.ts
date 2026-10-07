import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockDel } = vi.hoisted(() => ({ mockSql: vi.fn(), mockDel: vi.fn() }));

vi.mock('../../lib/db', () => ({ default: mockSql }));
vi.mock('@vercel/blob', () => ({ del: mockDel }));

import { discardBlobs } from '../../lib/repo/blobs';

const A = 'https://x.public.blob.vercel-storage.com/c/a.png';
const B = 'https://x.public.blob.vercel-storage.com/c/b.png';

describe('discardBlobs', () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockDel.mockReset();
  });

  it('deletes the files nothing references any more', async () => {
    mockSql.mockResolvedValueOnce([]);
    await discardBlobs([A, B, A]);
    expect(mockDel).toHaveBeenCalledWith([A, B]);
  });

  it('keeps a file that another row still uses', async () => {
    mockSql.mockResolvedValueOnce([{ url: A }]);
    await discardBlobs([A, B]);
    expect(mockDel).toHaveBeenCalledWith([B]);
  });

  it('ignores empty values and files that are not in Vercel Blob without touching the database', async () => {
    await discardBlobs([null, undefined, '', '/oratorio.webp', 'https://example.com/a.png']);
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('does not call Blob when every file is still in use', async () => {
    mockSql.mockResolvedValueOnce([{ url: A }]);
    await discardBlobs([A]);
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('never fails the caller when Blob or the database fail', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSql.mockResolvedValueOnce([]);
    mockDel.mockRejectedValueOnce(new Error('blob down'));
    await expect(discardBlobs([A])).resolves.toBeUndefined();
    mockSql.mockRejectedValueOnce(new Error('db down'));
    await expect(discardBlobs([A])).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
