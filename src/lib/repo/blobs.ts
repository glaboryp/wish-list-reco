import { del } from '@vercel/blob';
import sql from '../db';
import { isBlobUrl } from '../blob';

export async function discardBlobs(urls: (string | null | undefined)[]): Promise<void> {
  const candidates = [...new Set(urls.filter(isBlobUrl))];
  if (candidates.length === 0) return;
  try {
    const used = await sql`
      SELECT hero_image_url AS url FROM centers WHERE hero_image_url = ANY(${candidates})
      UNION SELECT logo_url FROM centers WHERE logo_url = ANY(${candidates})
      UNION SELECT image_url FROM item_images WHERE image_url = ANY(${candidates})
    `;
    const inUse = new Set(used.map((row: Record<string, unknown>) => row.url as string));
    const unused = candidates.filter((url) => !inUse.has(url));
    if (unused.length > 0) await del(unused);
  } catch (error) {
    console.error('Could not delete files from Vercel Blob', error);
  }
}
