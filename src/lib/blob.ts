const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

export function isCenterBlobUrl(value: string, slug: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith(BLOB_HOST_SUFFIX) &&
      url.pathname.startsWith(`/${slug}/`)
    );
  } catch {
    return false;
  }
}

export function isBlobUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}
