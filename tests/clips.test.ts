import { decodeEntities, mergeMetadata, oembedEndpoint, parseHtmlMetadata, parseOembed } from '../src/domain/clips/metadata';
import { isFetchAllowed } from '../src/domain/clips/netGuard';
import { canonicalizeUrl, classifyUrl, contentTypeFromMime, extractFirstUrl, refineType, textWithoutUrl } from '../src/domain/clips/url';

describe('url extraction', () => {
  it('finds the URL in shared text', () => {
    expect(extractFirstUrl('Look at this https://example.com/a?b=1. Cool!')).toBe('https://example.com/a?b=1');
    expect(extractFirstUrl('(see https://en.wikipedia.org/wiki/Foo_(bar))')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(extractFirstUrl('no links here')).toBeNull();
    expect(textWithoutUrl('Great talk: https://youtu.be/x', 'https://youtu.be/x')).toBe('Great talk');
  });
});

describe('canonicalization', () => {
  it('strips tracking, normalizes host and YouTube forms', () => {
    expect(canonicalizeUrl('https://www.Example.com/path/?utm_source=x&b=2&a=1#frag')).toBe('https://example.com/path?a=1&b=2');
    expect(canonicalizeUrl('https://youtu.be/abc123?si=TRACK')).toBe('https://youtube.com/watch?v=abc123');
    expect(canonicalizeUrl('https://m.youtube.com/watch?v=abc123&feature=share')).toBe('https://youtube.com/watch?v=abc123');
    expect(canonicalizeUrl('https://youtube.com/shorts/xyz')).toBe('https://youtube.com/watch?v=xyz');
    expect(canonicalizeUrl('https://youtube.com/watch?v=a&t=30')).toBe('https://youtube.com/watch?t=30&v=a');
    expect(canonicalizeUrl('ftp://x.y')).toBeNull();
    expect(canonicalizeUrl('not a url')).toBeNull();
  });
});

describe('classification', () => {
  it.each([
    ['https://youtu.be/x', 'youtube'],
    ['https://www.youtube.com/watch?v=x', 'youtube'],
    ['https://music.youtube.com/watch?v=x', 'music'],
    ['https://vm.tiktok.com/abc', 'tiktok'],
    ['https://old.reddit.com/r/x', 'reddit'],
    ['https://open.spotify.com/track/1', 'music'],
    ['https://store.steampowered.com/app/1', 'game'],
    ['https://claude.ai/new', 'ai_tool'],
    ['https://huggingface.co/models', 'ai_tool'],
    ['https://example.com/pic.JPG', 'image'],
    ['https://example.com/doc.pdf', 'pdf'],
    ['https://habr.com/ru/articles/1', 'article'],
    ['https://example.com/blog/post', 'article'],
    ['https://example.com', 'link'],
  ])('%s → %s', (url, type) => {
    expect(classifyUrl(url)).toBe(type);
  });
  it('mime and og:type', () => {
    expect(contentTypeFromMime('image/webp')).toBe('image');
    expect(contentTypeFromMime('application/octet-stream', 'a.PDF')).toBe('pdf');
    expect(contentTypeFromMime(null)).toBe('file');
    expect(refineType('link', 'article')).toBe('article');
    expect(refineType('youtube', 'article')).toBe('youtube');
  });
});

describe('metadata parsing', () => {
  const html = `<!doctype html><html><head>
    <title>Fallback &amp; title</title>
    <meta property="og:title" content="OG &quot;Title&quot; &#x1F600;">
    <meta content='Desc <b>bold</b>' name='description'>
    <meta property="og:site_name" content="Site">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:type" content="article">
    <link rel="canonical" href="https://example.com/canonical">
    </head><body><meta property="og:title" content="IGNORED BODY"></body></html>`;
  it('prefers Open Graph, decodes entities, strips tags, absolutizes', () => {
    expect(parseHtmlMetadata(html, 'https://example.com/a/b')).toEqual({
      title: 'OG "Title" 😀',
      description: 'Desc bold',
      siteName: 'Site',
      imageUrl: 'https://example.com/img/cover.png',
      canonicalUrl: 'https://example.com/canonical',
      ogType: 'article',
    });
  });
  it('falls back to <title> and survives garbage', () => {
    expect(parseHtmlMetadata('<title> Only\n title </title>', 'https://x.y').title).toBe('Only title');
    expect(parseHtmlMetadata('<<<>>>', 'https://x.y')).toMatchObject({ title: null, imageUrl: null });
    expect(parseHtmlMetadata('<meta property="og:image" content="javascript:alert(1)">', 'https://x.y').imageUrl).toBeNull();
  });
  it('oEmbed', () => {
    expect(oembedEndpoint('https://youtu.be/x')).toContain('youtube.com/oembed');
    expect(oembedEndpoint('https://example.com')).toBeNull();
    const o = parseOembed({ title: 'Video', provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/a.jpg', author_name: 'Chan' }, 'https://youtube.com');
    expect(mergeMetadata(null, o)).toMatchObject({ title: 'Video', siteName: 'YouTube', imageUrl: 'https://i.ytimg.com/a.jpg' });
    expect(parseOembed('nope', 'https://x.y')).toEqual({});
  });
  it('decodes entities safely', () => {
    expect(decodeEntities('&#0; &#99999999; &bogus; &lt;')).toBe('&#0; &#99999999; &bogus; <');
  });
});

describe('SSRF guard', () => {
  it.each([
    ['https://example.com', true],
    ['http://93.184.216.34/x', true],
    ['http://localhost:8080', false],
    ['http://127.0.0.1', false],
    ['http://10.0.0.5', false],
    ['http://192.168.1.1', false],
    ['http://172.20.0.1', false],
    ['http://169.254.169.254/latest/meta-data', false],
    ['http://[::1]/', false],
    ['http://[fd00::1]/', false],
    ['http://router.local', false],
    ['http://intranet', false],
    ['https://user:pw@example.com', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
  ])('%s → %s', (url, ok) => {
    expect(isFetchAllowed(url)).toBe(ok);
  });
});
