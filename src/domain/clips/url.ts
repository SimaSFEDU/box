/** URL utilities for clips: extraction from shared text, canonicalisation, classification. */
export type ClipContentType =
  | 'link'
  | 'article'
  | 'youtube'
  | 'tiktok'
  | 'reddit'
  | 'music'
  | 'game'
  | 'ai_tool'
  | 'image'
  | 'pdf'
  | 'file';

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;

/** First http(s) URL in arbitrary shared text, with trailing punctuation removed. */
export function extractFirstUrl(text: string): string | null {
  const m = URL_RE.exec(text);
  if (!m) return null;
  let url = m[0].replace(/[.,;:!?…]+$/, '');
  // Balance a trailing ')' that belongs to surrounding prose.
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
  return url;
}

/** Text that came with a share besides the URL (e.g. "Check this out: <url>") — usable as a title hint. */
export function textWithoutUrl(text: string, url: string): string {
  return text.replace(url, '').replace(/\s+/g, ' ').trim().replace(/[:\-–—|]+$/, '').trim();
}

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|igshid|igsh|si|feature|ref_src|ref_url|_hsenc|_hsmi|yclid|spm|share_id|s|t)$/i;
// Params that are tracking on some hosts but meaningful on others.
const KEEP_ON_HOST: Record<string, RegExp> = {
  'youtube.com': /^(t)$/i, // timestamp
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\.|^m\.|^mobile\./, '');
  } catch {
    return null;
  }
}

/** Canonical form used for duplicate detection. Never used to replace what the user saved. */
export function canonicalizeUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\.|^mobile\./, '');
  // youtu.be/<id> and /shorts/<id> → watch?v=<id>
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    if (id) {
      const t = u.searchParams.get('t');
      return `https://youtube.com/watch?v=${id}${t ? `&t=${t}` : ''}`;
    }
  }
  if (host === 'youtube.com') {
    const shorts = /^\/shorts\/([\w-]+)/.exec(u.pathname);
    if (shorts) return `https://youtube.com/watch?v=${shorts[1]}`;
  }
  const keep = KEEP_ON_HOST[host];
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k) || (keep?.test(k) ?? false))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
  let path = u.pathname.replace(/\/+$/, '');
  if (!path) path = '';
  const port = u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) ? `:${u.port}` : '';
  return `https://${host}${port}${path}${query}`;
}

const MUSIC = /(^|\.)(spotify\.com|music\.apple\.com|music\.yandex\.(ru|com)|soundcloud\.com|deezer\.com|tidal\.com|bandcamp\.com|music\.youtube\.com)$/;
const GAMES = /(^|\.)(store\.steampowered\.com|steamcommunity\.com|itch\.io|epicgames\.com|gog\.com|store\.playstation\.com|xbox\.com|nintendo\.com)$/;
const AI = /(^|\.)(chatgpt\.com|openai\.com|claude\.ai|anthropic\.com|gemini\.google\.com|perplexity\.ai|huggingface\.co|midjourney\.com|poe\.com|mistral\.ai|replicate\.com|civitai\.com|deepseek\.com)$/;
const ARTICLE = /(^|\.)(medium\.com|substack\.com|habr\.com|dev\.to|wikipedia\.org|nytimes\.com|theverge\.com|arstechnica\.com|vc\.ru|hashnode\.dev)$/;

export function classifyUrl(url: string): ClipContentType {
  const host = hostOf(url);
  if (!host) return 'link';
  let path = '';
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* ignore */
  }
  if (host === 'youtube.com' && path.startsWith('/watch') === false && host.startsWith('music.')) return 'music';
  if (host === 'music.youtube.com') return 'music';
  if (host === 'youtube.com' || host === 'youtu.be') return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'reddit.com' || host === 'redd.it' || host.endsWith('.reddit.com')) return 'reddit';
  if (MUSIC.test(host)) return 'music';
  if (GAMES.test(host)) return 'game';
  if (AI.test(host)) return 'ai_tool';
  if (/\.(png|jpe?g|gif|webp|avif)$/.test(path)) return 'image';
  if (/\.pdf$/.test(path)) return 'pdf';
  if (ARTICLE.test(host) || /\/(blog|article|articles|news|posts?)\//.test(path)) return 'article';
  return 'link';
}

export function contentTypeFromMime(mime: string | null | undefined, name?: string | null): ClipContentType {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf' || /\.pdf$/i.test(name ?? '')) return 'pdf';
  return 'file';
}

/** og:type / page hints can upgrade a generic link. */
export function refineType(current: ClipContentType, ogType: string | null): ClipContentType {
  if (current !== 'link') return current;
  if (ogType && /^(article|blog|news)/i.test(ogType)) return 'article';
  if (ogType && /^music/i.test(ogType)) return 'music';
  return current;
}
