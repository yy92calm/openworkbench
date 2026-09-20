// @vitest-environment node

import { Cron } from 'croner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storeData } = vi.hoisted(() => ({ storeData: new Map<string, unknown>() }));

vi.mock('./store', () => ({
  getStore: () => ({
    get: (key: string) => storeData.get(key),
    set: (key: string, value: unknown) => storeData.set(key, value),
  }),
}));

vi.mock('./logging', () => ({
  getLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

import { CronEngine, DEFAULT_MACRO_TASKS, defaultMacroTask, ensureMacroTasks } from './scheduler';

beforeEach(() => {
  storeData.clear();
});

describe('DEFAULT_MACRO_TASKS', () => {
  it('covers the three themes with parseable cron expressions', () => {
    expect(DEFAULT_MACRO_TASKS.map((t) => t.macroTheme)).toEqual([
      'rotation-daily',
      'rotation-weekly',
      'review-weekly',
    ]);
    for (const task of DEFAULT_MACRO_TASKS) {
      expect(new Cron(task.cron).nextRun()).toBeInstanceOf(Date);
      expect(task.prompt.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('ensureTask', () => {
  it('creates once per macro theme and returns the existing task after that', () => {
    const engine = new CronEngine();
    const first = engine.ensureTask(defaultMacroTask('rotation-daily'));
    const again = engine.ensureTask(defaultMacroTask('rotation-daily'));
    expect(again.id).toBe(first.id);
    expect(engine.listTasks()).toHaveLength(1);
  });

  it('keeps user edits to an existing theme task', () => {
    const engine = new CronEngine();
    const task = engine.ensureTask(defaultMacroTask('rotation-daily'));
    engine.updateTask(task.id, { cron: '0 7 * * 1-5' });
    engine.ensureTask(defaultMacroTask('rotation-daily'));
    expect(engine.listTasks()[0].cron).toBe('0 7 * * 1-5');
  });
});

describe('ensureMacroTasks', () => {
  it('provisions the defaults once per install', () => {
    ensureMacroTasks();
    expect(storeData.get('tasks')).toHaveLength(3);
    ensureMacroTasks();
    expect(storeData.get('tasks')).toHaveLength(3);
    expect(storeData.get('macroProvisioned')).toBe(true);
  });

  it('never resurrects a task the user deleted', () => {
    ensureMacroTasks();
    const engine = new CronEngine();
    const daily = engine.listTasks().find((t) => t.macroTheme === 'rotation-daily') as {
      id: string;
    };
    engine.removeTask(daily.id);
    ensureMacroTasks();
    expect(new CronEngine().listTasks()).toHaveLength(2);
  });
});

describe('fireNow daily limit', () => {
  it('skips the second run within the same day (maxRunsPerDay)', async () => {
    const engine = new CronEngine();
    const task = engine.ensureTask(defaultMacroTask('rotation-daily'));
    let fired = 0;
    engine.setFireCallback(async () => {
      fired++;
      return 'ses_test';
    });
    const first = await engine.fireNow(task.id);
    const second = await engine.fireNow(task.id);
    expect(first?.status).toBe('completed');
    expect(second?.status).toBe('skipped');
    expect(fired).toBe(1);
  });
});
