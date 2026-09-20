// Macro insight notifications: alert thresholds, dedupe, and the persisted
// notification list (daily briefing ready / indicator moves).
//
// Disk access is injected via initMacroNotify(dataDir) so the decision logic
// (detectAlerts / isDuplicate) stays pure and unit-testable.

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MacroDashboardSnapshot, MacroNotification, MacroThemeId } from '@workbench/shared';

export const ALERT_INDEX_PCT = 1.5;
export const ALERT_CN10Y_DELTA = 0.05;
export const ALERT_FX_PCT = 0.3;
export const ALERT_DEDUPE_MS = 4 * 60 * 60 * 1000;
export const MAX_NOTIFICATIONS = 50;

/** Major indices that participate in day-move alerts (secid → label). */
const MAJOR_INDEX_SECIDS: Record<string, string> = {
  '1.000001': '上证指数',
  '1.000300': '沪深300',
};

export interface AlertCandidate {
  /** Dedupe key: same indicator + direction within the window. */
  dedupeKey: string;
  title: string;
  body: string;
  indicator: string;
}

function last<T>(list: T[]): T | null {
  return list.length > 0 ? list[list.length - 1] : null;
}

/**
 * Alerts are transitions observed while the app is running: the first refresh
 * (no previous snapshot) never alerts, it only primes the baseline.
 */
export function detectAlerts(
  prev: MacroDashboardSnapshot | null,
  next: MacroDashboardSnapshot,
): AlertCandidate[] {
  if (!prev) return [];
  const out: AlertCandidate[] = [];

  // 1) Major index day moves.
  for (const [secid, name] of Object.entries(MAJOR_INDEX_SECIDS)) {
    const pct = next.data.indices.find((q) => q.secid === secid)?.changePct;
    if (typeof pct !== 'number' || Math.abs(pct) < ALERT_INDEX_PCT) continue;
    const dir = pct >= 0 ? 'up' : 'down';
    out.push({
      dedupeKey: `index:${secid}:${dir}`,
      title: `${name} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
      body: `单日涨跌幅超过 ${ALERT_INDEX_PCT}% 阈值`,
      indicator: secid,
    });
  }

  // 2) China 10Y yield move vs the previous refresh (5bp).
  const prevY = last(prev.data.yields);
  const nextY = last(next.data.yields);
  if (prevY?.cn10y != null && nextY?.cn10y != null) {
    const delta = nextY.cn10y - prevY.cn10y;
    if (Math.abs(delta) >= ALERT_CN10Y_DELTA) {
      const bp = Math.round(delta * 100);
      out.push({
        dedupeKey: `cn10y:${bp >= 0 ? 'up' : 'down'}`,
        title: `中债 10Y 收益率 ${bp >= 0 ? '+' : ''}${bp}bp`,
        body: `较上次刷新 ${prevY.cn10y}% → ${nextY.cn10y}%`,
        indicator: 'cn10y',
      });
    }
  }

  // 3) USDCNH move vs the previous refresh (0.3%).
  const prevFx = prev.data.fx?.price ?? null;
  const nextFx = next.data.fx?.price ?? null;
  if (prevFx && nextFx) {
    const pct = ((nextFx - prevFx) / prevFx) * 100;
    if (Math.abs(pct) >= ALERT_FX_PCT) {
      out.push({
        dedupeKey: `usdcnh:${pct >= 0 ? 'up' : 'down'}`,
        title: `美元兑离岸人民币 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        body: `较上次刷新 ${prevFx} → ${nextFx}`,
        indicator: 'usdcnh',
      });
    }
  }

  return out;
}

/** True when the same key was notified within the dedupe window. */
export function isDuplicate(
  items: MacroNotification[],
  key: string,
  now: number = Date.now(),
  windowMs: number = ALERT_DEDUPE_MS,
): boolean {
  return items.some((n) => n.dedupeKey === key && now - Date.parse(n.createdAt) < windowMs);
}

// ---- Stateful part (initialized from the main process) ----

let dataFile: string | null = null;
let items: MacroNotification[] = [];

/** Load the persisted list; call once at startup (before any push). */
export function initMacroNotify(dataDir: string): void {
  dataFile = join(dataDir, 'macro-notifications.json');
  try {
    const parsed = JSON.parse(readFileSync(dataFile, 'utf-8')) as unknown;
    items = Array.isArray(parsed) ? (parsed as MacroNotification[]) : [];
  } catch {
    items = [];
  }
}

function persist(): void {
  if (!dataFile) return;
  try {
    writeFileSync(dataFile, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS), null, 2), 'utf-8');
  } catch {
    /* notification persistence is best-effort */
  }
}

export function listNotifications(): { items: MacroNotification[]; unread: number } {
  return {
    items: items.slice(0, MAX_NOTIFICATIONS),
    unread: items.filter((n) => !n.read).length,
  };
}

/** Mark one notification (or all, when `id` is omitted) as read. */
export function markRead(id?: string): { items: MacroNotification[]; unread: number } {
  items = id
    ? items.map((n) => (n.id === id ? { ...n, read: true } : n))
    : items.map((n) => ({ ...n, read: true }));
  persist();
  return listNotifications();
}

export function pushNotification(
  input: Omit<MacroNotification, 'id' | 'createdAt' | 'read'>,
): MacroNotification {
  const item: MacroNotification = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    read: false,
    ...input,
  };
  items = [item, ...items].slice(0, MAX_NOTIFICATIONS);
  persist();
  return item;
}

/** Daily briefing finished: the session is ready to read. */
export function pushBriefing(input: {
  themeId: MacroThemeId;
  sessionId: string;
  title: string;
}): MacroNotification {
  return pushNotification({
    kind: 'briefing',
    title: input.title,
    body: '点击查看生成的宏观简报',
    themeId: input.themeId,
    sessionId: input.sessionId,
  });
}

/** Detect + dedupe + persist alerts after a refresh; returns what was created. */
export function handleRefreshAlerts(
  prev: MacroDashboardSnapshot | null,
  next: MacroDashboardSnapshot,
): MacroNotification[] {
  const created: MacroNotification[] = [];
  for (const c of detectAlerts(prev, next)) {
    if (isDuplicate(items, c.dedupeKey)) continue;
    created.push(
      pushNotification({
        kind: 'alert',
        title: c.title,
        body: c.body,
        indicator: c.indicator,
        dedupeKey: c.dedupeKey,
      }),
    );
  }
  return created;
}
