// Auto session cleanup: remove old sessions to keep the session list manageable.
// Sessions older than a configurable threshold are deleted automatically.

import type { AgentRuntime } from '@workbench/sdk/agent-runtime';

import { getLogger } from './logging';
import { getStore } from './store';

const STORE_SCOPE = 'workbench.sessionCleanup';
const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_MIN_SESSIONS_TO_KEEP = 10;

export interface SessionCleanupConfig {
  enabled: boolean;
  maxAgeDays: number;
  minSessionsToKeep: number;
}

export function getCleanupConfig(): SessionCleanupConfig {
  const store = getStore(STORE_SCOPE);
  const defaults: SessionCleanupConfig = {
    enabled: true,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    minSessionsToKeep: DEFAULT_MIN_SESSIONS_TO_KEEP,
  };
  return { ...defaults, ...store.get('config') };
}

export function setCleanupConfig(patch: Partial<SessionCleanupConfig>): void {
  const store = getStore(STORE_SCOPE);
  const current = getCleanupConfig();
  store.set('config', { ...current, ...patch });
}

/**
 * Clean up old sessions. Returns the number of sessions deleted.
 * Respects minSessionsToKeep to avoid deleting all sessions.
 */
export async function cleanupOldSessions(
  client: AgentRuntime,
): Promise<{ deleted: number; remaining: number }> {
  const log = getLogger();
  const config = getCleanupConfig();

  if (!config.enabled) {
    log.info('[session-cleanup] cleanup disabled');
    return { deleted: 0, remaining: 0 };
  }

  try {
    const sessions = await client.listSessions();
    const now = Date.now();
    const maxAgeMs = config.maxAgeDays * 24 * 60 * 60 * 1000;

    // Sort by createdAt descending (newest first)
    const sorted = [...sessions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    // Find sessions older than threshold, but keep at least minSessionsToKeep
    const toDelete: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const session = sorted[i];
      const age = now - (session.createdAt ?? 0);

      // Skip if within retention period
      if (age < maxAgeMs) continue;

      // Skip if we'd delete too many (keep at least minSessionsToKeep)
      if (sorted.length - toDelete.length <= config.minSessionsToKeep) {
        log.info(`[session-cleanup] keeping session ${session.id} to maintain minimum count`);
        continue;
      }

      toDelete.push(session.id);
    }

    let deleted = 0;
    for (const id of toDelete) {
      try {
        await client.deleteSession(id);
        deleted++;
        log.info(`[session-cleanup] deleted old session ${id}`);
      } catch (err) {
        log.warn(
          `[session-cleanup] failed to delete session ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const remaining = sessions.length - deleted;
    log.info(`[session-cleanup] deleted ${deleted} old sessions, ${remaining} remaining`);

    return { deleted, remaining };
  } catch (err) {
    log.error(
      `[session-cleanup] cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { deleted: 0, remaining: 0 };
  }
}
