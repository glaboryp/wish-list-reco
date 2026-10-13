import { describe, expect, it } from 'vitest';
import {
  END_OF_LIST,
  parseAppearance,
  parseEmail,
  parseFees,
  parseImageUrl,
  parseItem,
  parseManualDonation,
  parseNewCenter,
  parseNotifySettings,
  parsePaypal,
  parseVoidDonation,
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
        removeHeroImage: false,
        removeLogo: false,
      },
    });
  });

  it('flags an image for removal only when asked and no new image is sent', () => {
    const removed = parseAppearance(form({ ...valid, remove_hero_image_url: '1', remove_logo_url: '1' }), 'recoletos');
    expect(removed.ok && removed.value).toMatchObject({ removeHeroImage: true, removeLogo: true, heroImageUrl: null, logoUrl: null });

    const replaced = parseAppearance(form({ ...valid, hero_image_url: BLOB, remove_hero_image_url: '1' }), 'recoletos');
    expect(replaced.ok && replaced.value).toMatchObject({ removeHeroImage: false, heroImageUrl: BLOB });

    const untouched = parseAppearance(form({ ...valid, remove_hero_image_url: '' }), 'recoletos');
    expect(untouched.ok && untouched.value).toMatchObject({ removeHeroImage: false, removeLogo: false });
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

  it('puts the item at the end of the list when no position is given', () => {
    const result = parseItem(form({ ...valid, sort_order: '' }), 'recoletos');
    expect(result.ok && result.value.sortOrder).toBe(END_OF_LIST);
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

describe('parseImageUrl', () => {
  it('accepts a blob URL of the same center', () => {
    const result = parseImageUrl(form({ image_url: 'https://abc.public.blob.vercel-storage.com/recoletos/a.webp' }), 'recoletos');
    expect(result).toEqual({ ok: true, value: 'https://abc.public.blob.vercel-storage.com/recoletos/a.webp' });
  });

  it.each([
    ['empty value', ''],
    ['other center', 'https://abc.public.blob.vercel-storage.com/otro/a.webp'],
    ['foreign host', 'https://evil.example.com/recoletos/a.webp'],
  ])('rejects %s', (_label, value) => {
    expect(parseImageUrl(form({ image_url: value }), 'recoletos').ok).toBe(false);
  });
});

describe('parseFees', () => {
  const valid = { paypal_percent: '2,9', paypal_fixed: '0,35', card_percent: '1.2', card_fixed: '0.35' };

  it('accepts commas and points as decimal separators', () => {
    expect(parseFees(form(valid))).toEqual({
      ok: true,
      value: { paypalPercent: 2.9, paypalFixed: 0.35, cardPercent: 1.2, cardFixed: 0.35 },
    });
  });

  it.each([
    ['empty percent', { paypal_percent: '' }],
    ['negative percent', { card_percent: '-1' }],
    ['percent above 20', { paypal_percent: '25' }],
    ['text percent', { card_percent: 'abc' }],
    ['fixed above 5', { paypal_fixed: '6' }],
    ['too many decimals', { card_fixed: '0,355' }],
  ])('rejects %s', (_label, override) => {
    expect(parseFees(form({ ...valid, ...override })).ok).toBe(false);
  });
});

describe('parseVoidDonation', () => {
  it('accepts a donation id with a reason', () => {
    expect(parseVoidDonation(form({ donation_id: UUID, reason: '  reembolso en PayPal ' }))).toEqual({
      ok: true,
      value: { donationId: UUID, reason: 'reembolso en PayPal' },
    });
  });

  it.each([
    { donation_id: '1', reason: 'reembolso' },
    { donation_id: UUID, reason: '' },
    { donation_id: UUID, reason: 'ab' },
    { donation_id: UUID, reason: 'x'.repeat(201) },
  ])('rejects %j', (fields) => {
    expect(parseVoidDonation(form(fields)).ok).toBe(false);
  });
});

describe('parseNotifySettings', () => {
  it('accepts each and none', () => {
    expect(parseNotifySettings(form({ notify_mode: 'each' }))).toEqual({ ok: true, value: { mode: 'each' } });
    expect(parseNotifySettings(form({ notify_mode: 'none' }))).toEqual({ ok: true, value: { mode: 'none' } });
  });

  it('rejects anything else, including the not yet implemented daily mode', () => {
    expect(parseNotifySettings(form({ notify_mode: 'daily' })).ok).toBe(false);
    expect(parseNotifySettings(form({})).ok).toBe(false);
  });
});
