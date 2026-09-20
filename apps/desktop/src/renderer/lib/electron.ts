import type {
  MacroBoard,
  MacroDashboardSnapshot,
  MacroIndustryDetail,
  MacroKlinePoint,
  MacroNotification,
  MacroReportMeta,
  MacroThemeId,
  ResearchDecision,
  ResearchOutcome,
  ResearchStance,
  SandboxStatus,
} from '@workbench/shared';

import type { ElectronAPI } from '../electron';

function api(): ElectronAPI {
  if (typeof window === 'undefined' || !window.electronAPI)
    throw new Error('not running in the Electron desktop app');
  return window.electronAPI;
}

export const isDesktop = true;

/** Start the bundled agent runtime (desktop only). Returns its base URL,
 *  or null for claude-code (no sidecar). `kind` selects the engine:
 *  "opencode" (default) or "claude-code". */
export async function startRuntime(kind?: 'opencode' | 'claude-code'): Promise<string | null> {
  try {
    return await api().startRuntime(kind);
  } catch (err) {
    console.error('[startRuntime] failed:', err);
    return null;
  }
}

/** Restart the sidecar (stop + start). Used after provider config changes. */
export async function restartRuntime(kind?: 'opencode' | 'claude-code'): Promise<string | null> {
  try {
    return await api().restartRuntime(kind);
  } catch (err) {
    console.error('[restartRuntime] failed:', err);
    return null;
  }
}

/** Sandbox enforcement status from the main process — null outside Electron
 *  (browser dev), where no sandbox exists to report. */
export async function sandboxStatus(): Promise<SandboxStatus | null> {
  try {
    return await api().sandboxStatus();
  } catch {
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
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export type SaveResult =
  { kind: 'saved'; path: string } | { kind: 'canceled' } | { kind: 'not-desktop' };

export async function saveTextFile(filename: string, content: string): Promise<SaveResult> {
  try {
    const path = await api().saveTextFile(filename, content);
    return path ? { kind: 'saved', path } : { kind: 'canceled' };
  } catch {
    return { kind: 'not-desktop' };
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
  } catch {
    /* noop if not desktop */
  }
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
    return (await api().detectTools()) as ToolStatus[];
  } catch {
    return [];
  }
}

export async function logDebug(message: string): Promise<void> {
  try {
    await api().logDebug(message);
  } catch {
    /* never break the app on diagnostics */
  }
}

export async function checkForUpdates(alertOnUpToDate?: boolean): Promise<void> {
  try {
    await api().checkForUpdates(alertOnUpToDate);
  } catch {
    /* ignore */
  }
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
  /** Optional budget guard: skip firing once today's run count reaches this. */
  maxRunsPerDay?: number;
  /** Macro insight task: the fire path rebuilds the prompt from live data. */
  macroTheme?: MacroThemeId;
}

export interface CreateTaskInput {
  name: string;
  cron: string;
  prompt: string;
  agent?: string;
  model?: string;
  tags?: string[];
  maxRunsPerDay?: number;
  macroTheme?: MacroThemeId;
}

export interface UpdateTaskInput {
  name?: string;
  cron?: string;
  prompt?: string;
  agent?: string;
  model?: string;
  tags?: string[];
  maxRunsPerDay?: number;
  macroTheme?: MacroThemeId;
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  taskName: string;
  triggeredAt: string;
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'skipped';
  sessionId?: string;
  error?: string;
  durationMs?: number;
  completedAt?: string;
}

export async function schedulerList(): Promise<ScheduledTask[]> {
  try {
    return (await api().schedulerList()) as ScheduledTask[];
  } catch {
    return [];
  }
}

// ---- Macro insights (宏观洞察) ----

/** Cached dashboard snapshot; resolves immediately (never waits on network). */
export async function macroDashboard(force = false): Promise<MacroDashboardSnapshot | null> {
  try {
    return (await api().macroDashboard({ force })) ?? null;
  } catch {
    return null;
  }
}

/** On-demand daily closes for a detail dialog (cached in the main process). */
export async function macroSeries(secid: string, days?: number): Promise<MacroKlinePoint[]> {
  try {
    return (await api().macroSeries(secid, days)) ?? [];
  } catch {
    return [];
  }
}

export async function macroNotifications(): Promise<{
  items: MacroNotification[];
  unread: number;
}> {
  try {
    return (await api().macroNotifications()) ?? { items: [], unread: 0 };
  } catch {
    return { items: [], unread: 0 };
  }
}

export async function macroNotificationsRead(id?: string): Promise<{
  items: MacroNotification[];
  unread: number;
}> {
  try {
    return (await api().macroNotificationsRead(id)) ?? { items: [], unread: 0 };
  } catch {
    return { items: [], unread: 0 };
  }
}

export function onMacroDashboard(cb: (snapshot: MacroDashboardSnapshot) => void): () => void {
  try {
    return api().onMacroDashboard(cb);
  } catch {
    return () => {};
  }
}

export function onMacroNotification(cb: (notification: MacroNotification) => void): () => void {
  try {
    return api().onMacroNotification(cb);
  } catch {
    return () => {};
  }
}

// ---- Background-generated reports (workspace research/reports) ----

/** Latest report per theme (the page shows one row per theme). */
export async function macroReports(): Promise<MacroReportMeta[]> {
  try {
    return (await api().macroReports()) ?? [];
  } catch {
    return [];
  }
}

export async function macroReportRead(
  file: string,
): Promise<{ file: string; markdown: string } | null> {
  try {
    return (await api().macroReportRead(file)) ?? null;
  } catch {
    return null;
  }
}

export type MacroRegenerateResult = { ok: true; taskId: string } | { ok: false; reason: string };

/** Re-run a theme's background task; resolves as soon as it is triggered. */
export async function macroRegenerate(themeId: MacroThemeId): Promise<MacroRegenerateResult> {
  try {
    return (await api().macroRegenerate(themeId)) as MacroRegenerateResult;
  } catch {
    return { ok: false, reason: 'ipc-failed' };
  }
}

export function onMacroReports(cb: () => void): () => void {
  try {
    return api().onMacroReports(cb);
  } catch {
    return () => {};
  }
}

/** Industry model: on-demand board detail (constituent valuation + history). */
export async function macroIndustry(board: MacroBoard): Promise<MacroIndustryDetail | null> {
  try {
    return (await api().macroIndustry(board)) ?? null;
  } catch {
    return null;
  }
}

// ---- Research loop (decision ledger + knowledge asset) ----

export async function researchDecisions(): Promise<ResearchDecision[]> {
  try {
    return (await api().researchDecisions()) ?? [];
  } catch {
    return [];
  }
}

export async function researchAddDecision(input: {
  model: 'rotation' | 'industry';
  target: string;
  stance: 'overweight' | 'neutral' | 'underweight' | 'watch';
  thesis: string;
  sessionId?: string;
}): Promise<ResearchDecision | null> {
  try {
    return (await api().researchAddDecision(input)) ?? null;
  } catch {
    return null;
  }
}

export async function researchAttribute(
  id: string,
  outcome: ResearchOutcome,
  note: string,
): Promise<ResearchDecision | null> {
  try {
    return (await api().researchAttribute(id, outcome, note)) ?? null;
  } catch {
    return null;
  }
}

export async function researchDigest(): Promise<string | null> {
  try {
    return (await api().researchDigest()) ?? null;
  } catch {
    return null;
  }
}

/** Edit a ledger entry (target / stance / thesis); null on failure. */
export async function researchUpdateDecision(
  id: string,
  patch: { target?: string; stance?: ResearchStance; thesis?: string },
): Promise<ResearchDecision | null> {
  try {
    return (await api().researchUpdateDecision(id, patch)) ?? null;
  } catch {
    return null;
  }
}

export async function researchDeleteDecision(id: string): Promise<boolean> {
  try {
    return (await api().researchDeleteDecision(id)) ?? false;
  } catch {
    return false;
  }
}

/** Write the ledger CSV into the workspace; null when the ledger is empty. */
export async function researchExport(): Promise<{ path: string; count: number } | null> {
  try {
    return (await api().researchExport()) ?? null;
  } catch {
    return null;
  }
}

/** Write the leadership report markdown into the workspace. */
export async function macroExportReport(markdown: string): Promise<{ path: string } | null> {
  try {
    return (await api().macroExportReport(markdown)) ?? null;
  } catch {
    return null;
  }
}

/** Last OpenCode profile deploy manifest (base/patch fingerprints). */
export async function profileManifest(): Promise<unknown | null> {
  try {
    return await api().profileManifest();
  } catch {
    return null;
  }
}

/** Interaction config (enabled renderers + UI defaults) from the profile. */
export async function profileInteraction(): Promise<unknown> {
  try {
    return await api().profileInteraction();
  } catch {
    return { renderers: [], ui: {} };
  }
}

/** Per-key config origin replay ("who said this value": base vs patch). */
export async function profileExplainConfig(): Promise<unknown> {
  try {
    return await api().profileExplainConfig();
  } catch {
    return { merged: {}, origins: {}, patchApplied: false };
  }
}

/** Dry-run a patch against the deployed opencode.json. Never writes. */
export async function profileValidatePatch(
  raw: string,
): Promise<
  | { ok: true; ops: number; baseHash: string }
  | { ok: false; rejection: { kind: string; detail: string } }
> {
  return await api().profileValidatePatch(raw);
}

/** Validate + persist the user patch overlay (patch.json). Pass
 *  `expectedBaseHash` (from a prior validate) for CAS-stale protection. */
export async function profileWritePatch(
  raw: string,
  expectedBaseHash?: string,
): Promise<{ ok: boolean; error?: string; stale?: boolean }> {
  try {
    return await api().profileWritePatch(raw, expectedBaseHash);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function schedulerCreate(task: CreateTaskInput): Promise<ScheduledTask | null> {
  try {
    return (await api().schedulerCreate(task)) as ScheduledTask;
  } catch {
    return null;
  }
}

export async function schedulerUpdate(
  id: string,
  patch: UpdateTaskInput,
): Promise<ScheduledTask | null> {
  try {
    return (await api().schedulerUpdate(id, patch)) as ScheduledTask;
  } catch {
    return null;
  }
}

export async function schedulerDelete(id: string): Promise<void> {
  try {
    await api().schedulerDelete(id);
  } catch {
    /* ignore */
  }
}

export async function schedulerToggle(id: string, enabled: boolean): Promise<ScheduledTask | null> {
  try {
    return (await api().schedulerToggle(id, enabled)) as ScheduledTask;
  } catch {
    return null;
  }
}

export async function schedulerFireNow(id: string): Promise<ExecutionRecord | null> {
  try {
    return (await api().schedulerFireNow(id)) as ExecutionRecord;
  } catch {
    return null;
  }
}

export async function schedulerHistory(
  taskId?: string,
  limit?: number,
): Promise<ExecutionRecord[]> {
  try {
    return (await api().schedulerHistory(taskId, limit)) as ExecutionRecord[];
  } catch {
    return [];
  }
}

export async function schedulerDeleteExecution(id: string): Promise<void> {
  try {
    await api().schedulerDeleteExecution(id);
  } catch {
    /* ignore */
  }
}

export async function schedulerClearHistory(taskId?: string): Promise<void> {
  try {
    await api().schedulerClearHistory(taskId);
  } catch {
    /* ignore */
  }
}

// ---- Room (peer chat) ----

export type RoomStatus = 'off' | 'connecting' | 'joined' | 'error';

export interface RoomMember {
  id: string;
  nickname?: string;
  pubKey?: string;
}

export interface RoomMessageMeta {
  filename?: string;
  size?: number;
  mime?: string;
  /** Audio duration in seconds. */
  duration?: number;
}

export type RoomEvent =
  | { type: 'status'; status: RoomStatus }
  | {
      type: 'joined';
      roomId: string;
      inviteCode: string;
      members: RoomMember[];
      enforceViewOnce: boolean;
      isCreator: boolean;
      destroyExpiresAt: number | null;
    }
  | { type: 'member-joined'; member: RoomMember }
  | { type: 'member-left'; memberId: string }
  | {
      type: 'message';
      msg: {
        messageId: string;
        from: string;
        nonce: string;
        ct: string;
        kind?: 'text' | 'audio' | 'file';
        fileId?: string;
        meta?: RoomMessageMeta;
        viewOnce?: boolean;
        at: number;
      };
    }
  | { type: 'message-viewed'; messageId: string }
  | { type: 'view-once-changed'; enforce: boolean }
  | { type: 'destroy-countdown'; expiresAt: number | null }
  | { type: 'destroyed' }
  | { type: 'error'; message: string };

export async function roomCreate(): Promise<{ inviteCode: string }> {
  return api().roomCreate();
}

export async function roomValidate(code: string): Promise<boolean> {
  return api().roomValidate(code);
}

export async function roomJoin(
  inviteCode: string,
  nickname: string,
  opts?: { enforceViewOnce?: boolean },
): Promise<boolean> {
  return api().roomJoin(inviteCode, nickname, opts);
}

export async function roomLeave(): Promise<boolean> {
  return api().roomLeave();
}

export async function roomSend(text: string, viewOnce: boolean): Promise<string> {
  return api().roomSend(text, viewOnce);
}

/** Pick a file via the OS file dialog. Returns { path, name, size, mime } or
 *  null if the user cancelled. */
export async function roomPickFile(): Promise<{
  path: string;
  name: string;
  size: number;
  mime: string;
} | null> {
  return api().roomPickFile();
}

export async function roomUploadFile(
  filePath: string,
  meta: { filename?: string; mime?: string; duration?: number },
): Promise<{ fileId: string }> {
  return api().roomUploadFile(filePath, meta);
}

/** Upload an in-memory blob (e.g. recorded audio) base64-encoded. */
export async function roomUploadBlob(
  base64Data: string,
  meta: { filename?: string; mime?: string; duration?: number },
): Promise<{ fileId: string }> {
  return api().roomUploadBlob(base64Data, meta);
}

export async function roomSendFile(
  fileId: string,
  kind: 'audio' | 'file',
  meta: RoomMessageMeta,
  viewOnce: boolean,
): Promise<string> {
  return api().roomSendFile(fileId, kind, meta, viewOnce);
}

/** Download a file blob to a local temp path and open the OS save dialog.
 *  Returns { path, cancelled } — path is the final saved path (or temp path
 *  if the user cancelled the save dialog). */
export async function roomDownloadFile(
  fileId: string,
  filename?: string,
): Promise<{ path: string; saved: boolean }> {
  return api().roomDownloadFile(fileId, filename);
}

/** Open an OS save dialog and return the chosen path or null if cancelled. */
export async function roomSaveDialog(defaultName: string): Promise<string | null> {
  return api().roomSaveDialog(defaultName);
}

export async function roomViewed(messageId: string): Promise<boolean> {
  return api().roomViewed(messageId);
}

export async function roomSetViewOnce(enforce: boolean): Promise<boolean> {
  return api().roomSetViewOnce(enforce);
}

export async function roomSendSessionShare(
  payload: { title: string; sessionId: string; summary: string },
  viewOnce?: boolean,
): Promise<string> {
  return api().roomSendSessionShare(payload, viewOnce);
}

export async function roomStatus(): Promise<{
  status: RoomStatus;
  inviteCode: string;
  myMemberId: string;
  members: RoomMember[];
}> {
  return api().roomStatus();
}

export function onRoomEvent(callback: (event: RoomEvent) => void): () => void {
  return api().onRoomEvent(callback as (event: unknown) => void);
}
