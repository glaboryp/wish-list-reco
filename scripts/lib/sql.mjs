import { neon, neonConfig } from '@neondatabase/serverless';

export function createSql(env = process.env) {
  if (env.NEON_FETCH_ENDPOINT) {
    neonConfig.fetchEndpoint = env.NEON_FETCH_ENDPOINT;
    neonConfig.useSecureWebSocket = false;
  }
  return neon(env.POSTGRES_URL);
}
