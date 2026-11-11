import { isFetchAllowed } from './netGuard';

/** Minimal fetch contract (satisfied by expo/fetch in the app and Node's fetch in tests). */
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<{
  status: number;
  url?: string;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface LimitedResponse {
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
  truncated: boolean;
}

export class FetchBlockedError extends Error {}

/**
 * GET with: SSRF guard on every hop (manual redirects, max 5), overall timeout, and a hard byte cap
 * (body is streamed and cut off; we never buffer more than `maxBytes`).
 * Sends no cookies or identifying headers beyond a generic UA.
 */
export async function fetchLimited(
  fetchImpl: FetchLike,
  url: string,
  opts: { maxBytes: number; timeoutMs: number; accept: string; allowTruncate: boolean },
): Promise<LimitedResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      if (!isFetchAllowed(current)) throw new FetchBlockedError('blocked url');
      const res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { Accept: opts.accept, 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Clipbox/1.0', 'Accept-Language': 'en,ru;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`redirect without location (${res.status})`);
        current = new URL(loc, current).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new Error(`http ${res.status}`);
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      const declared = Number(res.headers.get('content-length') ?? NaN);
      if (!opts.allowTruncate && Number.isFinite(declared) && declared > opts.maxBytes) throw new Error('too large');

      const chunks: Uint8Array[] = [];
      let total = 0;
      let truncated = false;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (total + value.length > opts.maxBytes) {
            chunks.push(value.subarray(0, opts.maxBytes - total));
            total = opts.maxBytes;
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
          chunks.push(value);
          total += value.length;
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        truncated = buf.length > opts.maxBytes;
        chunks.push(buf.subarray(0, opts.maxBytes));
        total = Math.min(buf.length, opts.maxBytes);
      }
      if (truncated && !opts.allowTruncate) throw new Error('too large');
      const bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.length;
      }
      return { finalUrl: current, contentType, bytes, truncated };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

/** Decodes HTML bytes honouring a charset from headers or <meta charset>; defaults to UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const sniff = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1];
  const label = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
