import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RotationRow } from '@workbench/shared';
import { describe, expect, it } from 'vitest';

import {
  parseRotationHistory,
  previousScores,
  recordScores,
  type RotationHistory,
  RotationHistoryStore,
  scoresOf,
} from './rotationHistory';

function row(secid: string, score: number | null): RotationRow {
  return {
    secid,
    name: secid,
    ret60: 0.01,
    rs60: 0.01,
    trend: true,
    vol60: 0.2,
    score,
    signal: score === null ? null : 'neutral',
    scoreDelta: null,
  };
}

describe('parseRotationHistory', () => {
  it('returns an empty history for null / malformed input', () => {
    expect(parseRotationHistory(null)).toEqual({ days: {} });
    expect(parseRotationHistory('not json')).toEqual({ days: {} });
    expect(parseRotationHistory('{"days": 3}')).toEqual({ days: {} });
  });

  it('drops invalid dates and non-numeric scores', () => {
    const raw = JSON.stringify({
      days: {
        '2026-09-18': { '1.000928': 80, '1.000929': 'x', '1.000930': null },
        'not-a-date': { '1.000928': 1 },
        '2026-09-19': { '1.000928': 72.5 },
      },
    });
    expect(parseRotationHistory(raw)).toEqual({
      days: { '2026-09-18': { '1.000928': 80 }, '2026-09-19': { '1.000928': 72.5 } },
    });
  });
});

describe('scoresOf', () => {
  it('skips unscored rows', () => {
    expect(scoresOf([row('a', 80), row('b', null), row('c', 0)])).toEqual({ a: 80, c: 0 });
  });
});

describe('recordScores', () => {
  const empty: RotationHistory = { days: {} };

  it('merges same-day refreshes instead of overwriting', () => {
    const first = recordScores(empty, '2026-09-18', { a: 80, b: 60 });
    const second = recordScores(first, '2026-09-18', { a: 72 });
    expect(second.days['2026-09-18']).toEqual({ a: 72, b: 60 });
  });

  it('prunes to the newest 60 days', () => {
    let history: RotationHistory = { days: {} };
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 65; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      history = recordScores(history, date, { a: i });
    }
    expect(Object.keys(history.days)).toHaveLength(60);
    expect(history.days['2026-01-01']).toBeUndefined();
    expect(history.days['2026-01-06']).toEqual({ a: 5 });
    expect(history.days['2026-03-06']).toEqual({ a: 64 });
  });
});

describe('previousScores', () => {
  it('returns the most recent day strictly before the given date', () => {
    const history = recordScores(
      recordScores({ days: {} }, '2026-09-17', { a: 50 }),
      '2026-09-18',
      { a: 80 },
    );
    expect(previousScores(history, '2026-09-19')).toEqual({ a: 80 });
    expect(previousScores(history, '2026-09-18')).toEqual({ a: 50 });
    expect(previousScores(history, '2026-09-17')).toBeNull();
  });
});

describe('RotationHistoryStore', () => {
  it('persists, reloads and skips days without scores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rotation-history-'));
    const file = join(dir, 'macro-rotation-history.json');
    try {
      const store = new RotationHistoryStore();
      store.load(file);
      expect(store.previous('2026-09-18')).toBeNull();
      store.record('2026-09-18', [row('a', 80), row('b', null)]);
      store.record('2026-09-19', [row('a', null)]); // nothing scored → no day
      const reopened = new RotationHistoryStore();
      reopened.load(file);
      expect(reopened.previous('2026-09-20')).toEqual({ a: 80 });
      reopened.record('2026-09-20', [row('a', 92)]);
      expect(reopened.previous('2026-09-20')).toEqual({ a: 80 });
      expect(reopened.previous('2026-09-21')).toEqual({ a: 92 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades to empty when the file is missing or malformed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rotation-history-'));
    try {
      const store = new RotationHistoryStore();
      store.load(join(dir, 'missing.json'));
      expect(store.previous('2026-09-18')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
