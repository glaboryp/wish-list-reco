import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('recognises the production database through its pooled and unpooled hostnames', () => {
    const base = { ALLOW_REMOTE_DB_RESET: '1' };
    const pooled = 'postgres://u:p@ep-cool-1234-pooler.eu-central-1.aws.neon.tech/main';
    const direct = 'postgres://u:p@ep-cool-1234.eu-central-1.aws.neon.tech/main';
    expect(check({ ...base, POSTGRES_URL: direct, PRODUCTION_DB_HOST: 'ep-cool-1234-pooler.eu-central-1.aws.neon.tech' })).toThrow(/production/);
    expect(check({ ...base, POSTGRES_URL: pooled, PRODUCTION_DB_HOST: 'EP-COOL-1234.eu-central-1.aws.neon.tech' })).toThrow(/production/);
    expect(check({ ...base, POSTGRES_URL: pooled, PRODUCTION_DB_HOST: 'ep-other-9999.eu-central-1.aws.neon.tech' })).not.toThrow();
  });

  it('treats a Neon host as remote and needs the explicit opt-in', () => {
    const url = 'postgres://u:p@ep-cool-1234-pooler.eu-central-1.aws.neon.tech/main';
    expect(check({ POSTGRES_URL: url })).toThrow(/not a local database/);
  });

  it('reads both connection strings from the dotenv file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'));
    const dotenv = join(dir, '.env');
    writeFileSync(
      dotenv,
      'POSTGRES_URL="postgres://u:p@ep-cool-1234-pooler.eu-central-1.aws.neon.tech/main"\nPOSTGRES_URL_NON_POOLING=postgres://u:p@ep-cool-1234.eu-central-1.aws.neon.tech/main\n',
    );
    for (const host of ['ep-cool-1234.eu-central-1.aws.neon.tech', 'ep-cool-1234-pooler.eu-central-1.aws.neon.tech']) {
      expect(() => assertSafeDatabase({ POSTGRES_URL: `postgres://u:p@${host}/main`, ALLOW_REMOTE_DB_RESET: '1' }, dotenv)).toThrow(/production/);
    }
    rmSync(dir, { recursive: true });
  });
});
