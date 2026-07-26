import type { ElectronAPI } from "../electron";

function api(): ElectronAPI {
  if (typeof window === "undefined" || !window.electronAPI)
    throw new Error("not running in the Electron desktop app");
  return window.electronAPI;
}

export const isDesktop = true;

/** Start the bundled agent runtime (desktop only). Returns its base URL,
 *  or null for claude-code (no sidecar). `kind` selects the engine:
 *  "opencode" (default) or "claude-code". */
export async function startRuntime(kind?: "opencode" | "claude-code"): Promise<string | null> {
  try {
    return await api().startRuntime(kind);
  } catch (err) {
    console.error("[startRuntime] failed:", err);
    return null;
  }
}

export async function runtimePassword(): Promise<string | null> {
  try {
    return await api().runtimePassword();
  } catch {
    return null;
  }
}

export async function addFilesToWorkspace(): Promise<string[]> {
  try {
    return await api().addFilesToWorkspace();
  } catch {
    return [];
  }
}

export async function addTextToWorkspace(filename: string, content: string): Promise<string> {
  return api().addTextToWorkspace(filename, content);
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    await api().openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export type SaveResult =
  | { kind: "saved"; path: string }
  | { kind: "canceled" }
  | { kind: "not-desktop" };

export async function saveTextFile(filename: string, content: string): Promise<SaveResult> {
  try {
    const path = await api().saveTextFile(filename, content);
    return path ? { kind: "saved", path } : { kind: "canceled" };
  } catch {
    return { kind: "not-desktop" };
  }
}

export async function workspacePath(): Promise<string | null> {
  try {
    return await api().workspacePath();
  } catch {
    return null;
  }
}

export async function workspaceBase(): Promise<string | null> {
  try {
    return await api().workspaceBase();
  } catch {
    return null;
  }
}

export async function setWorkspaceBase(path: string): Promise<string> {
  return api().setWorkspaceBase(path);
}

export async function openWorkspaceBase(): Promise<void> {
  try {
    await api().openWorkspaceBase();
  } catch { /* noop if not desktop */ }
}

export async function setWorkspace(path: string): Promise<string> {
  return api().setWorkspace(path);
}

export async function newDatedWorkspace(name: string): Promise<string> {
  return api().newDatedWorkspace(name);
}

export async function pickFolder(): Promise<string | null> {
  try {
    return await api().pickFolder();
  } catch {
    return null;
  }
}

export interface ToolStatus {
  name: string;
  found: boolean;
  version?: string | null;
}

export async function detectTools(): Promise<ToolStatus[]> {
  try {
    return await api().detectTools() as ToolStatus[];
  } catch {
    return [];
  }
}

export async function logDebug(message: string): Promise<void> {
  try {
    await api().logDebug(message);
  } catch { /* never break the app on diagnostics */ }
}

export async function checkForUpdates(alertOnUpToDate?: boolean): Promise<void> {
  try {
    await api().checkForUpdates(alertOnUpToDate);
  } catch { /* ignore */ }
}

export async function exportLogs(): Promise<string | null> {
  try {
    return await api().exportLogs();
  } catch {
    return null;
  }
}

export async function channelName(): Promise<string | null> {
  try {
    return await api().channelName();
  } catch {
    return null;
  }
}

export async function appIdentifier(): Promise<string | null> {
  try {
    return await api().appIdentifier();
  } catch {
    return null;
  }
}

export async function appVersion(): Promise<string | null> {
  try {
    return await api().appVersion();
  } catch {
    return null;
  }
}

// ---- Scheduler ----

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  agent?: string;
  model?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  tags?: string[];
}

export interface CreateTaskInput {
  name: string;
  cron: string;
  prompt: string;
  agent?: string;
  model?: string;
  tags?: string[];
}

export interface UpdateTaskInput {
  name?: string;
  cron?: string;
  prompt?: string;
  agent?: string;
  model?: string;
  tags?: string[];
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  taskName: string;
  triggeredAt: string;
  status: "running" | "completed" | "failed" | "timeout";
  sessionId?: string;
  error?: string;
  durationMs?: number;
  completedAt?: string;
}

export async function schedulerList(): Promise<ScheduledTask[]> {
  try {
    return await api().schedulerList() as ScheduledTask[];
  } catch {
    return [];
  }
}

export async function schedulerCreate(task: CreateTaskInput): Promise<ScheduledTask | null> {
  try {
    return await api().schedulerCreate(task) as ScheduledTask;
  } catch {
    return null;
  }
}

export async function schedulerUpdate(id: string, patch: UpdateTaskInput): Promise<ScheduledTask | null> {
  try {
    return await api().schedulerUpdate(id, patch) as ScheduledTask;
  } catch {
    return null;
  }
}

export async function schedulerDelete(id: string): Promise<void> {
  try {
    await api().schedulerDelete(id);
  } catch { /* ignore */ }
}

export async function schedulerToggle(id: string, enabled: boolean): Promise<ScheduledTask | null> {
  try {
    return await api().schedulerToggle(id, enabled) as ScheduledTask;
  } catch {
    return null;
  }
}

export async function schedulerFireNow(id: string): Promise<ExecutionRecord | null> {
  try {
    return await api().schedulerFireNow(id) as ExecutionRecord;
  } catch {
    return null;
  }
}

export async function schedulerHistory(taskId?: string, limit?: number): Promise<ExecutionRecord[]> {
  try {
    return await api().schedulerHistory(taskId, limit) as ExecutionRecord[];
  } catch {
    return [];
  }
}
