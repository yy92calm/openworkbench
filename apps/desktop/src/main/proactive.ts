// Proactive behavior engine: event-driven triggers that fire actions
// automatically. Phase 1 covers session.idle → auto-memory extraction and
// proactive notifications pushed to the renderer.

import { getLogger } from './logging';
import { getStore } from './store';

const STORE_SCOPE = 'workbench.proactive';

export interface ProactiveTrigger {
  id: string;
  /** Event name that fires this trigger (e.g. 'session.idle'). */
  event: string;
  /** Action to execute when the event fires. */
  action: string;
  /** Action-specific configuration. */
  config?: Record<string, unknown>;
}

export interface ProactiveNotification {
  id: string;
  type: 'info' | 'warning' | 'success';
  title: string;
  message: string;
  timestamp: string;
}

type NotificationListener = (notification: ProactiveNotification) => void;

interface ProactiveState {
  triggers: ProactiveTrigger[];
  notificationsSent: number;
}

let state: ProactiveState = { triggers: [], notificationsSent: 0 };
const listeners: Set<NotificationListener> = new Set();
let initialized = false;

function loadState(): void {
  if (initialized) return;
  const store = getStore(STORE_SCOPE);
  const saved = store.get('state') as Partial<ProactiveState> | undefined;
  state = {
    triggers: saved?.triggers ?? [],
    notificationsSent: saved?.notificationsSent ?? 0,
  };
  initialized = true;
}

function persistState(): void {
  const store = getStore(STORE_SCOPE);
  store.set('state', state);
}

// ---- Trigger management ----

export function registerTrigger(trigger: ProactiveTrigger): { ok: boolean; error?: string } {
  loadState();
  const existing = state.triggers.findIndex((t) => t.id === trigger.id);
  if (existing >= 0) {
    state.triggers[existing] = trigger;
  } else {
    state.triggers.push(trigger);
  }
  persistState();
  getLogger().info(
    `[proactive] registered trigger ${trigger.id} (${trigger.event} → ${trigger.action})`,
  );
  return { ok: true };
}

export function removeTrigger(id: string): { ok: boolean } {
  loadState();
  state.triggers = state.triggers.filter((t) => t.id !== id);
  persistState();
  getLogger().info(`[proactive] removed trigger ${id}`);
  return { ok: true };
}

export function listTriggers(): ProactiveTrigger[] {
  loadState();
  return [...state.triggers];
}

// ---- Event firing ----

/**
 * Fire an event, executing all matching triggers' actions.
 * Returns the number of actions executed.
 */
export function fireEvent(
  event: string,
  context: Record<string, unknown>,
): { actionsExecuted: number } {
  loadState();
  const matching = state.triggers.filter((t) => t.event === event);
  if (matching.length === 0) return { actionsExecuted: 0 };

  let executed = 0;
  for (const trigger of matching) {
    try {
      executeAction(trigger.action, { ...context, triggerConfig: trigger.config });
      executed++;
    } catch (err) {
      getLogger().error(
        `[proactive] action ${trigger.action} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { actionsExecuted: executed };
}

function executeAction(action: string, context: Record<string, unknown>): void {
  switch (action) {
    case 'notify-user':
      sendNotification({
        id: generateId(),
        type: (context.type as ProactiveNotification['type']) ?? 'info',
        title: (context.title as string) ?? 'Notification',
        message: (context.message as string) ?? '',
        timestamp: new Date().toISOString(),
      });
      break;
    case 'extract-memory':
      // Memory extraction is triggered via the renderer's session.idle handler
      // calling autoMemoryExtract IPC. This action is a no-op in the main process
      // but registered for completeness and future server-side extraction.
      break;
    default:
      getLogger().warn(`[proactive] unknown action: ${action}`);
  }
}

// ---- Notifications ----

export function sendNotification(notification: ProactiveNotification): void {
  loadState();
  state.notificationsSent++;
  persistState();
  for (const listener of listeners) {
    try {
      listener(notification);
    } catch {
      // Listener errors don't affect the sender
    }
  }
}

export function onNotification(listener: NotificationListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- Status ----

export function getStatus(): { enabled: boolean; triggers: number; notificationsSent: number } {
  loadState();
  return {
    enabled: state.triggers.length > 0,
    triggers: state.triggers.length,
    notificationsSent: state.notificationsSent,
  };
}

// ---- Helpers ----

function generateId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Built-in triggers ----

/** Register the default set of triggers that ship with the app. */
export function registerDefaults(): void {
  loadState();
  const alreadyRegistered = state.triggers.some((t) => t.id === 'task-complete-notify');
  if (alreadyRegistered) return;

  registerTrigger({
    id: 'task-complete-notify',
    event: 'task.completed',
    action: 'notify-user',
    config: {
      type: 'success',
      title: '任务完成',
      message: '您的长时间任务已完成。',
    },
  });

  registerTrigger({
    id: 'session-error-notify',
    event: 'session.error',
    action: 'notify-user',
    config: {
      type: 'warning',
      title: '会话出错',
      message: '会话执行过程中发生了错误。',
    },
  });

  registerTrigger({
    id: 'macro-alert-notify',
    event: 'macro.alert',
    action: 'notify-user',
    config: {
      type: 'info',
      title: '宏观预警',
      message: '市场指标发生显著变化。',
    },
  });

  registerTrigger({
    id: 'decision-followup-notify',
    event: 'decision.followup',
    action: 'notify-user',
    config: {
      type: 'info',
      title: '决策回访',
      message: '建议回顾之前的决策效果。',
    },
  });

  registerTrigger({
    id: 'insight-notify',
    event: 'insight.generated',
    action: 'notify-user',
    config: {
      type: 'info',
      title: '主题洞察',
      message: '检测到跨会话的知识模式。',
    },
  });

  registerTrigger({
    id: 'workflow-pattern-notify',
    event: 'workflow.pattern',
    action: 'notify-user',
    config: {
      type: 'info',
      title: '工作流模式',
      message: '检测到重复的操作序列。',
    },
  });

  registerTrigger({
    id: 'knowledge-gap-notify',
    event: 'knowledge.gap',
    action: 'notify-user',
    config: {
      type: 'info',
      title: '知识缺口',
      message: '检测到相关但未召回的知识条目。',
    },
  });
}
