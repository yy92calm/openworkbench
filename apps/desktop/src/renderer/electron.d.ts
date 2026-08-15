export interface ElectronAPI {
  channelName: () => Promise<string>;
  appIdentifier: () => Promise<string>;
  appVersion: () => Promise<string>;

  startRuntime: (kind?: string) => Promise<string | null>;
  restartRuntime: (kind?: string) => Promise<string | null>;
  runtimePassword: () => Promise<string>;
  stopRuntime: () => Promise<void>;
  serverUrl: () => Promise<string | null>;

  workspacePath: () => Promise<string>;
  workspaceBase: () => Promise<string>;
  setWorkspaceBase: (path: string) => Promise<string>;
  setWorkspace: (path: string) => Promise<string>;
  newDatedWorkspace: (name: string) => Promise<string>;
  openWorkspaceBase: () => Promise<void>;
  pickFolder: () => Promise<string | null>;

  readArtifact: (rel: string, root?: string) => Promise<{ content: string; binary: boolean } | null>;
  openPath: (rel: string, root?: string) => Promise<void>;
  resolveArtifact: (rel: string) => Promise<string | null>;
  saveTextFile: (filename: string, content: string) => Promise<string | null>;
  openUrl: (url: string) => Promise<void>;
  addFilesToWorkspace: () => Promise<string[]>;
  addTextToWorkspace: (filename: string, content: string) => Promise<string>;
  listNotebooks: (root?: string) => Promise<{ name: string; path: string; modified: string }[]>;
  listDir: (rel: string, root?: string) => Promise<{ name: string; is_dir: boolean; is_file: boolean; size: number }[]>;
  writeWorkspaceFile: (rel: string, content: string, root?: string) => Promise<void>;

  kernelExecute: (code: string, language: string, notebook?: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  kernelReset: (language: string, notebook?: string) => Promise<void>;

  recordProvenance: (sessionId: string, callId: string, tool: string, input: unknown, output: unknown, model: string | null) => Promise<void>;
  listProvenance: (path: string) => Promise<unknown[]>;
  readEnvLockfile: (hash: string) => Promise<string>;

  previewUrl: (rel: string, root?: string) => Promise<string | null>;

  detectTools: () => Promise<{ name: string; found: boolean; version: string | null }[]>;

  shellPath: () => Promise<string>;
  shellInfo: () => Promise<{ path: string; name: string; isDefault: boolean }[]>;

  storeGet: (key: string, scope?: string) => Promise<unknown>;
  storeSet: (key: string, value: unknown, scope?: string) => Promise<void>;
  storeDelete: (key: string, scope?: string) => Promise<void>;
  storeClear: (scope?: string) => Promise<void>;
  storeKeys: (scope?: string) => Promise<string[]>;
  storeLength: (scope?: string) => Promise<number>;

  profileManifest: () => Promise<unknown | null>;
  profileInteraction: () => Promise<unknown>;
  profileValidatePatch: (raw: string) =>
    Promise<{ ok: true; ops: number } | { ok: false; rejection: { kind: string; detail: string } }>;
  profileWritePatch: (raw: string) => Promise<{ ok: boolean; error?: string }>;

  /** Remote relay (host side). */
  relayStatus: () => Promise<{
    status: "off" | "connecting" | "connected" | "error";
    config: { enabled: boolean; relayUrl: string; deviceId: string; tokenSet: boolean };
  }>;
  relayStart: (config: { relayUrl: string; deviceId: string; token: string }) =>
    Promise<"off" | "connecting" | "connected" | "error">;
  relayStop: () => Promise<string>;
  onRelayStatus: (callback: (status: string) => void) => () => void;
  /** Session IDs created by remote guests via relay (for sidebar badge). */
  relayRemoteSessions: () => Promise<string[]>;
  onRelayRemoteSessionsChanged: (callback: () => void) => () => void;

  logDebug: (message: string) => Promise<void>;
  logEvent: (level: string, module: string, message: string, data?: unknown) => Promise<void>;
  exportLogs: () => Promise<string>;

  checkForUpdates: (alertOnUpToDate?: boolean) => Promise<void>;

  openExternal: (url: string) => Promise<void>;

  // Scheduler
  schedulerList: () => Promise<unknown[]>;
  schedulerCreate: (task: unknown) => Promise<unknown>;
  schedulerUpdate: (id: string, patch: unknown) => Promise<unknown>;
  schedulerDelete: (id: string) => Promise<void>;
  schedulerToggle: (id: string, enabled: boolean) => Promise<unknown>;
  schedulerFireNow: (id: string) => Promise<unknown>;
  schedulerHistory: (taskId?: string, limit?: number) => Promise<unknown[]>;
  schedulerDeleteExecution: (id: string) => Promise<void>;
  schedulerClearHistory: (taskId?: string) => Promise<void>;

  /** Fetch page content from a URL (browser service). */
  browserFetch: (url: string) => Promise<string | null>;

  /** Whisper STT (offline transcription). */
  whisperAvailable: () => Promise<boolean>;
  whisperTranscribe: (wavBuffer: ArrayBuffer, lang?: string) => Promise<string>;

  /** Listen for events from the main process (terminal data streaming). */
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  /** Generic invoke for terminal IPC. */
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
