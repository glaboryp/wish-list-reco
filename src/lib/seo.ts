import { formatEuro } from './format';
import type { WishlistItem } from '../types/database';

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
}

export interface SitemapCenter {
  slug: string;
  itemIds: string[];
}

const clean = (text: string): string => text.replace(/[\s ]+/g, ' ').trim();

export function truncate(text: string, max: number): string {
  const value = clean(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function absoluteUrl(value: string | null | undefined, origin: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, origin).href;
  } catch {
    return null;
  }
}

export function buildItemMeta(input: {
  item: Pick<WishlistItem, 'name' | 'description' | 'goal' | 'raised'>;
  centerName: string;
  path: string;
  image: string | null;
  origin: string;
}): PageMeta {
  const { item, centerName, path, image, origin } = input;
  const progress = clean(`${formatEuro(item.raised)} de ${formatEuro(item.goal)}`);
  const lead = `${truncate(item.description || `${item.name}.`, 120)} `;
  return {
    title: `${item.name} - ${centerName}`,
    description: truncate(`${lead}${progress} reunidos para ${centerName}.`, 200),
    canonical: new URL(path, origin).href,
    image: absoluteUrl(image, origin),
  };
}

export function buildCenterMeta(input: {
  name: string;
  heroTitle?: string | null;
  heroText: string;
  heroImage: string | null;
  logo: string | null;
  path: string;
  origin: string;
}): PageMeta {
  const { name, heroTitle, heroText, heroImage, logo, path, origin } = input;
  return {
    title: `${name} - Lista de deseos`,
    description: truncate(heroText || heroTitle || `Lista de deseos de ${name}`, 200),
    canonical: new URL(path, origin).href,
    image: absoluteUrl(heroImage ?? logo, origin),
  };
}

export function buildRobots(origin: string): string {
  return ['User-agent: *', 'Disallow: /admin', 'Disallow: /api/', 'Disallow: /login', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildSitemap(origin: string, centers: SitemapCenter[]): string {
  const paths = ['/'];
  for (const center of centers) {
    const base = `/${encodeURIComponent(center.slug)}`;
    paths.push(base, ...center.itemIds.map((id) => `${base}/item/${encodeURIComponent(id)}`));
  }
  const urls = paths.map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
