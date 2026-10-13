import { describe, expect, it } from 'vitest';
import { absoluteUrl, buildItemMeta, buildCenterMeta, buildRobots, buildSitemap, truncate } from '../../lib/seo';

const origin = 'https://example.org';

describe('absoluteUrl', () => {
  it('resolves relative paths against the origin', () => {
    expect(absoluteUrl('/a.webp', origin)).toBe('https://example.org/a.webp');
  });

  it('keeps absolute urls', () => {
    expect(absoluteUrl('https://cdn.test/a.webp', origin)).toBe('https://cdn.test/a.webp');
  });

  it('returns null for empty input', () => {
    expect(absoluteUrl(null, origin)).toBeNull();
  });
});

describe('truncate', () => {
  it('collapses whitespace and cuts long text with an ellipsis', () => {
    expect(truncate('a  b\n c', 50)).toBe('a b c');
    const out = truncate('palabra '.repeat(40), 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildItemMeta', () => {
  const item = { name: 'Cáliz', description: 'Un cáliz para el oratorio', goal: 100, raised: 25, imageUrl: null, imageAlt: null, id: 'x', status: 'active' as const };

  it('includes progress and absolute image', () => {
    const meta = buildItemMeta({ item, centerName: 'Recoletos', path: '/recoletos/item/x', image: '/a.webp', origin });
    expect(meta.title).toBe('Cáliz - Recoletos');
    expect(meta.description).toMatch(/25,00 € de 100,00 €/);
    expect(meta.description).not.toContain(' ');
    expect(meta.image).toBe('https://example.org/a.webp');
    expect(meta.canonical).toBe('https://example.org/recoletos/item/x');
  });

  it('works without description or image', () => {
    const meta = buildItemMeta({ item: { ...item, description: '' }, centerName: 'Recoletos', path: '/p', image: null, origin });
    expect(meta.image).toBeNull();
    expect(meta.description).toMatch(/^Cáliz/);
  });
});

describe('buildCenterMeta', () => {
  it('uses hero text and image', () => {
    const meta = buildCenterMeta({ name: 'Recoletos', heroTitle: 'Hola', heroText: 'Primer párrafo\n\nSegundo', heroImage: '/h.webp', logo: null, path: '/recoletos', origin });
    expect(meta.title).toBe('Recoletos - Lista de deseos');
    expect(meta.description).toBe('Primer párrafo Segundo');
    expect(meta.image).toBe('https://example.org/h.webp');
  });
});

describe('robots and sitemap', () => {
  it('points robots at the sitemap and blocks admin', () => {
    const txt = buildRobots(origin);
    expect(txt).toContain('Disallow: /admin');
    expect(txt).toContain('Sitemap: https://example.org/sitemap.xml');
  });

  it('lists centers and items with escaped urls', () => {
    const xml = buildSitemap(origin, [{ slug: 'rec&x', itemIds: ['a', 'b'] }]);
    expect(xml).toContain('<loc>https://example.org/</loc>');
    expect(xml).toContain('<loc>https://example.org/rec&amp;x</loc>'.replace('rec&amp;x', 'rec%26x'));
    expect(xml).toContain('/item/b</loc>');
  });
});
