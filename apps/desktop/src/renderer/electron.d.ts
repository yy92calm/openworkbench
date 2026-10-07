import type {
  AgentCard,
  AgentStatus,
  AggregatedSkill,
  KnowledgeEntry,
  KnowledgeEntryMeta,
  KnowledgeInput,
  MacroBoard,
  MacroDashboardSnapshot,
  MacroIndustryDetail,
  MacroKlinePoint,
  MacroNotification,
  MacroReportMeta,
  MacroThemeId,
  ResearchDecision,
  SandboxStatus,
  SkillsConfig,
  SkillsLinkResult,
} from '@workbench/shared';

export interface WindowBehaviorStatus {
  shortcut: string;
  /** False when another app already owns the hotkey. */
  shortcutRegistered: boolean;
  trayAvailable: boolean;
}

export interface SidecarVersionStatus {
  /** Bundled engine version; null when the binary could not be probed. */
  current: string | null;
  /** Latest upstream release; null when the check failed. */
  latest: string | null;
  /** True/false once both sides are known, null otherwise. */
  isLatest: boolean | null;
  /** Why the check failed (offline, rate-limited, …), if it did. */
  error: string | null;
}

export interface ElectronAPI {
  channelName: () => Promise<string>;
  appIdentifier: () => Promise<string>;
  appVersion: () => Promise<string>;

  startRuntime: (kind?: string) => Promise<string | null>;
  restartRuntime: (kind?: string) => Promise<string | null>;
  runtimePassword: () => Promise<string>;
  stopRuntime: () => Promise<void>;
  serverUrl: () => Promise<string | null>;
  /** Sandbox enforcement status (platform / mode / effective) from the main
   *  process. */
  sandboxStatus: () => Promise<SandboxStatus>;
  /** Tray availability + whether the global show/hide hotkey got registered
   *  (false when another app already owns the combination). */
  windowBehavior: () => Promise<WindowBehaviorStatus>;

  workspacePath: () => Promise<string>;
  workspaceBase: () => Promise<string>;
  setWorkspaceBase: (path: string) => Promise<string>;
  setWorkspace: (path: string) => Promise<string>;
  newDatedWorkspace: (name: string) => Promise<string>;
  openWorkspaceBase: () => Promise<void>;
  pickFolder: () => Promise<string | null>;

  readArtifact: (
    rel: string,
    root?: string,
  ) => Promise<{ content: string; binary: boolean } | null>;
  openPath: (rel: string, root?: string) => Promise<void>;
  resolveArtifact: (rel: string) => Promise<string | null>;
  saveTextFile: (filename: string, content: string) => Promise<string | null>;
  openUrl: (url: string) => Promise<void>;
  addFilesToWorkspace: () => Promise<string[]>;
  addTextToWorkspace: (filename: string, content: string) => Promise<string>;
  listNotebooks: (root?: string) => Promise<{ name: string; path: string; modified: string }[]>;
  listDir: (
    rel: string,
    root?: string,
  ) => Promise<{ name: string; is_dir: boolean; is_file: boolean; size: number }[]>;
  writeWorkspaceFile: (rel: string, content: string, root?: string) => Promise<void>;

  kernelExecute: (
    code: string,
    language: string,
    notebook?: string,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  kernelReset: (language: string, notebook?: string) => Promise<void>;

  recordProvenance: (
    sessionId: string,
    callId: string,
    tool: string,
    input: unknown,
    output: unknown,
    model: string | null,
  ) => Promise<void>;
  listProvenance: (path: string) => Promise<unknown[]>;
  readEnvLockfile: (hash: string) => Promise<string>;

  /** Persist a compaction-boundary transcript snapshot for audit. */
  writeCompactionSnapshot: (payload: {
    sessionId: string;
    historyVersion: number;
    triggeredAt: string;
    messages: unknown[];
  }) => Promise<string | null>;

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
  profileExplainConfig: () => Promise<unknown>;
  profileValidatePatch: (
    raw: string,
  ) => Promise<
    | { ok: true; ops: number; baseHash: string }
    | { ok: false; rejection: { kind: string; detail: string } }
  >;
  profileWritePatch: (
    raw: string,
    expectedBaseHash?: string,
  ) => Promise<{ ok: boolean; error?: string; stale?: boolean }>;

  /** Remote relay (host side). */
  relayStatus: () => Promise<{
    status: 'off' | 'connecting' | 'connected' | 'error';
    config: {
      enabled: boolean;
      relayUrl: string;
      deviceId: string;
      tokenSet: boolean;
      keepAwake: boolean;
    };
  }>;
  relayStart: (config: {
    relayUrl: string;
    deviceId: string;
    token: string;
    keepAwake?: boolean;
  }) => Promise<'off' | 'connecting' | 'connected' | 'error'>;
  relayStop: () => Promise<string>;
  /** Toggle keep-awake live (applies without reconnecting). */
  relaySetKeepAwake: (on: boolean) => Promise<void>;
  onRelayStatus: (callback: (status: string) => void) => () => void;
  /** Session IDs created by remote guests via relay (for sidebar badge). */
  relayRemoteSessions: () => Promise<string[]>;
  onRelayRemoteSessionsChanged: (callback: () => void) => () => void;

  // Room (peer chat)
  roomCreate: () => Promise<{ inviteCode: string }>;
  roomValidate: (code: string) => Promise<boolean>;
  roomJoin: (
    inviteCode: string,
    nickname: string,
    opts?: { enforceViewOnce?: boolean },
  ) => Promise<boolean>;
  roomLeave: () => Promise<boolean>;
  roomSend: (text: string, viewOnce: boolean) => Promise<string>;
  roomViewed: (messageId: string) => Promise<boolean>;
  roomSetViewOnce: (enforce: boolean) => Promise<boolean>;
  roomSendSessionShare: (
    payload: { title: string; sessionId: string; summary: string },
    viewOnce?: boolean,
  ) => Promise<string>;
  roomStatus: () => Promise<{
    status: 'off' | 'connecting' | 'joined' | 'error';
    inviteCode: string;
    myMemberId: string;
    members: Array<{ id: string; nickname?: string; pubKey?: string }>;
  }>;
  onRoomEvent: (callback: (event: unknown) => void) => () => void;

  logDebug: (message: string) => Promise<void>;
  logEvent: (level: string, module: string, message: string, data?: unknown) => Promise<void>;
  exportLogs: () => Promise<string>;

  checkForUpdates: (alertOnUpToDate?: boolean) => Promise<void>;
  /** Engine (opencode) version check — separate from the Workbench app updater
   *  above: two different things that must not be presented as one. */
  checkSidecarVersion: () => Promise<SidecarVersionStatus>;

  openExternal: (url: string) => Promise<void>;

  // Knowledge base (personal vault stored in the app's userData dir)
  knowledgeList: () => Promise<KnowledgeEntryMeta[]>;
  knowledgeGet: (id: string) => Promise<KnowledgeEntry>;
  /** Throws when a required field is blank — nothing is written in that case. */
  knowledgeSave: (input: KnowledgeInput) => Promise<KnowledgeEntry>;
  knowledgeDelete: (id: string) => Promise<void>;
  knowledgeCategories: () => Promise<string[]>;
  knowledgeSaveCategories: (categories: string[]) => Promise<string[]>;

  // Auto long-term memory
  autoMemoryExtract: (sessionId: string) => Promise<{
    extracted: number;
    saved: number;
    reason?: string;
  }>;
  autoMemoryExtractFromMessages: (
    messages: { role: string; parts: { type: string; text?: string; synthetic?: boolean }[] }[],
  ) => Promise<{
    extracted: number;
    saved: number;
    reason?: string;
  }>;
  autoMemoryRecall: (
    query: string,
    limit?: number,
  ) => Promise<{ context: string; memories: { id: string; title: string; summary: string }[] }>;
  autoMemoryConsolidate: () => Promise<{ removed: number; remaining: number }>;

  // Session tagging
  sessionExtractTags: (messages: unknown[]) => Promise<{ tags: string[] }>;
  sessionSaveTags: (sessionId: string, tags: string[]) => Promise<{ ok: boolean }>;
  sessionGetTags: (sessionId: string) => Promise<{ tags: string[] }>;

  // Session cleanup
  sessionCleanupRun: () => Promise<{ deleted: number; remaining: number; error?: string }>;
  sessionCleanupConfigGet: () => Promise<{
    enabled: boolean;
    maxAgeDays: number;
    minSessionsToKeep: number;
  }>;
  sessionCleanupConfigSet: (patch: {
    enabled?: boolean;
    maxAgeDays?: number;
    minSessionsToKeep?: number;
  }) => Promise<{
    enabled: boolean;
    maxAgeDays: number;
    minSessionsToKeep: number;
  }>;

  // Proactive engine (event-driven triggers + notifications)
  proactiveStatus: () => Promise<{
    enabled: boolean;
    triggers: number;
    notificationsSent: number;
  }>;
  proactiveRegisterTrigger: (trigger: {
    id: string;
    event: string;
    action: string;
    config?: Record<string, unknown>;
  }) => Promise<{ ok: boolean; error?: string }>;
  proactiveListTriggers: () => Promise<
    { id: string; event: string; action: string; config?: Record<string, unknown> }[]
  >;
  proactiveRemoveTrigger: (id: string) => Promise<{ ok: boolean }>;
  proactiveFireEvent: (
    event: string,
    context: Record<string, unknown>,
  ) => Promise<{ actionsExecuted: number }>;
  onProactiveNotification: (callback: (notification: unknown) => void) => () => void;

  // Decision follow-up
  decisionFollowupCheck: () => Promise<
    Array<{
      decision: ResearchDecision;
      daysSinceDecision: number;
      reminderSent: boolean;
    }>
  >;
  decisionFollowupPending: () => Promise<
    Array<{
      decision: ResearchDecision;
      daysSinceDecision: number;
      reminderSent: boolean;
    }>
  >;
  decisionFollowupMarkReviewed: (decisionId: string) => Promise<{ ok: boolean }>;
  decisionFollowupConfigGet: () => Promise<{
    enabled: boolean;
    remindAfterDays: number;
    maxPerDay: number;
  }>;
  decisionFollowupConfigSet: (patch: {
    enabled?: boolean;
    remindAfterDays?: number;
    maxPerDay?: number;
  }) => Promise<{
    enabled: boolean;
    remindAfterDays: number;
    maxPerDay: number;
  }>;

  // Session insights
  sessionInsightsAnalyze: () => Promise<
    Array<{
      tag: string;
      sessionCount: number;
      relatedMemories: KnowledgeEntryMeta[];
      summary: string;
      generatedAt: string;
    }>
  >;
  sessionInsightsGet: () => Promise<
    Array<{
      tag: string;
      sessionCount: number;
      relatedMemories: KnowledgeEntryMeta[];
      summary: string;
      generatedAt: string;
    }>
  >;
  sessionInsightsConfigGet: () => Promise<{
    enabled: boolean;
    minSessionsForInsight: number;
    maxInsightsPerDay: number;
  }>;
  sessionInsightsConfigSet: (patch: {
    enabled?: boolean;
    minSessionsForInsight?: number;
    maxInsightsPerDay?: number;
  }) => Promise<{
    enabled: boolean;
    minSessionsForInsight: number;
    maxInsightsPerDay: number;
  }>;

  // Workflow patterns
  workflowPatternsRecord: (step: { type: string; detail?: string }) => Promise<{ ok: boolean }>;
  workflowPatternsTop: (limit?: number) => Promise<
    Array<{
      id: string;
      steps: Array<{ type: string; detail?: string; timestamp: string }>;
      occurrences: number;
      firstSeen: string;
      lastSeen: string;
      suggestedName: string;
    }>
  >;
  workflowPatternsGet: () => Promise<
    Array<{
      id: string;
      steps: Array<{ type: string; detail?: string; timestamp: string }>;
      occurrences: number;
      firstSeen: string;
      lastSeen: string;
      suggestedName: string;
    }>
  >;
  workflowPatternsConfigGet: () => Promise<{
    enabled: boolean;
    minOccurrences: number;
    maxPatternLength: number;
    patternWindowMs: number;
  }>;
  workflowPatternsConfigSet: (patch: {
    enabled?: boolean;
    minOccurrences?: number;
    maxPatternLength?: number;
    patternWindowMs?: number;
  }) => Promise<{
    enabled: boolean;
    minOccurrences: number;
    maxPatternLength: number;
    patternWindowMs: number;
  }>;

  // Knowledge gap (enhanced recall)
  autoMemoryRecallWithGaps: (
    query: string,
    limit?: number,
  ) => Promise<{
    recalled: KnowledgeEntry[];
    unrecalledCount: number;
    unrecalledSamples: KnowledgeEntry[];
    context: string;
  }>;

  // Agent registry (A2A Agent Card)
  agentsList: () => Promise<AgentCard[]>;
  agentsGet: (name: string) => Promise<AgentCard | null>;
  agentsSearch: (
    query: string,
    options?: {
      tags?: string[];
      tools?: string[];
      mcp?: string[];
      skills?: string[];
      enabledOnly?: boolean;
    },
  ) => Promise<AgentCard[]>;
  agentsSuggest: (query: string) => Promise<AgentCard | null>;

  // Agent runtime status
  agentsStatusGet: (name: string) => Promise<AgentStatus | null>;
  agentsStatusAll: () => Promise<AgentStatus[]>;
  agentsStatusBusy: () => Promise<AgentStatus[]>;
  agentsStatusIdle: () => Promise<AgentStatus[]>;

  // Agent routing
  agentsRoute: (
    message: string,
    currentAgent?: string,
  ) => Promise<{
    agent: string;
    confidence: number;
    reason: string;
    alternatives: Array<{ agent: string; confidence: number; reason: string }>;
  }>;
  agentsShouldSwitch: (
    message: string,
    currentAgent: string,
  ) => Promise<{ shouldSwitch: boolean; recommended: string; reason: string } | null>;

  // External skill sources (aggregated from folders the user chose)
  skillsConfig: () => Promise<SkillsConfig>;
  /** Every skill across the configured sources, with its enable state. */
  skillsList: () => Promise<AggregatedSkill[]>;
  /** Native folder picker; null when cancelled. */
  skillsPickSource: () => Promise<string | null>;
  skillsAddSource: (dir: string) => Promise<SkillsConfig>;
  skillsRemoveSource: (dir: string) => Promise<SkillsConfig>;
  /** Throws when the skill is unknown or ambiguous across sources. */
  skillsSetEnabled: (name: string, enable: boolean) => Promise<SkillsConfig>;
  skillsSchemes: () => Promise<string[]>;
  skillsReadScheme: (name: string) => Promise<string[] | null>;
  skillsSaveScheme: (name: string, names: string[]) => Promise<void>;
  skillsDeleteScheme: (name: string) => Promise<void>;
  /** Switch the enabled set to a saved group; reports what could not be linked. */
  skillsApplyScheme: (name: string) => Promise<SkillsLinkResult>;

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

  /** Macro insights (宏观洞察): reads return the cached snapshot immediately. */
  macroDashboard: (opts?: { force?: boolean }) => Promise<MacroDashboardSnapshot>;
  macroSeries: (secid: string, days?: number) => Promise<MacroKlinePoint[]>;
  macroNotifications: () => Promise<{ items: MacroNotification[]; unread: number }>;
  macroNotificationsRead: (id?: string) => Promise<{ items: MacroNotification[]; unread: number }>;
  onMacroDashboard: (callback: (snapshot: MacroDashboardSnapshot) => void) => () => void;
  onMacroNotification: (callback: (notification: MacroNotification) => void) => () => void;

  /** Industry model: on-demand board detail. */
  macroIndustry: (board: MacroBoard) => Promise<MacroIndustryDetail | null>;
  /** Research loop: decision ledger + knowledge digest. */
  researchDecisions: () => Promise<ResearchDecision[]>;
  researchAddDecision: (input: {
    model: 'rotation' | 'industry';
    target: string;
    stance: 'overweight' | 'neutral' | 'underweight' | 'watch';
    thesis: string;
    sessionId?: string;
  }) => Promise<ResearchDecision>;
  researchAttribute: (
    id: string,
    outcome: 'hit' | 'partial' | 'miss',
    note: string,
  ) => Promise<ResearchDecision | null>;
  researchUpdateDecision: (
    id: string,
    patch: {
      target?: string;
      stance?: 'overweight' | 'neutral' | 'underweight' | 'watch';
      thesis?: string;
    },
  ) => Promise<ResearchDecision | null>;
  researchDeleteDecision: (id: string) => Promise<boolean>;
  researchExport: () => Promise<{ path: string; count: number } | null>;
  researchDigest: () => Promise<string | null>;
  /** Leadership report markdown; returns the workspace-relative path written. */
  macroExportReport: (markdown: string) => Promise<{ path: string } | null>;

  /** Background-generated reports: latest per theme + body reads. */
  macroReports: () => Promise<MacroReportMeta[]>;
  macroReportRead: (file: string) => Promise<{ file: string; markdown: string } | null>;
  /** Re-run a theme's background task; resolves immediately (fire and forget). */
  macroRegenerate: (
    themeId: MacroThemeId,
  ) => Promise<{ ok: true; taskId: string } | { ok: false; reason: string }>;
  onMacroReports: (callback: () => void) => () => void;

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
