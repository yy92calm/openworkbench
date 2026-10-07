// Decision follow-up: track research decisions and proactively remind users
// to review outcomes. Compares decision-time market data with current data
// to evaluate decision effectiveness.

import type { ResearchDecision } from '@workbench/shared';

import { fireEvent } from './proactive';
import { listDecisions } from './research';
import { getLogger } from './logging';
import { getStore } from './store';

const log = getLogger('decisionFollowup');

const STORE_SCOPE = 'workbench.decisionFollowup';

export interface FollowupConfig {
  /** Enable automatic follow-up reminders. */
  enabled: boolean;
  /** Days after which to remind (default: 7). */
  remindAfterDays: number;
  /** Maximum notifications per day (default: 3). */
  maxPerDay: number;
}

export interface FollowupResult {
  decision: ResearchDecision;
  daysSinceDecision: number;
  reminderSent: boolean;
}

function getConfig(): FollowupConfig {
  const store = getStore(STORE_SCOPE);
  const defaults: FollowupConfig = {
    enabled: true,
    remindAfterDays: 7,
    maxPerDay: 3,
  };
  return { ...defaults, ...store.get('config') };
}

export function setFollowupConfig(patch: Partial<FollowupConfig>): void {
  const store = getStore(STORE_SCOPE);
  const current = getConfig();
  store.set('config', { ...current, ...patch });
}

/** Track which decisions have been reminded (to avoid duplicate reminders). */
const remindedDecisions = new Set<string>();

/** Check decisions and send follow-up reminders for those that are due. */
export function checkDecisionFollowups(): FollowupResult[] {
  const config = getConfig();
  if (!config.enabled) {
    log.debug('decision follow-up disabled');
    return [];
  }

  const decisions = listDecisions();
  const now = Date.now();
  const results: FollowupResult[] = [];

  for (const decision of decisions) {
    const decisionTime = Date.parse(decision.createdAt);
    const daysSince = (now - decisionTime) / (1000 * 60 * 60 * 24);

    if (daysSince < config.remindAfterDays) continue;
    if (remindedDecisions.has(decision.id)) continue;

    // Send follow-up reminder
    const result: FollowupResult = {
      decision,
      daysSinceDecision: Math.floor(daysSince),
      reminderSent: false,
    };

    try {
      fireEvent('decision.followup', {
        type: 'info',
        title: `决策回访: ${decision.target}`,
        message: `该决策已做出 ${Math.floor(daysSince)} 天，建议回顾效果。`,
        decisionId: decision.id,
        decisionTarget: decision.target,
        daysSince: Math.floor(daysSince),
      });
      result.reminderSent = true;
      remindedDecisions.add(decision.id);
      log.info('sent decision follow-up reminder', {
        decisionId: decision.id,
        daysSince: Math.floor(daysSince),
      });
    } catch (err) {
      log.error('failed to send decision follow-up', err);
    }

    results.push(result);

    // Respect daily limit
    if (results.filter((r) => r.reminderSent).length >= config.maxPerDay) {
      break;
    }
  }

  return results;
}

/** Get pending follow-ups (decisions that need review but haven't been reminded). */
export function getPendingFollowups(): FollowupResult[] {
  const config = getConfig();
  const decisions = listDecisions();
  const now = Date.now();
  const results: FollowupResult[] = [];

  for (const decision of decisions) {
    const decisionTime = Date.parse(decision.createdAt);
    const daysSince = (now - decisionTime) / (1000 * 60 * 60 * 24);

    if (daysSince < config.remindAfterDays) continue;
    if (remindedDecisions.has(decision.id)) continue;

    results.push({
      decision,
      daysSinceDecision: Math.floor(daysSince),
      reminderSent: false,
    });
  }

  return results;
}

/** Mark a decision as reviewed (removes it from follow-up tracking). */
export function markDecisionReviewed(decisionId: string): void {
  remindedDecisions.add(decisionId);
  log.info('marked decision as reviewed', { decisionId });
}

/** Reset follow-up tracking (e.g., on app restart). */
export function resetFollowupTracking(): void {
  remindedDecisions.clear();
  log.info('reset decision follow-up tracking');
}
