/** Pure daily-run-limit guard for scheduled tasks.
 *  No Node/Electron imports — unit-testable in isolation. */

export interface DailyRunRecord {
  taskId: string;
  triggeredAt: string;
  status: string;
}

/** Local calendar day key (YYYY-MM-DD) for `d`. */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Number of runs a task actually executed today. Skipped runs do not consume
 *  the budget — they are the guard itself refusing to fire. */
export function countTodayRuns(
  records: readonly DailyRunRecord[],
  taskId: string,
  now: Date = new Date(),
): number {
  const today = localDayKey(now);
  return records.filter(
    (r) =>
      r.taskId === taskId &&
      r.status !== 'skipped' &&
      localDayKey(new Date(r.triggeredAt)) === today,
  ).length;
}

/** True when the task's `maxRunsPerDay` is set and today's run count already
 *  meets or exceeds it — the run must be skipped, not executed. */
export function shouldSkipDueToDailyLimit(
  task: { taskId: string; maxRunsPerDay?: number },
  records: readonly DailyRunRecord[],
  now: Date = new Date(),
): boolean {
  if (!task.maxRunsPerDay || task.maxRunsPerDay <= 0) return false;
  return countTodayRuns(records, task.taskId, now) >= task.maxRunsPerDay;
}
