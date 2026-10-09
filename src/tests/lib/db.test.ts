import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNeon } = vi.hoisted(() => ({
  mockNeon: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: mockNeon,
  neonConfig: {},
}));

describe('database client configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('fails clearly when the server database URL is missing', async () => {
    vi.stubEnv('POSTGRES_URL', '');

    await expect(import('../../lib/db')).rejects.toThrow(
      'POSTGRES_URL no está configurada',
    );
    expect(mockNeon).not.toHaveBeenCalled();
  });
});
