import { deriveTitle } from '../markdown/frontmatter';

/** Characters forbidden in file names on Android/Windows/macOS, plus control chars. */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F]/g;

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100);
  return cleaned || 'Без названия';
}

/** Unique `<title>.md` within `used` (case-insensitive). Mutates `used`. */
export function noteFileName(title: string, body: string, used: Set<string>, dir = ''): string {
  const base = sanitizeFileName(title.trim() || deriveTitle(body));
  let name = `${base}.md`;
  for (let i = 2; used.has((dir + name).toLowerCase()); i++) name = `${base} ${i}.md`;
  used.add((dir + name).toLowerCase());
  return name;
}

/** Normalises an imported relative path: forward slashes, no '..', no leading slash, safe segments. */
export function normalizeRelPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .map(sanitizeFileName)
    .join('/');
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Relative path from a note located at `fromFile` to `toPath` (both relative to export root). */
export function relativeFrom(fromFile: string, toPath: string): string {
  const depth = dirname(fromFile).split('/').filter(Boolean).length;
  return '../'.repeat(depth) + toPath;
}
