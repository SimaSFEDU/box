import { getRandomBytes } from 'expo-crypto';
import { AppState } from 'react-native';

import { createLogger } from '../../core/logger';
import { setRandomSource } from '../../core/ulid';
import { initDatabase } from '../../data/db/database';
import { ensureStorage, runFileGc } from '../../data/files/storage';
import { useSettingsStore } from '../../stores/settingsStore';

import { processMetadataQueue } from '../clips/clipsService';
import { purgeExpiredTrash } from '../notes/notesService';

const log = createLogger('bootstrap');
let appStateSub: { remove(): void } | null = null;

/** App startup sequence (docs/ARCHITECTURE.md §6.1). Throws AppError on fatal failure. */
export async function bootstrap(): Promise<void> {
  setRandomSource((n) => getRandomBytes(n));
  const db = await initDatabase();
  ensureStorage();
  await useSettingsStore.getState().load();
  // Non-critical housekeeping must never block startup.
  purgeExpiredTrash()
    .then(() => runFileGc(db))
    .catch((e) => log.warn('housekeeping failed', e));
  // Pending clip metadata: retry now and whenever the app comes back to foreground.
  void processMetadataQueue();
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void processMetadataQueue();
    });
  }
}
