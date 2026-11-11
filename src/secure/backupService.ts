/**
 * Encrypted backup of protected modules (`.cbvault`, SECURITY_DESIGN §9). The backup password is
 * separate from master passwords; plaintext exists only inside native code and the encrypted stream.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

import { AppError } from '../core/errors';
import { getDb } from '../data/db/database';
import { createMediaRepo } from '../data/repositories/mediaRepo';
import { createVaultRepo } from '../data/repositories/vaultRepo';
import { collectionAd, metaAd, parseMeta, serializeMeta, sizeBucket, type MediaMeta } from '../domain/media/meta';
import { recordAd } from '../domain/vault/entries';
import { masterPasswordProblem } from '../domain/vault/strength';
import { mediaModule } from './mediaService';
import { call, native } from './protectedModule';
import { restoreEntryJson, vaultModule } from './vaultService';

export interface BackupScope {
  vault: 'included' | 'locked' | 'not_setup';
  media: 'included' | 'locked' | 'not_setup';
}

export async function backupScope(): Promise<BackupScope> {
  const [v, m] = await Promise.all([vaultModule.refresh(), mediaModule.refresh()]);
  const s = (x: string) => (x === 'unlocked' ? 'included' : x === 'locked' ? 'locked' : 'not_setup');
  return { vault: s(v), media: s(m) };
}

/** Creates the backup and opens the share sheet so the user can save it (Files, Drive, USB…). */
export async function exportPrivateBackup(password: string): Promise<BackupScope> {
  const problem = masterPasswordProblem(password);
  if (problem) throw new AppError('VALIDATION', `Пароль резервной копии: ${problem.toLowerCase()}`);
  const scope = await backupScope();
  if (scope.vault !== 'included' && scope.media !== 'included') throw new AppError('AUTH_REQUIRED', 'Откройте Vault и/или Private Media, чтобы включить их в копию');
  const db = getDb();
  const vault = scope.vault === 'included' ? (await createVaultRepo(db).listEntries()).map((r) => [r.id, r.payload, recordAd(r.id, r.schemaVer)] as [string, string, string]) : [];
  const mrepo = createMediaRepo(db);
  const media = scope.media === 'included' ? (await mrepo.list()).map((r) => [r.id, r.blobName, r.meta, metaAd(r.id)] as [string, string, string, string]) : [];
  const cols = scope.media === 'included' ? (await mrepo.listCollections()).map((c) => [c.id, c.payload, collectionAd(c.id)] as [string, string, string]) : [];
  const uri = await call(() => native().backupExport(password, vault, cols, media));
  await Sharing.shareAsync(uri, { mimeType: 'application/octet-stream', dialogTitle: 'Сохранить зашифрованную копию' });
  return scope;
}

export interface RestoreResult {
  vault: number;
  media: number;
  collections: number;
}

/** Picks a `.cbvault`, verifies it fully, then merges its content (existing ids are kept, not overwritten). */
export async function restorePrivateBackup(password: string): Promise<RestoreResult | null> {
  const pick = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: false });
  if (pick.canceled || !pick.assets[0]) return null;
  const db = getDb();
  const mrepo = createMediaRepo(db);
  const existing = [...(await createVaultRepo(db).listEntries()).map((r) => r.id), ...(await mrepo.ids())];
  const r = await call(() => native().backupRestore(pick.assets[0]!.uri, password, existing));

  for (const v of r.vault) await restoreEntryJson(v.json);
  for (const c of r.collections) {
    await mrepo.putCollection(c.id, await call(() => native().seal('media', c.json, collectionAd(c.id))));
  }
  const known = new Set((await mrepo.listCollections()).map((c) => c.id));
  for (const m of r.media) {
    const fromBackup = m.meta ? parseMeta(m.meta) : null;
    const meta: MediaMeta = {
      originalName: fromBackup?.originalName ?? 'restored',
      mime: m.mime,
      size: m.size,
      width: m.width,
      height: m.height,
      durationMs: m.durationMs,
      sha256: fromBackup?.sha256 ?? '',
      favorite: fromBackup?.favorite ?? false,
      note: fromBackup?.note ?? '',
      addedAt: fromBackup?.addedAt ?? Date.now(),
      collectionId: fromBackup?.collectionId && known.has(fromBackup.collectionId) ? fromBackup.collectionId : null,
    };
    await mrepo.insert({
      id: m.id,
      collectionId: meta.collectionId,
      blobName: m.blobName,
      thumbName: m.thumbName,
      meta: await call(() => native().seal('media', serializeMeta(meta), metaAd(m.id))),
      sizeBucket: sizeBucket(m.size),
      createdAt: meta.addedAt,
    });
  }
  return { vault: r.vault.length, media: r.media.length, collections: r.collections.length };
}
