import type { APIRoute } from 'astro';
import { buildDonationsCsv } from '../../../lib/csv';
import { guardCenter } from '../../../lib/auth/guard';
import { isUuid } from '../../../lib/ids';
import { listAllDonations } from '../../../lib/repo/donations';

export const GET: APIRoute = async (context) => {
  const guard = await guardCenter(context);
  if (guard instanceof Response) return guard;
  const { center } = guard;

  const itemParam = context.url.searchParams.get('item') ?? '';
  const itemId = isUuid(itemParam) ? itemParam : null;
  const body = buildDonationsCsv(await listAllDonations(center.id, itemId));
  const filename = `donaciones-${center.slug}${itemId ? '-articulo' : ''}.csv`;

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
};
