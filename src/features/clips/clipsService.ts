import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import { createLogger } from '../../core/logger';
import { ulid } from '../../core/ulid';
import { getDb } from '../../data/db/database';
import { copyIntoAttachments } from '../../data/files/attachments';
import { writeFileAtomic } from '../../data/files/storage';
import { createClipsRepo } from '../../data/repositories/clipsRepo';
import { createCollectionsRepo } from '../../data/repositories/collectionsRepo';
import { createNotesRepo } from '../../data/repositories/notesRepo';
import { enrichUrl } from '../../domain/clips/enrich';
import type { FetchLike } from '../../domain/clips/fetchLimited';
import { canonicalizeUrl, classifyUrl, contentTypeFromMime, extractFirstUrl, refineType, textWithoutUrl } from '../../domain/clips/url';
import { useDataVersion } from '../../stores/dataVersion';

const log = createLogger('clips');

export const clipsRepo = () => createClipsRepo(getDb());
export const collectionsRepo = () => createCollectionsRepo(getDb());

export interface SaveOptions {
  note?: string;
  collectionIds?: string[];
  tags?: string[];
}

export type SaveOutcome = { kind: 'clip' | 'note'; id: string };

export interface LinkDraft {
  url: string;
  canonical: string | null;
  titleHint: string;
  duplicate: { id: string; title: string } | null;
}

/** Analyses shared text: a URL becomes a link draft, plain text becomes a note. */
export async function analyzeText(text: string): Promise<LinkDraft | null> {
  const url = extractFirstUrl(text);
  if (!url) return null;
  const canonical = canonicalizeUrl(url);
  return {
    url,
    canonical,
    titleHint: textWithoutUrl(text, url).slice(0, 200),
    duplicate: canonical ? await clipsRepo().findByCanonical(canonical) : null,
  };
}

export async function saveLink(draft: LinkDraft, opts: SaveOptions & { title?: string; inbox?: boolean }): Promise<SaveOutcome> {
  const id = await clipsRepo().createLink({
    url: draft.url,
    canonicalUrl: draft.canonical,
    contentType: classifyUrl(draft.url),
    title: (opts.title ?? draft.titleHint).trim(),
    note: opts.note?.trim() || null,
    inbox: opts.inbox ?? true,
    tags: opts.tags,
    collectionIds: opts.collectionIds,
  });
  void processMetadataQueue();
  return { kind: 'clip', id };
}

/** Shared plain text (no URL) is kept as a note in Inbox. */
export async function saveTextAsNote(text: string, opts: SaveOptions): Promise<SaveOutcome> {
  const repo = createNotesRepo(getDb());
  const body = opts.note?.trim() ? `${text}\n\n---\n${opts.note.trim()}` : text;
  const id = await repo.create({ format: 'text', body, tags: opts.tags });
  await repo.setFlag(id, 'inbox', true);
  if (opts.collectionIds?.length) await collectionsRepo().setItemCollections(id, opts.collectionIds);
  return { kind: 'note', id };
}

/** Copies a shared/picked file into private app storage and creates a file clip. */
export async function saveFile(uri: string, name: string | null, mime: string, opts: SaveOptions): Promise<SaveOutcome> {
  const stored = await copyIntoAttachments(new File(uri), name, mime);
  const id = await clipsRepo().createFile({
    title: name?.replace(/\.[^.]+$/, '') || 'Файл',
    contentType: contentTypeFromMime(mime, name),
    attachment: { ...stored, originalName: name, mime },
    note: opts.note?.trim() || null,
    tags: opts.tags,
    collectionIds: opts.collectionIds,
  });
  return { kind: 'clip', id };
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };
const fetchImpl = expoFetch as unknown as FetchLike;
let running: Promise<void> | null = null;

/**
 * Fetches metadata for pending clips, one at a time. Single-flight; safe to call often
 * (after saves, on startup, when the app returns to foreground). Failures never affect the saved clip.
 */
export function processMetadataQueue(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const repo = clipsRepo();
    for (let guard = 0; guard < 50; guard++) {
      const [next] = await repo.listPendingMeta(1);
      if (!next) break;
      try {
        const { meta, image } = await enrichUrl(fetchImpl, next.url);
        let previewPath: string | null = null;
        if (image) {
          previewPath = `previews/${ulid()}.${IMAGE_EXT[image.contentType] ?? 'img'}`;
          await writeFileAtomic(previewPath, image.bytes);
        }
        await repo.applyMeta(next.id, {
          title: meta.title,
          description: meta.description,
          siteName: meta.siteName,
          previewPath,
          contentType: refineType(classifyUrl(next.url), meta.ogType),
        });
      } catch (e) {
        log.info('metadata failed', e);
        await repo.markMetaAttemptFailed(next.id);
      }
      useDataVersion.getState().bump();
    }
  })()
    .catch((e) => log.warn('metadata queue error', e))
    .finally(() => {
      running = null;
    });
  return running;
}
