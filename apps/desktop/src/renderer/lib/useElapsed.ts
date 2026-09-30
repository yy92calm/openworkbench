import { useEffect, useState } from 'react';

/** How long something has been running, in seconds, ticking while it is.
 *
 *  One interval per mounted component is fine here — only running rows are on
 *  screen at a time, and each tick re-renders a single span. Returns null when
 *  there is no start time (e.g. a row restored from history, where the true
 *  start is unknown and pretending it just began would be a lie). */
export function useElapsed(startedAt: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === undefined) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (startedAt === undefined) return null;
  return Math.max(0, Math.round((now - startedAt) / 1000));
}

/** `8s`, `1m 05s` — the same shape the completed `meta` strings use. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
