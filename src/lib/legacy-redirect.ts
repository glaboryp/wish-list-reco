const LEGACY_HOST = 'wish-list-reco.vercel.app';
const CANONICAL_ORIGIN = 'https://wish-list-oratorio.vercel.app';
const LEGACY_ROOT_PATH = '/recoletos';

export function legacyRedirectTarget(url: URL): string | null {
  if (url.hostname.toLowerCase() !== LEGACY_HOST) return null;
  const path = url.pathname === '/' ? LEGACY_ROOT_PATH : url.pathname;
  return `${CANONICAL_ORIGIN}${path}${url.search}`;
}
