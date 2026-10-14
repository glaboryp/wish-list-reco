import { existsSync, readFileSync } from 'node:fs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function hostOf(connectionString) {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalHost(host) {
  return LOCAL_HOSTS.has(host) || host.endsWith('.localtest.me') || host === 'localtest.me';
}

export function normalizeHost(host) {
  return host.toLowerCase().replace(/-pooler(?=\.)/, '');
}

function hostsFromDotenv(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((entry) => /^\s*(export\s+)?POSTGRES_URL(_NON_POOLING)?\s*=/.test(entry))
    .map((line) => hostOf(line.replace(/^[^=]*=\s*/, '').trim().replace(/^["']|["']$/g, '')))
    .filter(Boolean);
}

export function assertSafeDatabase(env = process.env, dotenvPath = '.env') {
  const host = hostOf(env.POSTGRES_URL ?? '');
  if (!host) {
    throw new Error('POSTGRES_URL is missing or not a valid URL');
  }
  if (env.NODE_ENV === 'production' || env.VERCEL) {
    throw new Error('Refusing to run: this looks like a production environment');
  }
  if (isLocalHost(host)) return host;

  const protectedHosts = new Set(
    (env.PRODUCTION_DB_HOST ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(normalizeHost),
  );
  for (const dotenvHost of hostsFromDotenv(dotenvPath)) protectedHosts.add(normalizeHost(dotenvHost));

  if (protectedHosts.has(normalizeHost(host))) {
    throw new Error('Refusing to run: POSTGRES_URL points at the production database');
  }
  if (env.ALLOW_REMOTE_DB_RESET !== '1') {
    throw new Error(
      'Refusing to run: POSTGRES_URL is not a local database. Set ALLOW_REMOTE_DB_RESET=1 to use a disposable remote database (for example a Neon branch)',
    );
  }
  return host;
}
