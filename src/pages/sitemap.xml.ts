import type { APIRoute } from 'astro';
import { listActiveCenters } from '../lib/repo/centers';
import { listPublicItems } from '../lib/repo/items';
import { buildSitemap } from '../lib/seo';

export const GET: APIRoute = async ({ url }) => {
  const centers = await listActiveCenters();
  const entries = await Promise.all(
    centers.map(async (center) => ({
      slug: center.slug,
      itemIds: (await listPublicItems(center.id)).map((item) => item.id),
    })),
  );
  return new Response(buildSitemap(url.origin, entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
