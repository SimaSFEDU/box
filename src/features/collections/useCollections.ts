import { collectionsRepo } from '../clips/clipsService';
import { useAsync } from '../common/useAsync';

export function useCollections() {
  const { data, reload } = useAsync(() => collectionsRepo().list(), []);
  return { collections: data ?? [], reload };
}
