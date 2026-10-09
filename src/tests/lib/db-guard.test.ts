import { describe, expect, it } from 'vitest';
import { assertSafeDatabase } from '../../../scripts/lib/guard.mjs';

const check = (env: Record<string, string>) => () => assertSafeDatabase(env, '/nonexistent/.env');

describe('database safety guard', () => {
  it('allows local hosts', () => {
    expect(check({ POSTGRES_URL: 'postgres://u:p@db.localtest.me:5432/main' })).not.toThrow();
    expect(check({ POSTGRES_URL: 'postgres://u:p@localhost:5432/main' })).not.toThrow();
  });

  it('refuses a remote host unless explicitly allowed', () => {
    const url = 'postgres://u:p@ep-branch.neon.tech/main';
    expect(check({ POSTGRES_URL: url })).toThrow(/not a local database/);
    expect(check({ POSTGRES_URL: url, ALLOW_REMOTE_DB_RESET: '1' })).not.toThrow();
  });

  it('refuses the production host even when remote resets are allowed', () => {
    expect(
      check({ POSTGRES_URL: 'postgres://u:p@ep-prod.neon.tech/main', ALLOW_REMOTE_DB_RESET: '1', PRODUCTION_DB_HOST: 'ep-prod.neon.tech' }),
    ).toThrow(/production/);
  });

  it('refuses production environments and invalid URLs without leaking secrets', () => {
    expect(check({ POSTGRES_URL: 'postgres://u:p@localhost/main', VERCEL: '1' })).toThrow(/production/);
    expect(check({ POSTGRES_URL: '' })).toThrow(/missing/);
    let message = '';
    try {
      check({ POSTGRES_URL: 'postgres://u:secret@ep-prod.neon.tech/main', PRODUCTION_DB_HOST: 'ep-prod.neon.tech' })();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('secret');
  });
});
