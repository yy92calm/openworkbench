// Rotation score history: one score map per trading day, persisted to
// userData so "vs previous trading day" deltas survive restarts.
//
// The parse/merge/prune logic is pure for unit tests; the small store class
// at the bottom is the only file IO.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { RotationRow } from '@workbench/shared';

/** Trading days of scores to keep. */
const MAX_DAYS = 60;

export interface RotationHistory {
  /** 'YYYY-MM-DD' → secid → composite score. */
  days: Record<string, Record<string, number>>;
}

export function parseRotationHistory(raw: string | null): RotationHistory {
  if (!raw) return { days: {} };
  try {
    const parsed = JSON.parse(raw) as { days?: unknown };
    if (!parsed || typeof parsed !== 'object' || !parsed.days) return { days: {} };
    return { days: sanitizeDays(parsed.days) };
  } catch {
    return { days: {} };
  }
}

function sanitizeDays(input: unknown): Record<string, Record<string, number>> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [date, scores] of Object.entries(input as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !scores || typeof scores !== 'object') continue;
    const clean: Record<string, number> = {};
    for (const [secid, value] of Object.entries(scores as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) clean[secid] = value;
    }
    out[date] = clean;
  }
  return out;
}

/** Scored rows → the day's map (rows without a score are skipped). */
export function scoresOf(rows: readonly RotationRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.score !== null) out[row.secid] = row.score;
  }
  return out;
}

/**
 * Merge one day's scores into the history. Same-day refreshes merge (a partial
 * fetch never erases earlier scores) and only the newest MAX_DAYS days stay.
 */
export function recordScores(
  history: RotationHistory,
  date: string,
  scores: Record<string, number>,
): RotationHistory {
  const days: Record<string, Record<string, number>> = {
    ...history.days,
    [date]: { ...history.days[date], ...scores },
  };
  const keep = Object.keys(days).sort().slice(-MAX_DAYS);
  const pruned: Record<string, Record<string, number>> = {};
  for (const d of keep) pruned[d] = days[d];
  return { days: pruned };
}

/** The most recent recorded day strictly before `date`, or null. */
export function previousScores(
  history: RotationHistory,
  date: string,
): Record<string, number> | null {
  const earlier = Object.keys(history.days)
    .filter((d) => d < date)
    .sort();
  const last = earlier[earlier.length - 1];
  return last ? history.days[last] : null;
}

/** File-backed history store (userData); all failures degrade to empty. */
export class RotationHistoryStore {
  private file: string | null = null;
  private history: RotationHistory = { days: {} };

  load(file: string): void {
    this.file = file;
    try {
      this.history = parseRotationHistory(readFileSync(file, 'utf-8'));
    } catch {
      this.history = { days: {} };
    }
  }

  previous(date: string): Record<string, number> | null {
    return previousScores(this.history, date);
  }

  record(date: string, rows: readonly RotationRow[]): void {
    const scores = scoresOf(rows);
    if (Object.keys(scores).length === 0) return;
    this.history = recordScores(this.history, date, scores);
    this.persist();
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch {
      /* history persistence is best-effort */
    }
  }
}
