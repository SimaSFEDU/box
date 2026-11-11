import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs` (keeps "today"/"overdue" labels correct while a screen stays open). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
