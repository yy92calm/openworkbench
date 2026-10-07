// Agent runtime status tracking: monitors which agents are active, their
// current sessions, and basic resource usage. Provides query APIs for the
// UI to display real-time agent status.

import type { AgentCard, AgentStatus } from '@workbench/shared';

import { getAgent } from './agentRegistry';
import { getLogger } from './logging';

const log = getLogger('agentStatus');

/** In-memory status map: agent name → status. */
const agentStatuses = new Map<string, AgentStatus>();

/** Initialize status tracking for an agent. */
export function initAgentStatus(name: string): void {
  if (!agentStatuses.has(name)) {
    const card = getAgent(name);
    agentStatuses.set(name, {
      name,
      busy: false,
      sessionId: null,
      taskStartedAt: null,
      tasksCompleted: 0,
      card,
    });
    log.debug('initialized agent status', name);
  }
}

/** Mark an agent as busy with a session. */
export function setAgentBusy(name: string, sessionId: string): void {
  initAgentStatus(name);
  const status = agentStatuses.get(name)!;
  status.busy = true;
  status.sessionId = sessionId;
  status.taskStartedAt = new Date().toISOString();
  log.debug('agent busy', { name, sessionId });
}

/** Mark an agent as idle (task completed). */
export function setAgentIdle(name: string): void {
  const status = agentStatuses.get(name);
  if (!status) return;
  status.busy = false;
  status.sessionId = null;
  status.taskStartedAt = null;
  status.tasksCompleted += 1;
  log.debug('agent idle', { name, tasksCompleted: status.tasksCompleted });
}

/** Get status for a specific agent. */
export function getAgentStatus(name: string): AgentStatus | null {
  return agentStatuses.get(name) ?? null;
}

/** Get all agent statuses. */
export function getAllAgentStatuses(): AgentStatus[] {
  return Array.from(agentStatuses.values());
}

/** Get only busy agents. */
export function getBusyAgents(): AgentStatus[] {
  return Array.from(agentStatuses.values()).filter((s) => s.busy);
}

/** Get only idle agents. */
export function getIdleAgents(): AgentStatus[] {
  return Array.from(agentStatuses.values()).filter((s) => !s.busy);
}

/** Clear status for an agent (e.g., when agent is removed). */
export function clearAgentStatus(name: string): void {
  agentStatuses.delete(name);
  log.debug('cleared agent status', name);
}

/** Reset all statuses (e.g., on app restart). */
export function resetAllStatuses(): void {
  agentStatuses.clear();
  log.info('reset all agent statuses');
}
