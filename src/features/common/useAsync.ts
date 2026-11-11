import { useCallback, useEffect, useRef, useState } from 'react';

import { toAppError, type AppError } from '../../core/errors';
import { useDataVersion } from '../../stores/dataVersion';

/**
 * Loads async data, re-running when `deps` or the global data version change.
 * Stale responses (from an older run) are dropped.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], errorMessage = 'Не удалось загрузить данные') {
  const version = useDataVersion((s) => s.version);
  const [state, setState] = useState<{ data: T | null; error: AppError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const id = ++seq.current;
    fn().then(
      (data) => id === seq.current && setState({ data, error: null, loading: false }),
      (e) => id === seq.current && setState((s) => ({ data: s.data, error: toAppError(e, 'DB_QUERY_FAILED', errorMessage), loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
