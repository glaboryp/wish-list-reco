import { describe, expect, it } from 'vitest';
import {
  parseAppearance,
  parseEmail,
  parseItem,
  parseManualDonation,
  parseNewCenter,
  parsePaypal,
} from '../../lib/admin/forms';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const BLOB = 'https://abc.public.blob.vercel-storage.com/recoletos/foto-1.webp';
const UUID = '3f2b8c1e-5a4d-4c8e-9b7a-1d2e3f4a5b6c';

describe('parseEmail', () => {
  it('trims and lowercases', () => {
    expect(parseEmail('  Ana@Example.ORG ')).toEqual({ ok: true, value: 'ana@example.org' });
  });

  it.each(['', 'sin-arroba', 'a@b', 'a b@c.d', null, undefined, `${'x'.repeat(250)}@a.org`])('rejects %s', (raw) => {
    expect(parseEmail(raw).ok).toBe(false);
  });
});

describe('parseAppearance', () => {
  const valid = {
    name: 'Recoletos',
    hero_title: 'Ayúdanos',
    hero_text: 'Uno\r\n\r\nDos',
    primary_color: '#007986',
    hero_image_url: '',
    logo_url: '',
  };

  it('accepts a valid form and normalizes line endings', () => {
    expect(parseAppearance(form(valid), 'recoletos')).toEqual({
      ok: true,
      value: {
        name: 'Recoletos',
        heroTitle: 'Ayúdanos',
        heroText: 'Uno\n\nDos',
        primaryColor: '#007986',
        heroImageUrl: null,
        logoUrl: null,
      },
    });
  });

  it('keeps an uploaded image URL from this center', () => {
    const result = parseAppearance(form({ ...valid, hero_image_url: BLOB }), 'recoletos');
    expect(result.ok && result.value.heroImageUrl).toBe(BLOB);
  });

  it('canonicalizes a URL with spaces in hero image', () => {
    const result = parseAppearance(form({ ...valid, hero_image_url: 'https://abc.public.blob.vercel-storage.com/recoletos/a b.webp' }), 'recoletos');
    expect(result.ok && result.value.heroImageUrl).toBe('https://abc.public.blob.vercel-storage.com/recoletos/a%20b.webp');
  });

  it.each([
    ['empty name', { name: ' ' }],
    ['long name', { name: 'x'.repeat(81) }],
    ['low contrast color', { primary_color: '#ffeb3b' }],
    ['css injection in color', { primary_color: '#007986;background:url(//evil)' }],
    ['foreign image', { hero_image_url: 'https://evil.example.com/a.png' }],
    ['other center image', { logo_url: 'https://abc.public.blob.vercel-storage.com/otro/a.webp' }],
    ['long text', { hero_text: 'x'.repeat(4001) }],
  ])('rejects %s', (_label, override) => {
    expect(parseAppearance(form({ ...valid, ...override }), 'recoletos').ok).toBe(false);
  });
});

describe('parseItem', () => {
  const valid = { name: 'Cáliz', description: 'Dorado', goal: '120,50', status: 'active', sort_order: '2', image_url: '' };

  it('accepts a valid item and reads a comma decimal', () => {
    expect(parseItem(form(valid), 'recoletos')).toEqual({
      ok: true,
      value: { name: 'Cáliz', description: 'Dorado', goal: 120.5, status: 'active', sortOrder: 2, imageUrl: null },
    });
  });

  it('defaults the sort order to 0', () => {
    const result = parseItem(form({ ...valid, sort_order: '' }), 'recoletos');
    expect(result.ok && result.value.sortOrder).toBe(0);
  });

  it('canonicalizes a URL with special characters in image', () => {
    const result = parseItem(form({ ...valid, image_url: 'https://abc.public.blob.vercel-storage.com/recoletos/a"b.webp' }), 'recoletos');
    expect(result.ok && result.value.imageUrl).toBe('https://abc.public.blob.vercel-storage.com/recoletos/a%22b.webp');
  });

  it.each([
    ['empty name', { name: '' }],
    ['zero goal', { goal: '0' }],
    ['negative goal', { goal: '-5' }],
    ['exponent goal', { goal: '1e9' }],
    ['three decimals', { goal: '10.123' }],
    ['text goal', { goal: 'mucho' }],
    ['goal over one million', { goal: '10000000' }],
    ['funded status', { status: 'funded' }],
    ['bogus status', { status: 'bogus' }],
    ['fractional sort order', { sort_order: '1.5' }],
    ['foreign image', { image_url: 'https://evil.example.com/a.png' }],
  ])('rejects %s', (_label, override) => {
    expect(parseItem(form({ ...valid, ...override }), 'recoletos').ok).toBe(false);
  });
});

describe('parseManualDonation', () => {
  it('accepts a valid donation', () => {
    expect(parseManualDonation(form({ item_id: UUID, amount: '25', note: 'efectivo' }))).toEqual({
      ok: true,
      value: { itemId: UUID, amount: 25, note: 'efectivo' },
    });
  });

  it.each([
    { item_id: '1', amount: '25', note: '' },
    { item_id: UUID, amount: '0', note: '' },
    { item_id: UUID, amount: '-3', note: '' },
    { item_id: UUID, amount: 'NaN', note: '' },
    { item_id: UUID, amount: '25', note: 'x'.repeat(201) },
  ])('rejects %j', (fields) => {
    expect(parseManualDonation(form(fields)).ok).toBe(false);
  });
});

describe('parsePaypal', () => {
  const clientId = 'AbCdEfGhIjKlMnOpQrSt';

  it('keeps a blank secret as null', () => {
    expect(parsePaypal(form({ client_id: clientId, env: 'live', secret: '' }))).toEqual({
      ok: true,
      value: { clientId, env: 'live', secret: null },
    });
  });

  it('returns a provided secret', () => {
    const result = parsePaypal(form({ client_id: clientId, env: 'sandbox', secret: 'EXAMPLE-SECRET' }));
    expect(result.ok && result.value.secret).toBe('EXAMPLE-SECRET');
  });

  it.each([
    { client_id: 'short', env: 'live', secret: '' },
    { client_id: `${clientId} x`, env: 'live', secret: '' },
    { client_id: clientId, env: 'production', secret: '' },
    { client_id: clientId, env: 'live', secret: 'con espacios' },
  ])('rejects %j', (fields) => {
    expect(parsePaypal(form(fields)).ok).toBe(false);
  });
});

describe('parseNewCenter', () => {
  it('lowercases the slug and validates it', () => {
    expect(parseNewCenter(form({ slug: 'Colegio-Norte', name: 'Colegio Norte' }))).toEqual({
      ok: true,
      value: { slug: 'colegio-norte', name: 'Colegio Norte' },
    });
  });

  it.each([
    { slug: 'admin', name: 'x' },
    { slug: 'con espacio', name: 'x' },
    { slug: 'valido', name: '' },
  ])('rejects %j', (fields) => {
    expect(parseNewCenter(form(fields)).ok).toBe(false);
  });
});
