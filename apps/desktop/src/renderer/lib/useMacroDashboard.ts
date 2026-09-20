// Dashboard snapshot hook: renders the current cache immediately and swaps in
// pushed updates. It never blocks on the network — the main process refreshes
// in the background and pushes `macro-dashboard-updated` when data arrives.

import type { MacroDashboardSnapshot } from '@workbench/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { macroDashboard, onMacroDashboard } from './electron';

export function useMacroDashboard(): {
  snapshot: MacroDashboardSnapshot | null;
  loading: boolean;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState<MacroDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const seqRef = useRef(-1);

  useEffect(() => {
    const apply = (s: MacroDashboardSnapshot | null) => {
      if (!s || typeof s.seq !== 'number') return;
      // Pushes may arrive out of order; keep the newest snapshot only.
      if (s.seq <= seqRef.current) return;
      seqRef.current = s.seq;
      setSnapshot(s);
      setLoading(false);
    };
    const off = onMacroDashboard(apply);
    // Initial read returns the cache in microseconds; a stale cache triggers a
    // background refresh whose result arrives as a push.
    void macroDashboard(false).then((s) => {
      apply(s);
      setLoading(false);
    });
    return off;
  }, []);

  const refresh = useCallback(() => {
    void macroDashboard(true);
  }, []);

  return { snapshot, loading, refresh };
}
