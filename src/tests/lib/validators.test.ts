import { describe, expect, it } from 'vitest';
import { validateSlug } from '../../lib/slug';
import { isUuid } from '../../lib/ids';
import { contrastRatio, darken, isHexColor, isValidPrimaryColor } from '../../lib/color';
import { isCenterBlobUrl } from '../../lib/blob';
import { isSameOrigin } from '../../lib/http';

describe('validateSlug', () => {
  it.each(['recoletos', 'colegio-san-jose', 'a1'])('accepts %s', (slug) => {
    expect(validateSlug(slug)).toBeNull();
  });

  it.each(['A', 'x', 'Recoletos', 'con espacio', 'doble--guion', '-inicio', 'fin-', 'ñandú', 'a'.repeat(41)])(
    'rejects %s',
    (slug) => {
      expect(validateSlug(slug)).not.toBeNull();
    },
  );

  it.each(['admin', 'api', 'auth', 'login', 'item', '_astro'])('rejects reserved slug %s', (slug) => {
    expect(validateSlug(slug)).toBe('Ese identificador está reservado');
  });
});

describe('isUuid', () => {
  it('accepts a v4 uuid', () => {
    expect(isUuid('3f2b8c1e-5a4d-4c8e-9b7a-1d2e3f4a5b6c')).toBe(true);
  });

  it.each(['1', 'abc', '', undefined, null, 5, "' OR 1=1 --"])('rejects %s', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe('color', () => {
  it('accepts the current brand color', () => {
    expect(isValidPrimaryColor('#007986')).toBe(true);
  });

  it.each(['#ffeb3b', '#ffffff', '#fff', 'red', '#007986;background:url(x)', '', '#00798'])(
    'rejects %s',
    (value) => {
      expect(isValidPrimaryColor(value)).toBe(false);
    },
  );

  it('detects hex colors strictly', () => {
    expect(isHexColor('#a1B2c3')).toBe(true);
    expect(isHexColor('#a1B2c3 ')).toBe(false);
  });

  it('computes contrast against white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('darkens a color', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(darken('#007986', 0)).toBe('#007986');
  });
});

describe('isCenterBlobUrl', () => {
  const ok = 'https://abc123.public.blob.vercel-storage.com/recoletos/foto-xyz.webp';

  it('accepts a blob URL under the center prefix', () => {
    expect(isCenterBlobUrl(ok, 'recoletos')).toBe(true);
  });

  it.each([
    ['other center', ok, 'otro'],
    ['other host', 'https://evil.example.com/recoletos/foto.webp', 'recoletos'],
    ['http', 'http://abc123.public.blob.vercel-storage.com/recoletos/f.webp', 'recoletos'],
    ['javascript', 'javascript:alert(1)', 'recoletos'],
    ['not a url', 'recoletos/foto.webp', 'recoletos'],
    ['lookalike host', 'https://x.public.blob.vercel-storage.com.evil.com/recoletos/f.webp', 'recoletos'],
  ])('rejects %s', (_name, url, slug) => {
    expect(isCenterBlobUrl(url, slug)).toBe(false);
  });
});

describe('isSameOrigin', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://wish-list.vercel.app/api/auth/logout', { method: 'POST', headers });

  it('accepts a matching Origin', () => {
    expect(isSameOrigin(req({ origin: 'https://wish-list.vercel.app' }))).toBe(true);
  });

  it('falls back to Referer', () => {
    expect(isSameOrigin(req({ referer: 'https://wish-list.vercel.app/recoletos/admin' }))).toBe(true);
  });

  it('rejects a foreign Origin and missing headers', () => {
    expect(isSameOrigin(req({ origin: 'https://evil.example.com' }))).toBe(false);
    expect(isSameOrigin(req({}))).toBe(false);
  });
});
