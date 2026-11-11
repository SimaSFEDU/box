import { router } from 'expo-router';

import type { LibraryItemSummary } from '../../data/repositories/libraryRepo';

export function openItem(item: Pick<LibraryItemSummary, 'id' | 'kind'>) {
  if (item.kind === 'note') router.push({ pathname: '/note/[id]', params: { id: item.id } });
  else router.push({ pathname: '/clip/[id]', params: { id: item.id } });
}
