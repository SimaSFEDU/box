import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { toAppError } from '../../core/errors';
import type { MediaItem } from '../../domain/media/meta';
import { listCollections, listMedia, mediaModule, type PrivateCollection } from '../../secure/mediaService';

/** Decrypted media metadata for the current screen only (dropped on unmount / lock). */
export function useMediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [collections, setCollections] = useState<PrivateCollection[]>([]);
  const [corrupted, setCorrupted] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      mediaModule.touch();
      Promise.all([listMedia(), listCollections()]).then(
        ([m, c]) => {
          if (!alive) return;
          setItems(m.items);
          setCorrupted(m.corrupted);
          setCollections(c);
          setError(null);
        },
        (e) => alive && setError(toAppError(e).userMessage),
      );
      return () => {
        alive = false;
      };
      // `nonce` is the explicit reload trigger.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nonce]),
  );

  return { items, collections, corrupted, error, reload: () => setNonce((n) => n + 1) };
}
