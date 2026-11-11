/**
 * Page metadata extraction from raw HTML without a DOM (regex over <head>):
 * Open Graph → Twitter Card → <title>/<meta name=description> → <link rel=canonical>.
 * Input is attacker-controlled; output is plain text (entities decoded, tags stripped, length-capped)
 * and is never rendered as HTML.
 */
export interface PageMetadata {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  canonicalUrl: string | null;
  ogType: string | null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function clean(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const out = decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return out ? out.slice(0, max) : null;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]!.toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

function absolutize(url: string | null, base: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(decodeEntities(url.trim()), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseHtmlMetadata(html: string, baseUrl: string): PageMetadata {
  const headEnd = html.search(/<\/head>|<body[\s>]/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 200_000);
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, a.content);
  }
  let canonical: string | null = null;
  for (const m of head.matchAll(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const a = attrs(m[0]);
    if ((a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')) canonical = a.href ?? null;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null;
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag ?? meta.get('title'), 300),
    description: clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'), 1000),
    siteName: clean(meta.get('og:site_name') ?? meta.get('application-name'), 100),
    imageUrl: absolutize(meta.get('og:image:secure_url') ?? meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? meta.get('twitter:image:src') ?? null, baseUrl),
    canonicalUrl: absolutize(meta.get('og:url') ?? canonical, baseUrl),
    ogType: clean(meta.get('og:type'), 50),
  };
}

/** oEmbed endpoints for hosts whose HTML is unhelpful to crawlers (JS apps, consent walls). */
export function oembedEndpoint(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, '');
  } catch {
    return null;
  }
  const q = encodeURIComponent(url);
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') return `https://www.youtube.com/oembed?format=json&url=${q}`;
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return `https://www.tiktok.com/oembed?url=${q}`;
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) return `https://www.reddit.com/oembed?url=${q}`;
  if (host === 'open.spotify.com') return `https://open.spotify.com/oembed?url=${q}`;
  if (host === 'soundcloud.com') return `https://soundcloud.com/oembed?format=json&url=${q}`;
  return null;
}

export function parseOembed(json: unknown, base: string): Partial<PageMetadata> {
  if (!json || typeof json !== 'object') return {};
  const o = json as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    title: clean(str(o.title), 300),
    siteName: clean(str(o.provider_name), 100),
    imageUrl: absolutize(str(o.thumbnail_url), base),
    description: clean(str(o.author_name) ? `${str(o.author_name)}` : null, 200),
  };
}

/** Merges oEmbed (preferred for platform pages) over HTML metadata, field by field. */
export function mergeMetadata(html: PageMetadata | null, oembed: Partial<PageMetadata> | null): PageMetadata {
  const base: PageMetadata = html ?? { title: null, description: null, siteName: null, imageUrl: null, canonicalUrl: null, ogType: null };
  if (!oembed) return base;
  return {
    title: oembed.title ?? base.title,
    description: base.description ?? oembed.description ?? null,
    siteName: oembed.siteName ?? base.siteName,
    imageUrl: oembed.imageUrl ?? base.imageUrl,
    canonicalUrl: base.canonicalUrl,
    ogType: base.ogType,
  };
}
