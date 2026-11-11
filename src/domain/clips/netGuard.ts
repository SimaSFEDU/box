/**
 * Outbound request policy for metadata fetching (SSRF guard).
 * Only public http(s) hosts; literal private/loopback/link-local addresses and local names are refused.
 * Limitation: DNS names resolving to private IPs cannot be detected from JS (no resolver API);
 * acceptable because the request originates from the user's own phone, not a server.
 */
function ipv4Private(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

function ipv6Private(h: string): boolean {
  const x = h.replace(/^\[|\]$/g, '').toLowerCase();
  if (!x.includes(':')) return false;
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('::ffff:');
}

export function isFetchAllowed(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return false;
  if (!h.includes('.') && !h.includes(':')) return false; // single-label intranet names
  if (ipv4Private(h) || ipv6Private(h)) return false;
  return true;
}
