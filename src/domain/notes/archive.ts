/**
 * Pure export/import planning for notes. No I/O here: the app layer supplies file bytes and
 * a SHA-256 function, so everything is unit-testable in Node.
 *
 * Export layout (ZIP):
 *   clipbox.json            manifest: format version, notes metadata, file list with sha256
 *   Notes/<dir>/<Title>.md  original Markdown (imported notes keep their vault folder)
 *   attachments/<file>      attachments; links inside notes are rewritten to relative paths
 */
import { deriveTitle, splitFrontmatter } from '../markdown/frontmatter';
import { dirname, normalizeRelPath, noteFileName, relativeFrom, sanitizeFileName } from './exportPaths';

export const ARCHIVE_FORMAT = 'clipbox-notes';
export const ARCHIVE_VERSION = 1;
export const NOTES_DIR = 'Notes';

export type Sha256 = (bytes: Uint8Array) => Promise<string>;

export interface ExportNote {
  id: string;
  title: string;
  format: 'text' | 'markdown' | 'checklist';
  body: string;
  sourcePath: string | null;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ManifestNote extends Omit<ExportNote, 'body' | 'sourcePath'> {
  path: string;
}

export interface Manifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  exportedAt: number;
  notes: ManifestNote[];
  files: Record<string, { size: number; sha256: string }>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const ATT_LINK = /\]\((attachments\/[\w.-]+)\)/g;

export async function buildExport(
  notes: ExportNote[],
  attachments: Map<string, Uint8Array>,
  sha256: Sha256,
  now: number,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const used = new Set<string>();
  const manifestNotes: ManifestNote[] = [];
  for (const n of notes) {
    const dir = n.sourcePath ? dirname(normalizeRelPath(n.sourcePath)) : '';
    const prefix = [NOTES_DIR, dir].filter(Boolean).join('/') + '/';
    const path = prefix + noteFileName(n.title, n.body, used, prefix);
    const body = n.body.replace(ATT_LINK, (_m, p: string) => `](${relativeFrom(path, p)})`);
    files.set(path, enc.encode(body));
    const { body: _b, sourcePath: _s, ...meta } = n;
    manifestNotes.push({ ...meta, path });
  }
  for (const [rel, bytes] of attachments) files.set(rel, bytes);
  const fileMeta: Manifest['files'] = {};
  for (const [p, bytes] of files) fileMeta[p] = { size: bytes.length, sha256: await sha256(bytes) };
  const manifest: Manifest = { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, exportedAt: now, notes: manifestNotes, files: fileMeta };
  files.set('clipbox.json', enc.encode(JSON.stringify(manifest, null, 2)));
  return files;
}

// ---------------------------------------------------------------- import

export interface ImportEntry {
  /** Path relative to the archive/vault root, '/'-separated. */
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export interface PlannedNote {
  /** Present when restoring a Clipbox archive (used to skip duplicates). */
  originalId: string | null;
  title: string;
  body: string;
  sourcePath: string;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  /** Archive paths referenced as attachments; body contains `clipbox-att://<path>` placeholders. */
  attachments: string[];
}

export interface ImportPlan {
  kind: 'clipbox' | 'markdown';
  notes: PlannedNote[];
  warnings: string[];
}

export const PLACEHOLDER = 'clipbox-att://';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const SKIP_DIRS = /(^|\/)(\.obsidian|\.trash|\.git|node_modules|__MACOSX)(\/|$)/;
export const MAX_NOTE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Tags from frontmatter: `tags: [a, b]`, `tags: a, b` or a YAML list. */
export function frontmatterTags(fm: string | null): string[] {
  if (!fm) return [];
  const inline = /^tags:[ \t]*\[?([^\]\n]*)\]?[ \t]*$/m.exec(fm);
  if (inline && inline[1]!.trim()) return inline[1]!.split(',').map((t) => t.trim().replace(/^['"#]+|['"]+$/g, '')).filter(Boolean);
  const block = /^tags:\s*\n((?:\s*-\s*.+\n?)+)/m.exec(fm);
  if (block) return block[1]!.split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^['"#]+|['"]+$/g, '')).filter(Boolean);
  return [];
}

function resolveRelative(fromNote: string, target: string): string {
  const parts = dirname(fromNote).split('/').filter(Boolean);
  for (const seg of decodeURI(target).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export async function planImport(entries: ImportEntry[], sha256: Sha256): Promise<ImportPlan> {
  const warnings: string[] = [];
  const byPath = new Map(entries.filter((e) => !SKIP_DIRS.test(e.path)).map((e) => [e.path, e]));
  const byBase = new Map<string, string>();
  for (const p of byPath.keys()) {
    const base = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    if (!byBase.has(base)) byBase.set(base, p);
  }

  // Clipbox archive: verify integrity before anything else.
  let manifest: Manifest | null = null;
  const mEntry = byPath.get('clipbox.json');
  if (mEntry) {
    try {
      const m = JSON.parse(dec.decode(await mEntry.read())) as Manifest;
      if (m.format === ARCHIVE_FORMAT) manifest = m;
    } catch {
      throw new ImportError('Файл clipbox.json повреждён');
    }
  }
  if (manifest) {
    if (manifest.version > ARCHIVE_VERSION) throw new ImportError('Архив создан более новой версией Clipbox');
    for (const [p, meta] of Object.entries(manifest.files)) {
      const e = byPath.get(p);
      if (!e) throw new ImportError(`В архиве отсутствует файл: ${p}`);
      const bytes = await e.read();
      if (bytes.length !== meta.size || (await sha256(bytes)) !== meta.sha256) {
        throw new ImportError(`Контрольная сумма не совпадает: ${p}`);
      }
    }
  }
  const metaByPath = new Map((manifest?.notes ?? []).map((n) => [n.path, n]));

  const notes: PlannedNote[] = [];
  for (const [path, entry] of byPath) {
    if (!/\.md$/i.test(path)) continue;
    if (entry.size > MAX_NOTE_BYTES) {
      warnings.push(`Пропущен слишком большой файл: ${path}`);
      continue;
    }
    let body = dec.decode(await entry.read()).replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const atts = new Set<string>();
    const attach = (target: string): string | null => {
      const e = byPath.get(target);
      if (!e) return null;
      if (e.size > MAX_ATTACHMENT_BYTES) {
        warnings.push(`Вложение слишком большое: ${target}`);
        return null;
      }
      atts.add(target);
      return PLACEHOLDER + target;
    };
    // Standard Markdown images/links to local files.
    body = body.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (m, a: string, target: string, c: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return m;
      if (/\.md$/i.test(target)) return m;
      const ph = attach(resolveRelative(path, target));
      return ph ? a + ph + c : m;
    });
    // Obsidian image embeds ![[file.png|alt]] → standard Markdown image.
    body = body.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, target: string, alt?: string) => {
      if (!IMAGE_EXT.test(target)) return m;
      const found = byPath.has(resolveRelative(path, target)) ? resolveRelative(path, target) : byBase.get(target.split('/').pop()!.toLowerCase());
      const ph = found ? attach(found) : null;
      return ph ? `![${alt ?? ''}](${ph})` : m;
    });

    const meta = metaByPath.get(path);
    const { frontmatter } = splitFrontmatter(body);
    const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    const sourcePath = manifest ? path.replace(new RegExp(`^${NOTES_DIR}/`), '') : path;
    notes.push({
      originalId: meta?.id ?? null,
      title: meta?.title ?? (sanitizeFileName(stem) || deriveTitle(body)),
      body,
      sourcePath,
      tags: meta?.tags ?? frontmatterTags(frontmatter),
      favorite: meta?.favorite ?? false,
      archived: meta?.archived ?? false,
      createdAt: meta?.createdAt ?? null,
      updatedAt: meta?.updatedAt ?? null,
      attachments: [...atts],
    });
  }
  if (notes.length === 0) warnings.push('Не найдено ни одного .md файла');
  return { kind: manifest ? 'clipbox' : 'markdown', notes, warnings };
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Replaces placeholders with final attachment paths. */
export function resolvePlaceholders(body: string, map: Map<string, string>): string {
  return body.replace(/clipbox-att:\/\/([^)\s]+)/g, (m, p: string) => map.get(p) ?? m);
}
