import { neon } from '@neondatabase/serverless';

const mode = process.argv[2];
if (!process.env.POSTGRES_URL || !['before', 'after'].includes(mode)) {
  console.error('Usage: POSTGRES_URL=... node scripts/snapshot-totals.mjs before|after');
  process.exit(1);
}

const sql = neon(process.env.POSTGRES_URL);

const rows =
  mode === 'before'
    ? await sql.query('SELECT id, raised_amount::numeric(10,2)::text AS raised FROM items ORDER BY id')
    : await sql.query(
        `SELECT i.id, COALESCE(SUM(d.amount) FILTER (WHERE d.voided_at IS NULL), 0)::numeric(10,2)::text AS raised
         FROM items i LEFT JOIN donations d ON d.item_id = i.id
         GROUP BY i.id ORDER BY i.id`,
      );

console.log(JSON.stringify(rows, null, 2));
