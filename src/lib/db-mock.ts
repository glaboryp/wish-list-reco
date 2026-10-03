const RECOLETOS_ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const MANAGER_EMAIL = 'manager@example.org';

const baseCenter = {
  status: 'active',
  hero_title: 'Ayúdanos a reparar el oratorio',
  hero_text: 'Primer párrafo.\n\nSegundo párrafo.',
  hero_image_url: null,
  logo_url: null,
  primary_color: '#007986',
  paypal_client_id: 'test',
  paypal_secret_encrypted: 'v1:a:b:c',
  paypal_env: 'sandbox',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const centers = [
  { ...baseCenter, id: RECOLETOS_ID, slug: 'recoletos', name: 'Recoletos' },
  { ...baseCenter, id: OTRO_ID, slug: 'otro', name: 'Otro centro' },
];

const item = {
  id: ITEM_ID,
  center_id: RECOLETOS_ID,
  name: 'Cáliz',
  description: 'Un cáliz para el oratorio',
  goal_amount: '100',
  raised_amount: '25',
  status: 'active',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  image_url: null,
  alt_text: null,
};

export function mockSql(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join('?');
  const has = (value: string) => values.includes(value);

  if (text.includes('JOIN centers')) {
    return has(MANAGER_EMAIL) ? [{ slug: 'recoletos', name: 'Recoletos' }] : [];
  }
  if (text.includes('FROM center_users')) {
    return has(RECOLETOS_ID) && has(MANAGER_EMAIL) ? [{ ok: 1 }] : [];
  }
  if (text.includes('FROM centers')) {
    const found = centers.filter((center) => has(center.slug));
    return found.length > 0 ? found : values.length === 0 ? centers : [];
  }
  if (text.includes('item_images img JOIN items')) {
    return has(RECOLETOS_ID)
      ? ['/favicon.webp', '/oratorio.webp'].map((image_url, sort_order) => ({
          id: `44444444-4444-4444-8444-44444444444${sort_order}`,
          item_id: ITEM_ID,
          image_url,
          alt_text: null,
          sort_order,
          created_at: '2026-01-01T00:00:00Z',
        }))
      : [];
  }
  if (text.includes('FROM items')) {
    return has(RECOLETOS_ID) ? [item] : [];
  }
  return [];
}
