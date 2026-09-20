// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { countTodayRuns, localDayKey, shouldSkipDueToDailyLimit } from './schedulerGuards';

const NOW = new Date('2026-09-01T10:00:00');

describe('localDayKey', () => {
  it('formats a local YYYY-MM-DD key with zero padding', () => {
    expect(localDayKey(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05');
    expect(localDayKey(new Date('2026-09-01T23:59:59'))).toBe('2026-09-01');
  });
});

describe('countTodayRuns', () => {
  const records = [
    { taskId: 'a', triggeredAt: '2026-09-01T08:00:00', status: 'completed' },
    { taskId: 'a', triggeredAt: '2026-09-01T09:00:00', status: 'running' },
    { taskId: 'a', triggeredAt: '2026-08-31T08:00:00', status: 'completed' }, // yesterday
    { taskId: 'a', triggeredAt: '2026-09-01T10:00:00', status: 'skipped' }, // skipped: not counted
    { taskId: 'b', triggeredAt: '2026-09-01T08:00:00', status: 'completed' }, // other task
  ];

  it('counts today executed runs per task, excluding skipped and other days', () => {
    expect(countTodayRuns(records, 'a', NOW)).toBe(2);
  });

  it('is task-scoped', () => {
    expect(countTodayRuns(records, 'b', NOW)).toBe(1);
  });

  it('counts failed runs toward the budget', () => {
    const recs = [{ taskId: 'a', triggeredAt: '2026-09-01T08:00:00', status: 'failed' }];
    expect(countTodayRuns(recs, 'a', NOW)).toBe(1);
  });
});

describe('shouldSkipDueToDailyLimit', () => {
  it('skips when today already hit the limit', () => {
    const records = [
      { taskId: 'a', triggeredAt: '2026-09-01T08:00:00', status: 'completed' },
      { taskId: 'a', triggeredAt: '2026-09-01T09:00:00', status: 'completed' },
    ];
    expect(shouldSkipDueToDailyLimit({ taskId: 'a', maxRunsPerDay: 2 }, records, NOW)).toBe(true);
  });

  it('allows when under the limit', () => {
    const records = [{ taskId: 'a', triggeredAt: '2026-09-01T08:00:00', status: 'completed' }];
    expect(shouldSkipDueToDailyLimit({ taskId: 'a', maxRunsPerDay: 3 }, records, NOW)).toBe(false);
  });

  it('never skips when maxRunsPerDay is unset or zero', () => {
    expect(shouldSkipDueToDailyLimit({ taskId: 'a' }, [], NOW)).toBe(false);
    expect(shouldSkipDueToDailyLimit({ taskId: 'a', maxRunsPerDay: 0 }, [], NOW)).toBe(false);
  });

  it('resets at midnight (previous day does not consume today budget)', () => {
    const records = [{ taskId: 'a', triggeredAt: '2026-08-31T23:59:00', status: 'completed' }];
    expect(shouldSkipDueToDailyLimit({ taskId: 'a', maxRunsPerDay: 1 }, records, NOW)).toBe(false);
  });
});
