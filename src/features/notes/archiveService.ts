import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { unzipSync, zipSync } from 'fflate';

import { AppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { ulid } from '../../core/ulid';
import { safeExtension } from '../../data/files/attachments';
import { fileFor, writeFileAtomic } from '../../data/files/storage';
import {
  buildExport,
  ImportError,
  planImport,
  resolvePlaceholders,
  type ImportEntry,
  type ImportPlan,
} from '../../domain/notes/archive';
import { notesRepo } from './notesService';

const log = createLogger('archive');
export const MAX_ZIP_BYTES = 300 * 1024 * 1024;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const stamp = (d = new Date()) => d.toISOString().slice(0, 10);

/** Builds a ZIP with all notes + attachments + manifest and opens the share sheet (Save to Files, Drive…). */
export async function exportNotesArchive(): Promise<{ notes: number }> {
  const repo = notesRepo();
  const notes = await repo.listForExport();
  const attachments = new Map<string, Uint8Array>();
  for (const n of notes) {
    for (const a of await repo.listAttachments(n.id)) {
      const f = fileFor(a.relPath);
      if (f.exists) attachments.set(a.relPath, await f.bytes());
      else log.warn('missing attachment', a.relPath);
    }
  }
  const files = await buildExport(notes, attachments, sha256Hex, Date.now());
  const zip = zipSync(Object.fromEntries(files), { level: 6 });
  const out = new File(Paths.cache, `clipbox-notes-${stamp()}.zip`);
  try {
    if (out.exists) out.delete();
    out.create();
    await out.write(zip);
    await Sharing.shareAsync(out.uri, { mimeType: 'application/zip', dialogTitle: 'Экспорт заметок' });
  } finally {
    if (out.exists) out.delete();
  }
  return { notes: notes.length };
}

function entriesFromZip(bytes: Uint8Array): ImportEntry[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    throw new AppError('VALIDATION', 'Не удалось прочитать ZIP-архив', e);
  }
  return Object.entries(files)
    .filter(([p]) => !p.endsWith('/'))
    .map(([path, data]) => ({ path, size: data.length, read: async () => data }));
}

function entriesFromDirectory(root: Directory): ImportEntry[] {
  const out: ImportEntry[] = [];
  const walk = (dir: Directory, prefix: string, depth: number) => {
    if (depth > 20) return;
    for (const e of dir.list()) {
      const path = prefix + e.name;
      if (e instanceof Directory) {
        if (!e.name.startsWith('.')) walk(e, path + '/', depth + 1);
      } else {
        const f = e;
        out.push({ path, size: f.size ?? 0, read: () => f.bytes() });
      }
    }
  };
  walk(root, '', 0);
  return out;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  warnings: string[];
}

async function executePlan(plan: ImportPlan, entries: ImportEntry[]): Promise<ImportResult> {
  const repo = notesRepo();
  const byPath = new Map(entries.map((e) => [e.path, e]));
  let imported = 0;
  let skipped = 0;
  for (const n of plan.notes) {
    const duplicate = n.originalId ? await repo.exists(n.originalId) : await repo.existsBySourcePath(n.sourcePath);
    if (duplicate) {
      skipped++;
      continue;
    }
    const id = await repo.create({
      id: n.originalId ?? undefined,
      title: n.title,
      body: '',
      sourcePath: n.sourcePath,
      tags: n.tags,
      favorite: n.favorite,
      archived: n.archived,
      createdAt: n.createdAt ?? undefined,
      updatedAt: n.updatedAt ?? undefined,
    });
    try {
      const map = new Map<string, string>();
      for (const p of n.attachments) {
        const entry = byPath.get(p);
        if (!entry) continue;
        const bytes = await entry.read();
        const name = p.slice(p.lastIndexOf('/') + 1);
        const rel = `attachments/${ulid()}.${safeExtension(name, 'application/octet-stream')}`;
        await writeFileAtomic(rel, bytes);
        await repo.addAttachment({ itemId: id, relPath: rel, originalName: name, mime: 'application/octet-stream', size: bytes.length, sha256: await sha256Hex(bytes) });
        map.set(p, rel);
      }
      await repo.save(id, { body: resolvePlaceholders(n.body, map) });
      if (n.updatedAt) await repo.touch(id, n.updatedAt);
      imported++;
    } catch (e) {
      await repo.purge(id); // no half-imported notes
      throw e;
    }
  }
  return { imported, skipped, warnings: plan.warnings };
}

async function run(entries: ImportEntry[]): Promise<ImportResult> {
  try {
    const plan = await planImport(entries, sha256Hex);
    return await executePlan(plan, entries);
  } catch (e) {
    if (e instanceof ImportError) throw new AppError('VALIDATION', e.message, e);
    throw e;
  }
}

/** Imports one or more `.md` files or a `.zip` (Clipbox archive or zipped vault). Null if cancelled. */
export async function importFromFiles(): Promise<ImportResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['text/markdown', 'text/plain', 'text/x-markdown', 'application/zip', 'application/octet-stream'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (res.canceled) return null;
  const entries: ImportEntry[] = [];
  const temps: File[] = [];
  try {
    for (const a of res.assets) {
      const f = new File(a.uri);
      temps.push(f);
      const size = f.size ?? a.size ?? 0;
      if (/\.zip$/i.test(a.name)) {
        if (size > MAX_ZIP_BYTES) throw new AppError('VALIDATION', 'Архив слишком большой (максимум 300 МБ)');
        entries.push(...entriesFromZip(await f.bytes()));
      } else if (/\.(md|markdown|txt)$/i.test(a.name)) {
        const bytes = await f.bytes();
        entries.push({ path: a.name.replace(/\.(markdown|txt)$/i, '.md'), size: bytes.length, read: async () => bytes });
      }
    }
    return await run(entries);
  } finally {
    for (const t of temps) if (t.exists) t.delete();
  }
}

/** Imports an Obsidian vault (or any folder of Markdown files) chosen via the system folder picker. */
export async function importFromFolder(): Promise<ImportResult | null> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return null; // cancelled
  }
  return run(entriesFromDirectory(dir));
}
