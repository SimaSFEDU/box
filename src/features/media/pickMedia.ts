import * as DocumentPicker from 'expo-document-picker';

import type { ImportSource } from '../../secure/mediaService';

/**
 * System picker WITHOUT copying to cache (copyToCacheDirectory: false): we receive content:// URIs
 * and encrypt straight from the provider stream, so no plaintext copy is created by Clipbox.
 */
export async function pickMediaFiles(): Promise<ImportSource[]> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'video/*', '*/*'], multiple: true, copyToCacheDirectory: false });
  if (res.canceled) return [];
  return res.assets.map((a) => ({ uri: a.uri, name: a.name ?? null, mime: a.mimeType ?? null }));
}
