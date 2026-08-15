import { contextBridge, ipcRenderer } from "electron";
import { browserMcpPreload } from "@fafawork/browser-mcp/preload";

const api = {
  ...browserMcpPreload,
  // Channel
  channelName: () => ipcRenderer.invoke("channel-name"),
  appIdentifier: () => ipcRenderer.invoke("app-identifier"),
  appVersion: () => ipcRenderer.invoke("app-version"),

  // Runtime (sidecar)
  startRuntime: (kind?: string) => ipcRenderer.invoke("start-runtime", kind),
  restartRuntime: (kind?: string) => ipcRenderer.invoke("restart-runtime", kind),
  runtimePassword: () => ipcRenderer.invoke("runtime-password"),
  stopRuntime: () => ipcRenderer.invoke("stop-runtime"),
  serverUrl: () => ipcRenderer.invoke("server-url"),

  // Workspace
  workspacePath: () => ipcRenderer.invoke("workspace-path"),
  workspaceBase: () => ipcRenderer.invoke("workspace-base"),
  setWorkspaceBase: (path: string) => ipcRenderer.invoke("set-workspace-base", path),
  setWorkspace: (path: string) => ipcRenderer.invoke("set-workspace", path),
  newDatedWorkspace: (name: string) => ipcRenderer.invoke("new-dated-workspace", name),
  openWorkspaceBase: () => ipcRenderer.invoke("open-workspace-base"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),

  // Artifact / File
  readArtifact: (rel: string, root?: string) => ipcRenderer.invoke("read-artifact", rel, root),
  openPath: (rel: string, root?: string) => ipcRenderer.invoke("open-path", rel, root),
  resolveArtifact: (rel: string) => ipcRenderer.invoke("resolve-artifact", rel),
  saveTextFile: (filename: string, content: string) => ipcRenderer.invoke("save-text-file", filename, content),
  openUrl: (url: string) => ipcRenderer.invoke("open-url", url),
  addFilesToWorkspace: () => ipcRenderer.invoke("add-files-to-workspace"),
  addTextToWorkspace: (filename: string, content: string) => ipcRenderer.invoke("add-text-to-workspace", filename, content),
  listNotebooks: (root?: string) => ipcRenderer.invoke("list-notebooks", root),
  listDir: (rel: string, root?: string) => ipcRenderer.invoke("list-dir", rel, root),
  writeWorkspaceFile: (rel: string, content: string, root?: string) => ipcRenderer.invoke("write-workspace-file", rel, content, root),

  // Kernel
  kernelExecute: (code: string, language: string, notebook?: string) =>
    ipcRenderer.invoke("kernel-execute", code, language, notebook),
  kernelReset: (language: string, notebook?: string) =>
    ipcRenderer.invoke("kernel-reset", language, notebook),

  // Provenance
  recordProvenance: (sessionId: string, callId: string, tool: string, input: unknown, output: unknown, model: string | null) =>
    ipcRenderer.invoke("record-provenance", sessionId, callId, tool, input, output, model),
  listProvenance: (path: string) => ipcRenderer.invoke("list-provenance", path),
  readEnvLockfile: (hash: string) => ipcRenderer.invoke("read-env-lockfile", hash),

  // Preview
  previewUrl: (rel: string, root?: string) => ipcRenderer.invoke("preview-url", rel, root),

  // Tools
  detectTools: () => ipcRenderer.invoke("detect-tools"),

  // Shell
  shellPath: () => ipcRenderer.invoke("shell-path"),
  shellInfo: () => ipcRenderer.invoke("shell-info"),

  // Store (persistent KV)
  storeGet: (key: string, scope?: string) => ipcRenderer.invoke("store-get", key, scope),
  storeSet: (key: string, value: unknown, scope?: string) => ipcRenderer.invoke("store-set", key, value, scope),
  storeDelete: (key: string, scope?: string) => ipcRenderer.invoke("store-delete", key, scope),
  storeClear: (scope?: string) => ipcRenderer.invoke("store-clear", scope),
  storeKeys: (scope?: string) => ipcRenderer.invoke("store-keys", scope),
  storeLength: (scope?: string) => ipcRenderer.invoke("store-length", scope),

  // Profile patch overlay
  profileManifest: () => ipcRenderer.invoke("profile-manifest"),
  profileInteraction: () => ipcRenderer.invoke("profile-interaction"),
  profileValidatePatch: (raw: string) => ipcRenderer.invoke("profile-validate-patch", raw),
  profileWritePatch: (raw: string) => ipcRenderer.invoke("profile-write-patch", raw),

  // Remote relay (host side)
  relayStatus: () => ipcRenderer.invoke("relay-status"),
  relayStart: (config: { relayUrl: string; deviceId: string; token: string }) =>
    ipcRenderer.invoke("relay-start", config),
  relayStop: () => ipcRenderer.invoke("relay-stop"),
  onRelayStatus: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on("relay-status-changed", handler);
    return () => ipcRenderer.removeListener("relay-status-changed", handler);
  },
  relayRemoteSessions: () => ipcRenderer.invoke("relay-remote-sessions"),
  onRelayRemoteSessionsChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("relay-remote-sessions-changed", handler);
    return () => ipcRenderer.removeListener("relay-remote-sessions-changed", handler);
  },

  // Logging
  logDebug: (message: string) => ipcRenderer.invoke("log-debug", message),
  logEvent: (level: string, module: string, message: string, data?: unknown) =>
    ipcRenderer.invoke("log-event", level, module, message, data),
  exportLogs: () => ipcRenderer.invoke("export-logs"),

  // Updater
  checkForUpdates: (alertOnUpToDate?: boolean) => ipcRenderer.invoke("check-for-updates", alertOnUpToDate),

  // Scheduler
  schedulerList: () => ipcRenderer.invoke("scheduler:list"),
  schedulerCreate: (task: unknown) => ipcRenderer.invoke("scheduler:create", task),
  schedulerUpdate: (id: string, patch: unknown) => ipcRenderer.invoke("scheduler:update", id, patch),
  schedulerDelete: (id: string) => ipcRenderer.invoke("scheduler:delete", id),
  schedulerToggle: (id: string, enabled: boolean) => ipcRenderer.invoke("scheduler:toggle", id, enabled),
  schedulerFireNow: (id: string) => ipcRenderer.invoke("scheduler:fire-now", id),
  schedulerHistory: (taskId?: string, limit?: number) => ipcRenderer.invoke("scheduler:history", taskId, limit),
  schedulerDeleteExecution: (id: string) => ipcRenderer.invoke("scheduler:delete-execution", id),
  schedulerClearHistory: (taskId?: string) => ipcRenderer.invoke("scheduler:clear-history", taskId),

  // Window
  openExternal: (url: string) => ipcRenderer.invoke("open-url", url),

  // Browser
  browserFetch: (url: string) => ipcRenderer.invoke("browser:fetch", url),

  // Browser command response (renderer → main process)
  browserCommandResponse: (requestId: string, result: unknown) =>
    ipcRenderer.invoke("browser:command-response", requestId, result),

  // Browser recording control (for UI buttons)
  browserRecordStart: () => ipcRenderer.invoke("browser:record-start"),
  browserRecordStop: () => ipcRenderer.invoke("browser:record-stop"),
  browserRecordState: () => ipcRenderer.invoke("browser:record-state"),
  browserRecordSave: (name: string, description?: string) => ipcRenderer.invoke("browser:record-save", name, description),
  browserRecordList: () => ipcRenderer.invoke("browser:record-list"),
  browserRecordReplay: (name: string, delay?: number) => ipcRenderer.invoke("browser:record-replay", name, delay),

  // Whisper STT (offline transcription)
  whisperAvailable: () => ipcRenderer.invoke("whisper-available"),
  whisperTranscribe: (wavBuffer: ArrayBuffer, lang?: string) =>
    ipcRenderer.invoke("whisper-transcribe", wavBuffer, lang),

  // Terminal (event-based streaming)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
};

contextBridge.exposeInMainWorld("electronAPI", api);
