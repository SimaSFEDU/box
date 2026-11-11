import { enrichUrl } from '../src/domain/clips/enrich';
import { decodeHtml, fetchLimited, type FetchLike } from '../src/domain/clips/fetchLimited';

type Route = { status?: number; headers?: Record<string, string>; body?: string | Uint8Array; chunks?: number };

function fakeFetch(routes: Record<string, Route>, log: string[] = []): FetchLike {
  return async (url) => {
    log.push(url);
    const r = routes[url];
    if (!r) throw new Error('network down: ' + url);
    const bytes = typeof r.body === 'string' ? new TextEncoder().encode(r.body) : (r.body ?? new Uint8Array());
    const res = new Response(bytes as Uint8Array<ArrayBuffer>, { status: r.status ?? 200, headers: r.headers });
    return { status: res.status, headers: res.headers, body: res.body, arrayBuffer: () => res.arrayBuffer() };
  };
}

const opts = { maxBytes: 100, timeoutMs: 1000, accept: '*/*', allowTruncate: false };

describe('fetchLimited', () => {
  it('follows redirects but re-checks every hop', async () => {
    const f = fakeFetch({
      'https://a.com/': { status: 301, headers: { location: '/b' } },
      'https://a.com/b': { body: 'ok', headers: { 'content-type': 'text/plain' } },
      'https://evil.com/': { status: 302, headers: { location: 'http://169.254.169.254/' } },
    });
    expect((await fetchLimited(f, 'https://a.com/', opts)).finalUrl).toBe('https://a.com/b');
    await expect(fetchLimited(f, 'https://evil.com/', opts)).rejects.toThrow('blocked');
    await expect(fetchLimited(f, 'http://localhost/', opts)).rejects.toThrow('blocked');
  });
  it('enforces the byte cap', async () => {
    const f = fakeFetch({ 'https://big.com/': { body: 'x'.repeat(500) } });
    await expect(fetchLimited(f, 'https://big.com/', opts)).rejects.toThrow('too large');
    const r = await fetchLimited(f, 'https://big.com/', { ...opts, allowTruncate: true });
    expect(r.bytes.length).toBe(100);
    expect(r.truncated).toBe(true);
  });
  it('rejects redirect loops and http errors', async () => {
    const f = fakeFetch({ 'https://l.com/': { status: 302, headers: { location: 'https://l.com/' } }, 'https://e.com/': { status: 500 } });
    await expect(fetchLimited(f, 'https://l.com/', opts)).rejects.toThrow('too many redirects');
    await expect(fetchLimited(f, 'https://e.com/', opts)).rejects.toThrow('http 500');
  });
  it('decodes charsets', () => {
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // "Привет"
    expect(decodeHtml(cp1251, 'text/html; charset=windows-1251')).toBe('Привет');
  });
});

describe('enrichUrl', () => {
  it('uses oEmbed for YouTube and downloads the thumbnail', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const f = fakeFetch({
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fabc': {
        body: JSON.stringify({ title: 'Talk', provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/vi/abc/hq.jpg' }),
        headers: { 'content-type': 'application/json' },
      },
      'https://i.ytimg.com/vi/abc/hq.jpg': { body: png, headers: { 'content-type': 'image/jpeg' } },
    });
    const r = await enrichUrl(f, 'https://youtu.be/abc');
    expect(r.meta).toMatchObject({ title: 'Talk', siteName: 'YouTube' });
    expect(r.image?.bytes).toEqual(png);
  });
  it('falls back to HTML and tolerates a broken image', async () => {
    const f = fakeFetch({
      'https://site.com/p': { body: '<head><meta property="og:title" content="Page"><meta property="og:image" content="/i.png"></head>', headers: { 'content-type': 'text/html' } },
      'https://site.com/i.png': { body: '<html>not an image</html>', headers: { 'content-type': 'text/html' } },
    });
    const r = await enrichUrl(f, 'https://site.com/p');
    expect(r.meta.title).toBe('Page');
    expect(r.image).toBeNull();
  });
  it('throws when offline (clip itself is already saved by then)', async () => {
    await expect(enrichUrl(fakeFetch({}), 'https://x.com/')).rejects.toThrow('network down');
  });
});
