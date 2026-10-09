import { randomUUID } from 'node:crypto';
import { encryptSecret } from '../src/lib/crypto.ts';
import { assertSafeDatabase } from './lib/guard.mjs';
import { createSql } from './lib/sql.mjs';

try {
  assertSafeDatabase();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error('ENCRYPTION_KEY is required to store the sandbox PayPal secret');
  process.exit(1);
}

const sql = createSql();
const DAY = 24 * 60 * 60 * 1000;
const round2 = (value) => Math.round(value * 100) / 100;

const paypalSecret = encryptSecret(process.env.PAYPAL_SANDBOX_SECRET ?? 'seed-sandbox-secret', process.env.ENCRYPTION_KEY);
const paypalClientId = process.env.PAYPAL_SANDBOX_CLIENT_ID ?? 'seed-sandbox-client-id';

const centers = [
  {
    slug: 'recoletos',
    name: 'Oratorio de Recoletos',
    heroTitle: 'Ayúdanos a reparar los objetos litúrgicos del oratorio de Recoletos',
    heroText: 'Recoletos cumple 50 años y queremos arreglar entre todos los objetos litúrgicos del oratorio.',
    heroImage: '/oratorio.webp',
    logo: '/logo_recoletos_alargado.webp',
    color: '#007986',
    managers: ['ana.recoletos@example.org', 'marta.recoletos@example.org'],
    items: [
      { name: 'Cáliz de plata', goal: 300, status: 'active', raised: 120, images: ['/oratorio.webp', '/icono.webp'] },
      { name: 'Casulla blanca', goal: 250, status: 'active', raised: 240, images: ['/oratorio.webp'] },
      { name: 'Sagrario nuevo', goal: 800, status: 'active', raised: 800, images: ['/oratorio.webp', '/logo_cuadrado.webp', '/icono.webp'] },
      { name: 'Candelabros del altar', goal: 150, status: 'active', raised: 150, images: ['/icono.webp'] },
      { name: 'Atril para las lecturas', goal: 90, status: 'draft', raised: 0, images: [] },
      { name: 'Alba antigua', goal: 60, status: 'archived', raised: 60, images: ['/icono.webp'] },
      { name: 'Campanilla', goal: 45, status: 'active', raised: 0, images: ['/icono.webp'] },
      { name: 'Mantel de altar', goal: 120, status: 'active', raised: 30, images: ['/oratorio.webp'] },
    ],
  },
  {
    slug: 'santa-clara',
    name: 'Colegio Santa Clara',
    heroTitle: 'Renovemos la capilla del colegio',
    heroText: 'Entre todos queremos dejar la capilla lista para el nuevo curso.',
    heroImage: '/oratorio.webp',
    logo: '/logo_cuadrado.webp',
    color: '#7a3e9d',
    managers: ['lucia.santaclara@example.org'],
    items: [
      { name: 'Bancos de la capilla', goal: 500, status: 'active', raised: 210, images: ['/oratorio.webp'] },
      { name: 'Vidriera', goal: 400, status: 'active', raised: 395, images: ['/icono.webp'] },
      { name: 'Equipo de megafonía', goal: 180, status: 'active', raised: 180, images: ['/logo_cuadrado.webp'] },
      { name: 'Cuadro del patrón', goal: 75, status: 'draft', raised: 0, images: [] },
    ],
  },
];

const CHUNKS = [10, 15, 20, 25, 5, 30, 50];
let captureCounter = 0;

function donationsFor(centerId, itemId, raised, centerIndex, itemIndex) {
  const rows = [];
  let remaining = raised;
  let k = 0;
  const at = (n) => new Date(Date.now() - (((n * 13 + centerIndex * 7 + itemIndex * 3) % 90) * DAY + (n % 24) * 3600 * 1000)).toISOString();
  while (remaining > 0) {
    const amount = Math.min(remaining, CHUNKS[(k + itemIndex) % CHUNKS.length]);
    remaining = round2(remaining - amount);
    const paypal = k % 3 !== 0;
    rows.push({
      centerId, itemId, amount, source: paypal ? 'paypal' : 'manual',
      fee: paypal ? round2(amount * 0.029 + 0.35) : 0,
      capture: paypal ? `SEED-CAPTURE-${++captureCounter}` : null,
      note: paypal ? null : 'Efectivo entregado en la sede',
      voidedAt: null, voidedBy: null, voidReason: null,
      createdAt: at(k + itemIndex * 5),
    });
    if (k % 6 === 5) {
      const voidedPaypal = (k / 6) % 2 === 0;
      rows.push({
        centerId, itemId, amount, source: voidedPaypal ? 'paypal' : 'manual',
        fee: voidedPaypal ? round2(amount * 0.029 + 0.35) : 0,
        capture: voidedPaypal ? `SEED-CAPTURE-${++captureCounter}` : null,
        note: voidedPaypal ? null : 'Registrada por error',
        voidedAt: at(k + itemIndex * 5 + 1),
        voidedBy: voidedPaypal ? 'ana.recoletos@example.org' : null,
        voidReason: voidedPaypal ? 'Reembolso solicitado por la donante' : null,
        createdAt: at(k + itemIndex * 5),
      });
    }
    k++;
  }
  return rows;
}

function multiInsert(table, columns, rows) {
  const params = [];
  const tuples = rows.map((row) => {
    const placeholders = row.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  return { text: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, params };
}

const statements = [];
const donations = [];

for (const [centerIndex, center] of centers.entries()) {
  await sql.query(
    `INSERT INTO centers (slug, name, hero_title, hero_text, hero_image_url, logo_url, primary_color, paypal_client_id, paypal_secret_encrypted, paypal_env)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sandbox')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, hero_title = EXCLUDED.hero_title, hero_text = EXCLUDED.hero_text,
       hero_image_url = EXCLUDED.hero_image_url, logo_url = EXCLUDED.logo_url, primary_color = EXCLUDED.primary_color,
       status = 'active', paypal_client_id = EXCLUDED.paypal_client_id, paypal_secret_encrypted = EXCLUDED.paypal_secret_encrypted,
       paypal_env = 'sandbox', updated_at = now()`,
    [center.slug, center.name, center.heroTitle, center.heroText, center.heroImage, center.logo, center.color, paypalClientId, paypalSecret],
  );
  const [{ id: centerId }] = await sql.query('SELECT id FROM centers WHERE slug = $1', [center.slug]);
  center.id = centerId;
  center.items.forEach((item, itemIndex) => {
    item.id = randomUUID();
    item.sortOrder = itemIndex;
    donations.push(...donationsFor(centerId, item.id, item.raised, centerIndex, itemIndex));
  });
}

const centerIds = centers.map((center) => center.id);
statements.push({ text: 'DELETE FROM donations WHERE center_id = ANY($1::uuid[])', params: [centerIds] });
statements.push({ text: 'DELETE FROM items WHERE center_id = ANY($1::uuid[])', params: [centerIds] });
statements.push({ text: 'DELETE FROM center_users WHERE center_id = ANY($1::uuid[])', params: [centerIds] });

statements.push(
  multiInsert('center_users', ['center_id', 'email'], centers.flatMap((center) => center.managers.map((email) => [center.id, email]))),
);
statements.push(
  multiInsert(
    'items',
    ['id', 'center_id', 'name', 'description', 'goal_amount', 'status', 'sort_order'],
    centers.flatMap((center) =>
      center.items.map((item) => [item.id, center.id, item.name, `${item.name}: pieza de ejemplo para pruebas.`, item.goal, item.status, item.sortOrder]),
    ),
  ),
);
statements.push(
  multiInsert(
    'item_images',
    ['item_id', 'image_url', 'sort_order'],
    centers.flatMap((center) => center.items.flatMap((item) => item.images.map((url, index) => [item.id, url, index]))),
  ),
);
statements.push(
  multiInsert(
    'donations',
    ['center_id', 'item_id', 'amount', 'fee_amount', 'currency', 'source', 'paypal_capture_id', 'note', 'voided_at', 'voided_by', 'void_reason', 'created_at'],
    donations.map((d) => [d.centerId, d.itemId, d.amount, d.fee, 'EUR', d.source, d.capture, d.note, d.voidedAt, d.voidedBy, d.voidReason, d.createdAt]),
  ),
);

await sql.transaction((tx) => statements.map((statement) => tx.query(statement.text, statement.params)));

for (const center of centers) {
  const count = donations.filter((d) => d.centerId === center.id).length;
  console.log(`${center.slug}: ${center.items.length} items, ${count} donations, managers: ${center.managers.join(', ')}`);
}
console.log('seed complete');
