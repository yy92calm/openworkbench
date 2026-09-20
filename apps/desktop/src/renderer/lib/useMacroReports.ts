// Background report list: reads the latest report per theme and refreshes
// whenever the main process saves a new one (tasks run without the UI).

import type { MacroReportMeta } from '@workbench/shared';
import { useCallback, useEffect, useState } from 'react';

import { macroReports, onMacroReports } from './electron';

export function useMacroReports(): {
  reports: MacroReportMeta[];
  reload: () => void;
} {
  const [reports, setReports] = useState<MacroReportMeta[]>([]);

  const reload = useCallback(() => {
    void macroReports().then(setReports);
  }, []);

  useEffect(() => {
    reload();
    return onMacroReports(reload);
  }, [reload]);

  return { reports, reload };
}
