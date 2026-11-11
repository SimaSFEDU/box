import { decodeHtml, fetchLimited, type FetchLike } from './fetchLimited';
import { mergeMetadata, oembedEndpoint, parseHtmlMetadata, parseOembed, type PageMetadata } from './metadata';

export const HTML_MAX_BYTES = 512 * 1024;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 8000;

export interface EnrichResult {
  meta: PageMetadata;
  image: { bytes: Uint8Array; contentType: string } | null;
}

/**
 * Fetches page metadata (+ preview image). oEmbed and HTML are tried independently; either is enough.
 * Throws only if nothing at all could be obtained.
 */
export async function enrichUrl(fetchImpl: FetchLike, url: string): Promise<EnrichResult> {
  let html: PageMetadata | null = null;
  let oembed: Partial<PageMetadata> | null = null;
  const errors: unknown[] = [];

  const endpoint = oembedEndpoint(url);
  if (endpoint) {
    try {
      const r = await fetchLimited(fetchImpl, endpoint, { maxBytes: 64 * 1024, timeoutMs: TIMEOUT_MS, accept: 'application/json', allowTruncate: false });
      oembed = parseOembed(JSON.parse(new TextDecoder().decode(r.bytes)), url);
    } catch (e) {
      errors.push(e);
    }
  }
  if (!oembed?.title) {
    try {
      const r = await fetchLimited(fetchImpl, url, { maxBytes: HTML_MAX_BYTES, timeoutMs: TIMEOUT_MS, accept: 'text/html,application/xhtml+xml', allowTruncate: true });
      if (r.contentType.includes('html') || r.contentType === '') html = parseHtmlMetadata(decodeHtml(r.bytes, r.contentType), r.finalUrl);
    } catch (e) {
      errors.push(e);
    }
  }
  if (!html && !oembed) throw errors[0] ?? new Error('no metadata');
  const meta = mergeMetadata(html, oembed);

  let image: EnrichResult['image'] = null;
  if (meta.imageUrl) {
    try {
      const r = await fetchLimited(fetchImpl, meta.imageUrl, { maxBytes: IMAGE_MAX_BYTES, timeoutMs: TIMEOUT_MS, accept: 'image/*', allowTruncate: false });
      if (/^image\/(png|jpe?g|gif|webp|avif)/.test(r.contentType)) image = { bytes: r.bytes, contentType: r.contentType.split(';')[0]! };
    } catch {
      /* preview is optional */
    }
  }
  return { meta, image };
}
