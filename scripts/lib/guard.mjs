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

function hostFromDotenv(path) {
  if (!existsSync(path)) return null;
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .find((entry) => /^\s*POSTGRES_URL\s*=/.test(entry));
  if (!line) return null;
  return hostOf(line.replace(/^\s*POSTGRES_URL\s*=\s*/, '').trim().replace(/^["']|["']$/g, ''));
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
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  const dotenvHost = hostFromDotenv(dotenvPath);
  if (dotenvHost) protectedHosts.add(dotenvHost);

  if (protectedHosts.has(host)) {
    throw new Error('Refusing to run: POSTGRES_URL points at the production database');
  }
  if (env.ALLOW_REMOTE_DB_RESET !== '1') {
    throw new Error(
      'Refusing to run: POSTGRES_URL is not a local database. Set ALLOW_REMOTE_DB_RESET=1 to use a disposable remote database (for example a Neon branch)',
    );
  }
  return host;
}
