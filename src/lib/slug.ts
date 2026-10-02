export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'auth',
  'login',
  'logout',
  'item',
  '_astro',
  'favicon',
  'robots',
  'sitemap',
  'assets',
  'static',
  'public',
]);

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateSlug(slug: string): string | null {
  if (slug.length < 2 || slug.length > 40) {
    return 'El identificador debe tener entre 2 y 40 caracteres';
  }
  if (RESERVED_SLUGS.has(slug)) {
    return 'Ese identificador está reservado';
  }
  if (!SLUG_PATTERN.test(slug)) {
    return 'Solo minúsculas, números y guiones simples';
  }
  return null;
}
