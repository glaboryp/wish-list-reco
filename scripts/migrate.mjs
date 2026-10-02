import { readFileSync, readdirSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error('POSTGRES_URL is required');
  process.exit(1);
}

const sql = neon(url);

await sql.query(
  'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
);
const applied = new Set((await sql.query('SELECT name FROM schema_migrations')).map((row) => row.name));

const dir = new URL('../db/migrations/', import.meta.url);
const files = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  const statements = readFileSync(new URL(file, dir), 'utf8')
    .split('-- breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  await sql.transaction((tx) => [
    ...statements.map((statement) => tx.query(statement)),
    tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]),
  ]);
  console.log(`applied ${file}`);
}
console.log('migrations up to date');
