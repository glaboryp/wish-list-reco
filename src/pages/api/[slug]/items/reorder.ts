import type { APIRoute } from 'astro';
import { parseItemIds } from '../../../../lib/admin/forms';
import { authorizeCenter, getActor } from '../../../../lib/auth/access';
import { reorderItems } from '../../../../lib/repo/items';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params, cookies }) => {
  const access = await authorizeCenter(await getActor(cookies), params.slug ?? '');
  if (!access.ok) return new Response(null, { status: access.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Petición no válida' }, 400);
  }
  const rawIds = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(rawIds)) return json({ error: 'Petición no válida' }, 400);
  const ids = parseItemIds(rawIds);
  if (ids.length === 0) return json({ error: 'Petición no válida' }, 400);

  await reorderItems(access.center.id, ids);
  return json({ ok: true });
};
