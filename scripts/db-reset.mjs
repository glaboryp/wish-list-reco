import { spawnSync } from 'node:child_process';
import { assertSafeDatabase } from './lib/guard.mjs';

try {
  assertSafeDatabase();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

for (const script of ['migrate.mjs', 'seed.mjs']) {
  const result = spawnSync(process.execPath, [new URL(script, import.meta.url).pathname], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
