import type { APIRoute } from 'astro';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { authorizeCenter, getActor } from '../../../lib/auth/access';

const ALLOWED_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params, cookies }) => {
  const access = await authorizeCenter(await getActor(cookies), params.slug ?? '');
  if (!access.ok) return new Response(null, { status: access.status });

  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`${access.center.slug}/`) || pathname.includes('..')) {
          throw new Error('Invalid upload path');
        }
        return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
      },
    });
    return json(result);
  } catch {
    return json({ error: 'No se pudo preparar la subida' }, 400);
  }
};
