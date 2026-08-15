import { create } from "zustand";
import {
  OpenCodeClient,
  DEFAULT_OPENCODE_URL,
  type AgentRuntime,
  type AgentRuntimeKind,
  type AgentInfo,
  type CommandInfo,
  type HistoryMessage,
  type McpServer,
  type OpenCodeEvent,
  type PermissionAskedEvent,
  type PermissionMode,
  type PermissionReply,
  type ProviderInfo,
  type QuestionAskedEvent,
  type SessionMeta,
  type SkillInfo,
  type ToolCallStatus,
} from "@workbench/sdk";
import type { ArtifactBlock, RuntimeStatus, ThreadBlock } from "@workbench/shared";
import {
  detectTools as probeTools,
  isTauri,
  logDebug,
  newDatedWorkspace,
  runtimePassword,
  setWorkspace,
  startRuntime,
  workspacePath,
  type ToolStatus,
} from "./tauri";
import { kernelReset } from "./kernel";
import { moveScrollMemory } from "./scrollMemory";
import { deriveArtifact } from "./artifacts";
import { provenanceInputFromEvent, recordProvenance } from "./provenance";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const URL_KEY = "workbench.opencodeUrl";
const HIDDEN_KEY = "workbench.hiddenExamples";

function initialUrl(): string {
  if (typeof window === "undefined") return "";
  // Bundled mode: always wait for bootstrap() to provide the dynamic port.
  // Don't fall back to DEFAULT_OPENCODE_URL — the sidecar uses a random port.
  if (isTauri) return "";
  return window.localStorage.getItem(URL_KEY) ?? DEFAULT_OPENCODE_URL;
}
function initialHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export interface Thread {
  blocks: ThreadBlock[];
  index: Record<string, number>;
  consecutiveTools: number;
  loaded: boolean;
}

/** What a session's right pane shows: an artifact inspector, the Files
 *  browser, browser, or nothing. The three are mutually exclusive. */
export interface PaneState {
  artifact: ArtifactBlock | null;
  showFiles: boolean;
  browserUrl: string;
  showTerminal: boolean;
  showFileBrowser: boolean;
}

interface RuntimeState {
  status: RuntimeStatus;
  serverUrl: string;
  sessions: SessionMeta[];
  currentId: string | null;
  threads: Record<string, Thread>;
  skills: SkillInfo[];
  agents: AgentInfo[];
  mcpServers: McpServer[];
  /** Slash commands the runtime can run ("/" palette): config commands,
   *  skills and MCP prompts, one merged list from GET /command. */
  commands: CommandInfo[];
  /** Configured default model ("provider/model"), or null when unset. */
  defaultModel: string | null;
  /** Available providers and their models. */
  providers: ProviderInfo[];
  tools: ToolStatus[];
  hiddenExamples: string[];
  error: string | null;
  /** Pending interactive requests the agent is blocked on, newest last. */
  questions: QuestionAskedEvent[];
  permissions: PermissionAskedEvent[];
  /** Subagent session → the session whose task tool spawned it, learned from
   *  task tool events (live) and the session list (recovery after reload). */
  sessionParents: Record<string, string>;
  /** Right-pane state per session (DRAFT_KEY for a draft) — each session keeps
   *  its own open artifact / Files browser and gets it back when reopened.
   *  In-memory only: an app restart returns every session to a closed pane. */
  panes: Record<string, PaneState>;
  /** Active permission mode preset. */
  permissionMode: PermissionMode;
  openArtifact: (a: ArtifactBlock) => void;
  closeArtifact: () => void;
  setShowFiles: (show: boolean) => void;
  setBrowserUrl: (url: string) => void;
  setShowTerminal: (show: boolean) => void;
  setShowFileBrowser: (show: boolean) => void;
  answerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
  replyPermission: (requestId: string, reply: PermissionReply) => Promise<void>;
  setPermissionMode: (mode: PermissionMode) => Promise<void>;
  setServerUrl: (url: string) => void;
  loadCatalog: () => Promise<void>;
  loadMcpServers: () => Promise<void>;
  toggleMcpServer: (name: string, enabled: boolean) => Promise<void>;
  loadProviders: () => Promise<void>;
  setDefaultModel: (model: string) => Promise<void>;
  detectTools: () => Promise<void>;
  connect: () => Promise<void>;
  connectRetry: (tries?: number) => Promise<void>;
  bootstrap: () => Promise<void>;
  disconnect: () => void;
  /** Restart the sidecar (picks up new provider config) and reconnect. */
  restart: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  startDraft: () => void;
  /** Active workspace folder (absolute path); null in the browser. */
  workspace: string | null;
  /** True when the user explicitly picked the active folder for the next new
   *  session; false means a new session gets its own fresh dated folder. */
  workspacePinned: boolean;
  /** A deliberate workspace move is in flight (event-stream reconnect into the
   *  new folder). The UI must not present it as a disconnection — no status
   *  flip, no Connect button, no help card. Real failures surface after the
   *  retry window is exhausted, once this clears. */
  switching: boolean;
  /** A sendPrompt is in flight (click → POST accepted). Locks the composer. */
  sending: boolean;
  /** Sessions with an active turn (send accepted, session.idle not yet seen).
   *  Drives the composer lock and the "Working…" indicator. */
  runningSessions: Record<string, true>;
  /** Sessions whose current turn is a user-typed "!" shell command. Their bash
   *  output shows inline in the thread — the output IS the result the user
   *  asked for. Agent bash steps stay quiet single-line log entries. */
  shellTurns: Record<string, true>;
  /** Switch to an existing folder, or (with `dated`) create a new dated one. */
  switchWorkspace: (target: { path: string } | { dated: string }) => Promise<void>;
  openSession: (id: string) => Promise<void>;
  sendPrompt: (text: string) => Promise<string | null>;
  /** Run a "!" shell command directly in the session's workspace folder —
   *  no model turn; the output folds into the thread as a bash tool row. */
  runShell: (command: string) => Promise<string | null>;
  /** Run a "/" slash command (config command / skill / MCP prompt). */
  runCommand: (name: string, args?: string) => Promise<string | null>;
  /** Interrupt the current session's running turn (Stop button / Esc). */
  interrupt: () => Promise<void>;
  /** Check every session holding a running lock against the server: if its
   *  turn is actually over (idle was missed — SSE reconnect windows, the
   *  directory-scoped event stream), reload the missed history and unlock. */
  reconcileRunning: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  hideExample: (id: string) => void;
}

let client: AgentRuntime | null = null;
const emptyThread = (): Thread => ({ blocks: [], index: {}, consecutiveTools: 0, loaded: false });
/** Threads key for the draft conversation — its blocks move to the real
 *  session id once the session exists, so the page never visibly resets. */
export const DRAFT_KEY = "draft";
/** One bounded retry for the first POSTs after a sidecar restart — the old
 *  connection occasionally dies mid-handshake ("Load failed"). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await sleep(600);
    return await fn();
  }
}
/** Tool calls already written to provenance — success events can repeat per callId. */
const recordedProvenance = new Set<string>();

/** Sessions the user just interrupted: the thread already shows "Interrupted",
 *  so the abort's own trailing events (an "aborted" error, session.idle) must
 *  not add a second line. Consumed by the idle event; a new turn clears it. */
const interruptedSessions = new Set<string>();

/** Server-side truth for "is this session's turn over": the last message is an
 *  assistant message that has finished streaming (time.completed set). A last
 *  USER message means a turn was accepted but not yet answered — still running. */
export function turnIsOver(messages: HistoryMessage[]): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.role === "assistant" && !!last.completed;
}

/** Last SSE arrival per session (monotonic sequence, not wall time). Lets a
 *  failed sync POST tell "the connection died but the turn is alive" (events
 *  kept arriving after the POST began) from "the send never took" — WKWebView
 *  kills any fetch at ~60 s, long before a long agent turn finishes. */
let sseSeq = 0;
const sseLast = new Map<string, number>();

/** Resolve a (possibly nested) subagent session to its top-level session —
 *  a subagent's question/permission belongs to the conversation the user sees. */
export function rootSessionOf(parents: Record<string, string>, sessionId: string): string {
  let cur = sessionId;
  for (let hop = 0; parents[cur] && hop < 10; hop++) cur = parents[cur];
  return cur;
}

/** True when two session metas are equivalent for the sidebar — the fields a
 *  list refresh would show. Token/cost deltas update via session.updated. */
function sessionsEqual(a: SessionMeta, b: SessionMeta): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.slug === b.slug &&
    a.directory === b.directory &&
    a.parentId === b.parentId &&
    a.promptTokens === b.promptTokens &&
    a.completionTokens === b.completionTokens &&
    a.reasoningTokens === b.reasoningTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens &&
    a.cost === b.cost &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt
  );
}

type StoreSet = {
  (partial: Partial<RuntimeState>): void;
  (fn: (s: RuntimeState) => Partial<RuntimeState>): void;
};
type StoreGet = () => RuntimeState;

/**
 * The one send lifecycle (new → input → send → response), shared by plain
 * prompts, "!" shell commands and "/" slash commands:
 *   1. `echo` lands in the thread IMMEDIATELY — on a draft under DRAFT_KEY,
 *      grafted onto the real session id later, so the page never resets.
 *   2. `sending` is true from click until the POST is accepted (locks the
 *      composer); the session sits in `runningSessions` while the turn runs.
 *   3. Failures land as a red status line inside the conversation.
 * `syncTurn` marks endpoints whose POST resolves only when the turn is OVER
 * (shell/command, unlike prompt_async) — their running lock is set BEFORE the
 * POST and cleared when it settles, because session.idle arrives before the
 * POST resolves and a lock set afterwards would never clear.
 * `shell` additionally marks the turn in `shellTurns` for its duration, so
 * the event fold shows the bash output inline.
 */
async function performTurn(
  set: StoreSet,
  get: StoreGet,
  echo: string,
  post: (sid: string) => Promise<void>,
  syncTurn: boolean,
  shell = false,
): Promise<string | null> {
  if (!client) {
    set({ error: "Not connected to the agent runtime." });
    return null;
  }
  if (get().sending) return null; // one send at a time
  const echoKey = get().currentId ?? DRAFT_KEY;
  const now = Date.now();
  set((s) => {
    const cur = s.threads[echoKey] ?? emptyThread();
    const newBlocks = [
      ...cur.blocks,
      { kind: "turn-divider" as const },
      { kind: "user" as const, text: echo, timestamp: now },
    ];
    return {
      sending: true,
      threads: {
        ...s.threads,
        [echoKey]: { ...cur, loaded: true, blocks: newBlocks },
      },
    };
  });
  try {
    let id = get().currentId;
    if (!id) {
      // Lazy-create the session on the first message (#3). Unless the user
      // pinned a folder via the workspace switcher, a new session gets its
      // own fresh dated folder (~/Documents/Workbench/<date-time>) first,
      // so its files never pile up in the bare base folder.
      if (isTauri && !get().workspacePinned) {
        set({ switching: true });
        try {
          await newDatedWorkspace(datedWorkspaceName());
          await kernelReset().catch(() => {});
          await get().connectRetry();
        } finally {
          set({ switching: false });
        }
        if (get().status !== "ready" || !client) {
          throw new Error("Runtime did not reconnect after creating the session folder.");
        }
      }
      id = await withRetry(() => client!.createSession());
      set((s) => {
        // Graft the draft conversation (and its pane) onto the real session id.
        const threads = { ...s.threads, [id!]: s.threads[DRAFT_KEY] ?? emptyThread() };
        delete threads[DRAFT_KEY];
        const panes = { ...s.panes };
        if (panes[DRAFT_KEY]) {
          panes[id!] = panes[DRAFT_KEY];
          delete panes[DRAFT_KEY];
        }
        return { currentId: id, threads, panes };
      });
      moveScrollMemory(`chat:${DRAFT_KEY}`, `chat:${id}`);
      void get().refreshSessions();
    }
    const sid = id;
    interruptedSessions.delete(sid); // a fresh turn folds its events normally
    void logDebug(`turn → ${sid}`);
    if (syncTurn) {
      set((s) => ({
        runningSessions: { ...s.runningSessions, [sid]: true },
        ...(shell ? { shellTurns: { ...s.shellTurns, [sid]: true as const } } : {}),
      }));
      const mark = sseSeq;
      try {
        await post(sid);
      } catch (err) {
        // The POST rejected — but shell/command POSTs are held open for the
        // WHOLE turn, and WKWebView kills any fetch at ~60 s. If SSE kept
        // streaming this session since the POST began, the turn is alive
        // server-side: keep the running lock (session.idle or a session error
        // will clear it) and don't report a failure that didn't happen.
        if ((sseLast.get(sid) ?? 0) > mark) {
          void logDebug(`turn POST dropped mid-turn, still running → ${sid}`);
          return sid;
        }
        // A genuinely failed POST produces no events — drop both flags here.
        // (On success the session.idle event clears the shell flag, never the
        // POST settling: SSE frames and the POST response race on separate
        // connections, and the bash-output event may land after the POST
        // resolves.)
        set((s) => {
          const runningSessions = { ...s.runningSessions };
          const shellTurns = { ...s.shellTurns };
          delete runningSessions[sid];
          delete shellTurns[sid];
          return { runningSessions, shellTurns };
        });
        throw err;
      }
      set((s) => {
        const runningSessions = { ...s.runningSessions };
        delete runningSessions[sid];
        return { runningSessions };
      });
    } else {
      await post(sid);
      set((s) => ({ runningSessions: { ...s.runningSessions, [sid]: true } }));
    }
    void logDebug("turn OK");
    return sid;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void logDebug(`turn FAILED: ${msg}`);
    // The failure belongs next to the message that caused it.
    const key = get().currentId ?? DRAFT_KEY;
    set((s) => {
      const cur = s.threads[key] ?? emptyThread();
      return {
        error: msg,
        threads: {
          ...s.threads,
          [key]: {
            ...cur,
            loaded: true,
            blocks: [...cur.blocks, { kind: "status-line", text: `Send failed: ${msg}`, tone: "error" }],
          },
        },
      };
    });
    return get().currentId;
  } finally {
    set({ sending: false });
  }
}

/** The live agent client (Settings talks to the runtime's config API directly). */
export function getClient(): AgentRuntime | null {
  return client;
}

/** System-prompt prefix injected into a config-conversation turn. It steers
 *  the agent to emit ONLY a structured `workbench:config-patch` fence and
 *  forbids file/bash/network actions. The UI never lets the agent write
 *  directly — every patch goes through the main-process validator first. */
export const CONFIG_PROMPT_PREFIX = `你正在帮助用户修改本应用的 OpenCode 配置。规则：
1. 只允许对 opencode.json 输出配置修改，且必须产出以下格式的 fenced code block（唯一允许的输出容器）：
   \`\`\`workbench:config-patch
   {"target":"opencode.json","patch":[ {"op":"replace","path":"/model","value":"<provider>/<model>"} ]}
   \`\`\`
2. patch 必须是 RFC 6902 操作。permission 只能收紧（allow->ask/deny），禁止放宽容限。
3. 禁止修改 /instructions。禁止任何文件写入、bash 执行、网络请求、MCP 操作。
4. 若用户的要求不在范围（模型、MCP 增删改启停、外观键）内，说明做不到并建议人工。
不要输出其他代码块或对 patch 之外的内容做操作。`;

/** Send a turn that translates natural-language config requests into a
 *  structured patch. Runs in the current session (shared history); the reply
 *  is expected to carry a `workbench:config-patch` fence the UI will extract
 *  and validate before it is ever written. Returns the session id or null. */
export function sendConfigPrompt(text: string): Promise<string | null> {
  return useRuntimeStore.getState().sendPrompt(`${CONFIG_PROMPT_PREFIX}\n\n${text}`);
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  status: "offline",
  serverUrl: initialUrl(),
  sessions: [],
  currentId: null,
  threads: {},
  skills: [],
  agents: [],
  mcpServers: [],
  commands: [],
  defaultModel: null,
  providers: [],
  tools: [],
  hiddenExamples: initialHidden(),
  error: null,
  questions: [],
  permissions: [],
  sessionParents: {},
  panes: {},
  workspace: null,
  workspacePinned: false,
  switching: false,
  sending: false,
  runningSessions: {},
  shellTurns: {},
  permissionMode: "auto",

  // All three write the CURRENT session's pane (DRAFT_KEY on a draft), keeping
  // the artifact inspector and the Files browser mutually exclusive.
  openArtifact: (artifact) =>
    set((s) => ({
      panes: { ...s.panes, [s.currentId ?? DRAFT_KEY]: { artifact, showFiles: false, browserUrl: "", showTerminal: false, showFileBrowser: false } },
    })),
  closeArtifact: () =>
    set((s) => {
      const key = s.currentId ?? DRAFT_KEY;
      const prev = s.panes[key] ?? { artifact: null, showFiles: false, browserUrl: "", showTerminal: false, showFileBrowser: false };
      return { panes: { ...s.panes, [key]: { ...prev, artifact: null, showFiles: true } } };
    }),
  setShowFiles: (show) =>
    set((s) => {
      const key = s.currentId ?? DRAFT_KEY;
      const prev = s.panes[key] ?? { artifact: null, showFiles: false, browserUrl: "", showTerminal: false, showFileBrowser: false };
      const artifact = show ? null : prev.artifact;
      return { panes: { ...s.panes, [key]: { ...prev, artifact, showFiles: show, browserUrl: show ? "" : prev.browserUrl, showTerminal: show ? false : prev.showTerminal, showFileBrowser: show ? false : prev.showFileBrowser } } };
    }),
  setBrowserUrl: (url) =>
    set((s) => {
      const key = s.currentId ?? DRAFT_KEY;
      const prev = s.panes[key] ?? { artifact: null, showFiles: false, browserUrl: "", showTerminal: false };
      return { panes: { ...s.panes, [key]: { ...prev, showFiles: false, artifact: null, showTerminal: false, browserUrl: url } } };
    }),
  setShowTerminal: (show) =>
    set((s) => {
      const key = s.currentId ?? DRAFT_KEY;
      const prev = s.panes[key] ?? { artifact: null, showFiles: false, browserUrl: "", showTerminal: false, showFileBrowser: false };
      return { panes: { ...s.panes, [key]: { ...prev, artifact: null, showFiles: false, browserUrl: "", showFileBrowser: false, showTerminal: show } } };
    }),
  setShowFileBrowser: (show) =>
    set((s) => {
      const key = s.currentId ?? DRAFT_KEY;
      const prev = s.panes[key] ?? { artifact: null, showFiles: false, browserUrl: "", showTerminal: false, showFileBrowser: false };
      return { panes: { ...s.panes, [key]: { ...prev, artifact: null, showFiles: false, browserUrl: "", showTerminal: false, showFileBrowser: show } } };
    }),

  answerQuestion: async (requestId, answers) => {
    const q = get().questions.find((x) => x.requestId === requestId);
    if (!q || !client) return;
    set((s) => ({ questions: s.questions.filter((x) => x.requestId !== requestId) }));
    try {
      await client.answerQuestion(requestId, answers);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  rejectQuestion: async (requestId) => {
    const q = get().questions.find((x) => x.requestId === requestId);
    if (!q || !client) return;
    set((s) => ({ questions: s.questions.filter((x) => x.requestId !== requestId) }));
    try {
      await client.rejectQuestion(requestId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  replyPermission: async (requestId, reply) => {
    const p = get().permissions.find((x) => x.requestId === requestId);
    if (!p || !client) return;
    // Identical pending asks (same session, action and resources — e.g. three
    // parallel reads into one folder) are ONE question to the user: answer
    // them all with one click instead of re-asking for each tool call.
    const sig = (x: PermissionAskedEvent) =>
      `${x.sessionId}|${x.action}|${x.resources.join("|")}`;
    const batch = get().permissions.filter((x) => sig(x) === sig(p));
    set((s) => ({ permissions: s.permissions.filter((x) => sig(x) !== sig(p)) }));
    try {
      await Promise.all(batch.map((x) => client!.replyPermission(x.requestId, reply)));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setPermissionMode: async (mode) => {
    if (!client) return;
    try {
      await client.setPermissionMode(mode);
      set({ permissionMode: mode });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setServerUrl: (serverUrl) => {
    if (typeof window !== "undefined") window.localStorage.setItem(URL_KEY, serverUrl);
    set({ serverUrl });
  },

  loadCatalog: async () => {
    if (!client) return;
    try {
      // Skills can be empty right after a sidecar boot (instances create
      // lazily per directory) — retry them in the background WITHOUT blocking
      // the agents/commands/defaultModel that render immediately.
      const [agents, defaultModel, commands] = await Promise.all([
        client.listAgents(),
        client.getDefaultModel().catch(() => null),
        client.listCommands().catch(() => []),
      ]);
      set({ agents, defaultModel, commands });
      void (async () => {
        let skills = await client.listSkills();
        for (let i = 0; skills.length === 0 && i < 4; i++) {
          await sleep(400);
          skills = await client.listSkills();
        }
        set({ skills });
      })();
      void get().loadMcpServers();
      void get().loadProviders();
    } catch {
      /* ignore transient failures */
    }
  },

  loadProviders: async () => {
    if (!client) return;
    try {
      const providers = await client.listProviders();
      set({ providers });
    } catch {
      /* ignore transient failures */
    }
  },

  loadMcpServers: async () => {
    if (!client) return;
    try {
      const mcpServers = await client.listMcpServers();
      set({ mcpServers });
    } catch {
      /* ignore transient failures */
    }
  },

  toggleMcpServer: async (name: string, enabled: boolean) => {
    if (!client) return;
    // Optimistic update: flip the local flag immediately so the UI reflects
    // the toggle without refetching the whole list (which unmounts cards).
    set((s) => ({
      mcpServers: s.mcpServers.map((m) =>
        m.name === name ? { ...m, config: { ...m.config, enabled } } : m,
      ),
    }));
    try {
      await client.toggleMcpServer(name, enabled);
    } catch {
      // Revert on failure.
      void get().loadMcpServers();
    }
  },

  setDefaultModel: async (model) => {
    if (!client) return;
    try {
      await client.setDefaultModel(model);
      set({ defaultModel: model });
    } catch {
      /* ignore transient failures */
    }
  },

  detectTools: async () => {
    try {
      set({ tools: await probeTools() });
    } catch {
      /* ignore */
    }
  },

  connect: async () => {
    get().disconnect();
    // Don't attempt connection if serverUrl is not yet set (bundled mode waits
    // for bootstrap() to provide the dynamic port).
    const url = get().serverUrl;
    if (!url) {
      set({ status: "offline" });
      return;
    }
    // Scope skill discovery to the sidecar's workspace (null in browser dev).
    const directory = await workspacePath();
    set({ workspace: directory });
    // The bundled sidecar requires per-run Basic auth; browser dev (no Tauri)
    // gets null and connects to a user-run passwordless server.
    const password = await runtimePassword();
    const c = new OpenCodeClient({
      baseUrl: url,
      directory: directory ?? undefined,
      password: password ?? undefined,
    });
    client = c;
    c.onStatus((status) => {
      void logDebug(`status → ${status}`);
      set({ status });
    });
    // Coalesce streaming text/reasoning updates: foldEvent upserts per partId
    // (idempotent full-text), so emitting only the newest value per animation
    // frame is exact — a fast token stream no longer re-renders the whole
    // thread on every token. Non-streaming events flush pending text first so
    // ordering holds (idle after the final token, tool rows after text, etc.).
    //
    // The flush is additionally gated to ~20 fps (50 ms): a 60 fps markdown
    // re-parse of a growing document saturates the main thread once the message
    // is long, which reads as jank. Text streaming is indistinguishable from
    // 60 fps at this cadence, while cutting the per-frame parse cost 3x.
    const streamPending = new Map<string, OpenCodeEvent>();
    let streamRaf: number | null = null;
    let lastStreamFlush = 0;
    const flushStream = () => {
      if (streamRaf !== null) {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(streamRaf);
        streamRaf = null;
      }
      if (streamPending.size === 0) return;
      const events = [...streamPending.values()];
      streamPending.clear();
      lastStreamFlush = Date.now();
      for (const e of events) applyEvent(e);
    };
    const scheduleStream = () => {
      if (streamRaf !== null) return;
      const run = () => {
        streamRaf = null;
        // Stay within the fps gate; a fast stream keeps re-scheduling until the
        // gate opens. The final token is never dropped: a non-streaming event
        // (session.idle, tool updates, …) calls flushStream() directly.
        if (Date.now() - lastStreamFlush < 50) {
          scheduleStream();
          return;
        }
        flushStream();
      };
      if (typeof requestAnimationFrame === "function") streamRaf = requestAnimationFrame(run);
      else setTimeout(run, 50); // node/jsdom fallback ≈ 20 fps
    };

    // Session token/cost updates land once per provider token; coalesce them
    // to one sidebar refresh per second instead of one per token.
    const sessionUpdatePending = new Map<string, SessionUpdatedEvent>();
    let sessionUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    const flushSessionUpdates = () => {
      sessionUpdateTimer = null;
      if (sessionUpdatePending.size === 0) return;
      const events = [...sessionUpdatePending.values()];
      sessionUpdatePending.clear();
      set((s) => ({
        sessions: s.sessions.map((m) => {
          const e = events.find((x) => x.sessionId === m.id);
          if (!e) return m;
          return {
            ...m,
            promptTokens: e.promptTokens ?? m.promptTokens,
            completionTokens: e.completionTokens ?? m.completionTokens,
            reasoningTokens: e.reasoningTokens ?? m.reasoningTokens,
            cacheReadTokens: e.cacheReadTokens ?? m.cacheReadTokens,
            cacheWriteTokens: e.cacheWriteTokens ?? m.cacheWriteTokens,
            cost: e.cost ?? m.cost,
          };
        }),
      }));
    };
    const enqueueSessionUpdate = (event: SessionUpdatedEvent) => {
      sessionUpdatePending.set(event.sessionId, event);
      if (sessionUpdateTimer === null) sessionUpdateTimer = setTimeout(flushSessionUpdates, 1000);
    };

    const applyEvent = (event: OpenCodeEvent) => {
      if (event.type === "error") {
        // A session-scoped error belongs IN the conversation (a red status
        // line where the user is looking), and it ends that session's turn so
        // the composer unlocks. Errors without a session keep the banner.
        const sid = event.sessionId;
        // After a user interrupt the abort's own "aborted" error is expected —
        // the thread already says "Interrupted"; don't add a second red line.
        if (sid && interruptedSessions.has(sid)) return;
        if (sid) {
          set((s) => {
            const cur = s.threads[sid] ?? emptyThread();
            const runningSessions = { ...s.runningSessions };
            delete runningSessions[sid];
            return {
              runningSessions,
              threads: {
                ...s.threads,
                [sid]: {
                  ...cur,
                  loaded: true,
                  blocks: [...cur.blocks, { kind: "status-line", text: event.message, tone: "error" }],
                },
              },
            };
          });
        } else {
          set({ error: event.message });
        }
        return;
      }
      if (event.type === "session.status" && event.status.type === "retry") {
        // The turn is stuck (e.g. model quota exhausted) — surface it in the
        // thread as a red status line and unlock the composer, instead of
        // showing "Working…" forever.
        const sid = event.sessionId;
        const st = event.status;
        const msg = `模型调用失败：${st.message ?? "请重试"}${st.next ? `（${new Date(st.next).toLocaleString()} 后可用）` : ""}`;
        set((s) => {
          const cur = s.threads[sid] ?? emptyThread();
          const runningSessions = { ...s.runningSessions };
          delete runningSessions[sid];
          return {
            runningSessions,
            threads: {
              ...s.threads,
              [sid]: { ...cur, loaded: true, blocks: [...cur.blocks, { kind: "status-line", text: msg, tone: "error" }] },
            },
          };
        });
        return;
      }
      // Interactive requests live outside the thread blocks (transient UI).
      switch (event.type) {
        case "question.asked":
          set((s) => ({
            questions: [...s.questions.filter((q) => q.requestId !== event.requestId), event],
          }));
          return;
        case "question.resolved":
          set((s) => ({ questions: s.questions.filter((q) => q.requestId !== event.requestId) }));
          return;
        case "permission.asked":
          set((s) => ({
            permissions: [
              ...s.permissions.filter((p) => p.requestId !== event.requestId),
              event,
            ],
          }));
          return;
        case "permission.resolved":
          set((s) => ({ permissions: s.permissions.filter((p) => p.requestId !== event.requestId) }));
          return;
        case "session.updated":
          // Real-time token/cost update from the server (fires mid-turn).
          set((s) => ({
            sessions: s.sessions.map((m) =>
              m.id === event.sessionId
                ? {
                    ...m,
                    promptTokens: event.promptTokens ?? m.promptTokens,
                    completionTokens: event.completionTokens ?? m.completionTokens,
                    reasoningTokens: event.reasoningTokens ?? m.reasoningTokens,
                    cacheReadTokens: event.cacheReadTokens ?? m.cacheReadTokens,
                    cacheWriteTokens: event.cacheWriteTokens ?? m.cacheWriteTokens,
                    cost: event.cost ?? m.cost,
                  }
                : m,
            ),
          }));
          return;
      }
      const sid = event.sessionId;
      if (!sid) return;
      // The idle after a user interrupt: the thread already ends with
      // "Interrupted" — consume the guard, keep the locks clear, skip the fold.
      if (event.type === "session.idle" && interruptedSessions.delete(sid)) {
        set((s) => {
          const runningSessions = { ...s.runningSessions };
          const shellTurns = { ...s.shellTurns };
          delete runningSessions[sid];
          delete shellTurns[sid];
          return { runningSessions, shellTurns };
        });
        void get().refreshSessions();
        return;
      }
      // A task tool names the subagent session it spawned — remember the
      // parent link so the child's permission/question asks surface in THIS
      // conversation, and refresh the list so the child's title is known.
      if (
        event.type === "tool.updated" &&
        event.childSessionId &&
        get().sessionParents[event.childSessionId] !== sid
      ) {
        const child = event.childSessionId;
        set((s) => ({ sessionParents: { ...s.sessionParents, [child]: sid } }));
        void get().refreshSessions();
      }
      set((s) => {
        const cur = s.threads[sid] ?? emptyThread();
        const folded = foldEvent(
          { blocks: cur.blocks, index: cur.index },
          event,
          { shellTurn: !!s.shellTurns[sid] },
        );
        // The turn is over — unlock the composer and drop the "Working…" row.
        // The shell flag clears HERE (not when the POST settles): within the
        // SSE stream the bash-output event always precedes session.idle.
        const runningSessions = { ...s.runningSessions };
        const shellTurns = { ...s.shellTurns };
        if (event.type === "session.idle") {
          delete runningSessions[sid];
          delete shellTurns[sid];
        }
        return {
          runningSessions,
          shellTurns,
          threads: { ...s.threads, [sid]: { ...cur, ...folded, loaded: true } },
        };
      });
      // A completed live write becomes a provenance version (once per call).
      if (event.type === "tool.updated" && !recordedProvenance.has(event.callId)) {
        const input = provenanceInputFromEvent(event);
        if (input) {
          recordedProvenance.add(event.callId);
          void recordProvenance(input, sid, get().defaultModel);
        }
      }
      if (event.type === "session.idle") void get().refreshSessions();
    };
    // Route every normalized event into the coalescing layers above. Streaming
    // text/reasoning updates ride the animation frame; token/cost heartbeats
    // ride a 1 Hz timer; everything else flushes pending text first so ordering
    // holds (idle after the final token, tool rows after text, etc.).
    c.onEvent((event) => {
      if ("sessionId" in event && event.sessionId) sseLast.set(event.sessionId, ++sseSeq);
      if (event.type === "text.updated" || event.type === "reasoning.updated") {
        streamPending.set(`${event.type}:${event.partId}`, event);
        scheduleStream();
        return;
      }
      if (event.type === "session.updated") {
        enqueueSessionUpdate(event);
        return;
      }
      if (streamPending.size > 0) flushStream();
      applyEvent(event);
    });
    try {
      void logDebug(`connect → ${get().serverUrl}`);
      await c.connect();
      void logDebug("connect OK");
      set({ error: null });
      await get().refreshSessions();
      // Catalog (skills/agents/commands) fills in behind the page — a session
      // switch must not wait on it to show the conversation.
      void get().loadCatalog();
      // Load the current permission mode from the server.
      client.getPermissionMode().then((mode) => set({ permissionMode: mode })).catch(() => {});
      // Every reconnect is a window where session.idle can have been missed
      // (the event stream is directory-scoped and torn down on purpose) —
      // check any session still holding a running lock against the server.
      void get().reconcileRunning();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void logDebug(`connect FAILED: ${msg}`);
      set({ error: msg, status: "error" });
    }
  },

  // First boot can be slow far beyond the process spawn: on a fresh install
  // macOS TCC ("access Documents") blocks the sidecar until the user answers,
  // so the window must cover minutes, not seconds — giving up early strands
  // the user on an error screen that a single manual Connect would fix.
  // Failed attempts are masked (status AND error): workspace switches
  // reconnect the event stream on purpose, and flashing "could not open the
  // event stream" at the user mid-switch reads as breakage. The last error is
  // surfaced only if the whole retry window is exhausted.
  connectRetry: async (tries = 120) => {
    set({ status: "connecting" });
    let lastError: string | null = null;
    for (let i = 0; i < tries; i++) {
      await get().connect();
      if (get().status === "ready") return;
      lastError = get().error ?? lastError;
      set({ status: "connecting", error: null });
      // Quick retries first — the server is usually up within a second (a
      // reconnect finds it already listening); back off to 1 s for the long
      // tail (first boot blocked on macOS TCC can take minutes).
      await sleep(i < 8 ? 250 : 1000);
    }
    set({ status: "error", error: lastError });
  },

  bootstrap: async () => {
    void get().detectTools();
    // Load the profile-declared interaction config (renderers + UI defaults).
    // Left floating so the runtime start is never blocked on it.
    void import("./store").then(({ initInteraction }) => initInteraction());
    if (!isTauri) return;
    // Read the user's runtime engine choice from the UI store.
    const { useUiStore } = await import("./store");
    const kind: AgentRuntimeKind = useUiStore.getState().agentRuntimeKind;
    console.error(`[bootstrap] starting bundled runtime (${kind})`);
    void logDebug(`bootstrap: starting bundled runtime (${kind})`);
    try {
      const url = await startRuntime(kind);
      console.error(`[bootstrap] runtime url = ${url}`);
      void logDebug(`bootstrap: runtime at ${url}`);
      if (url) {
        // Persist the dynamic port so it's available immediately on next restart.
        // (The port changes each run, but this avoids any race where code tries
        // to connect before bootstrap() completes.)
        if (typeof window !== "undefined") window.localStorage.setItem(URL_KEY, url);
        set({ serverUrl: url });
      } else if (kind === "claude-code") {
        // Claude Code has no HTTP sidecar; the adapter runs in-process via the
        // Agent SDK (main process). Set a sentinel so connect() knows to use
        // the claude-code path instead of HTTP.
        set({ serverUrl: "", status: "offline" });
        void logDebug("bootstrap: claude-code mode (no sidecar URL)");
        // TODO: start claude-bridge HTTP server in main process and connect
        // to it transparently. For now, show an informational message.
        set({ error: "Claude Code runtime selected. Connect manually after configuring ANTHROPIC_API_KEY." });
        return;
      } else {
        console.error("[bootstrap] startRuntime returned null");
        set({ error: "Failed to start the agent runtime." });
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bootstrap] FAILED: ${msg}`);
      void logDebug(`bootstrap FAILED: ${msg}`);
      set({ error: msg });
      return;
    }
    await get().connectRetry();
  },

  disconnect: () => {
    client?.close();
    client = null;
    set({ status: "offline" });
  },

  restart: async () => {
    get().disconnect();
    set({ status: "connecting", error: null });
    try {
      const { restartRuntime } = await import("./tauri");
      const { useUiStore } = await import("./store");
      const kind: AgentRuntimeKind = useUiStore.getState().agentRuntimeKind;
      const url = await restartRuntime(kind);
      if (url) {
        if (typeof window !== "undefined") window.localStorage.setItem(URL_KEY, url);
        set({ serverUrl: url });
        await get().connectRetry();
      } else {
        set({ status: "error", error: "Failed to restart runtime." });
      }
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },

  refreshSessions: async () => {
    if (!client) return;
    try {
      const sessions = await client.listSessions();
      set((s) => {
        // Shallow-compare against the current list: skip the set when nothing
        // changed so the sidebar (and every SessionRow) isn't re-rendered on
        // each refresh. Token/cost deltas arrive via session.updated instead.
        const cur = s.sessions;
        const unchanged =
          cur.length === sessions.length &&
          cur.every((m, i) => sessionsEqual(m, sessions[i]));
        if (unchanged) return {};
        // The list also names each subagent session's parent — the recovery
        // path for parent links after a reload (no live task event to learn from).
        const sessionParents = { ...s.sessionParents };
        for (const m of sessions) if (m.parentId) sessionParents[m.id] = m.parentId;
        return { sessions, sessionParents };
      });
    } catch {
      /* ignore transient list failures */
    }
  },

  // "New" opens a blank draft — no session is created until the first message (#3).
  // A fresh draft also drops any pinned folder: back to the dated-folder default.
  startDraft: () =>
    set((s) => {
      const threads = { ...s.threads };
      delete threads[DRAFT_KEY]; // leftovers from an aborted first message
      const panes = { ...s.panes };
      delete panes[DRAFT_KEY]; // a fresh draft starts with a closed pane
      return { currentId: null, workspacePinned: false, threads, panes };
    }),

  switchWorkspace: async (target) => {
    set({ switching: true });
    try {
      if ("dated" in target) await newDatedWorkspace(target.dated);
      else await setWorkspace(target.path);
      // Reset the local kernel so it respawns in the new folder, then reconnect
      // the event stream scoped to it (connect() re-reads the active folder —
      // the sidecar itself keeps running). An explicit switch pins the folder,
      // so the next new session lands exactly there.
      await kernelReset().catch(() => {});
      set((s) => {
        // Back to a draft in the new folder — the draft pane must not carry
        // files from the previous folder. Session panes keep their memory.
        const panes = { ...s.panes };
        delete panes[DRAFT_KEY];
        return { currentId: null, panes, workspacePinned: true };
      });
      await get().connectRetry();
      await Promise.all([get().refreshSessions(), get().loadCatalog()]);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ switching: false });
    }
  },

  openSession: async (id) => {
    set({ currentId: id });
    if (!client) return;
    // Follow the session into its own workspace folder: record it as active and
    // reconnect the event stream scoped to it, so the agent, kernel and Files
    // all operate where the session's files live. Sessions with no recorded
    // folder, or that already match the active folder, skip this.
    const dir = get().sessions.find((s) => s.id === id)?.directory;
    if (dir && dir !== get().workspace) {
      set({ switching: true });
      try {
        await setWorkspace(dir).catch(() => {});
        await kernelReset().catch(() => {});
        await get().connectRetry();
      } finally {
        set({ switching: false });
      }
    }
    if (!client) return;
    // Recover any request the agent is blocked on (asked before connect/reload).
    void (async () => {
      try {
        const [qs, ps] = await Promise.all([
          client!.listQuestions(id),
          client!.listPermissions(id),
        ]);
        // Both lists are workspace-scoped (they include subagent sessions'
        // asks) — replace by requestId so live SSE copies don't duplicate.
        set((s) => {
          const qIds = new Set(qs.map((q) => q.requestId));
          const pIds = new Set(ps.map((p) => p.requestId));
          return {
            questions: [...s.questions.filter((q) => !qIds.has(q.requestId)), ...qs],
            permissions: [...s.permissions.filter((p) => !pIds.has(p.requestId)), ...ps],
          };
        });
      } catch {
        /* pending-request recovery is best-effort */
      }
    })();
    // A session reopened while "Working…" may have finished behind our back.
    void get().reconcileRunning();
    if (get().threads[id]?.loaded) return;
    try {
      const messages = await client.getMessages(id);
      set((s) => ({
        threads: {
          ...s.threads,
          [id]: { ...historyToThread(messages, s.commands), loaded: true },
        },
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  // The send lifecycle (new → input → send → response) is shared by plain
  // prompts, "!" shell commands and "/" slash commands — see performTurn.
  sendPrompt: (text) => {
    const browserUrl = get().panes[get().currentId ?? DRAFT_KEY]?.browserUrl ?? "";
    const enriched = browserUrl
      ? `[当前浏览器页面: ${browserUrl}]\n\n${text}`
      : text;
    return performTurn(set, get, enriched, (sid) => withRetry(() => client!.sendPrompt(sid, enriched)), false);
  },

  // No retry for shell/command: re-POSTing would run the command twice.
  runShell: (command) => {
    const agent = get().agents.find((a) => a.mode === "primary")?.name ?? "build";
    return performTurn(
      set,
      get,
      `! ${command}`,
      (sid) => client!.runShell(sid, command, agent),
      true,
      true,
    );
  },

  runCommand: (name, args) =>
    performTurn(
      set,
      get,
      args ? `/${name} ${args}` : `/${name}`,
      (sid) => client!.runCommand(sid, name, args),
      true,
    ),

  interrupt: async () => {
    const sid = get().currentId;
    if (!sid || !client || !get().runningSessions[sid]) return;
    try {
      await client.abortSession(sid);
    } catch {
      // The abort POST failing usually means the turn is already dead —
      // fall through: unlock locally either way so the user is never stuck.
    }
    interruptedSessions.add(sid);
    set((s) => {
      const runningSessions = { ...s.runningSessions };
      const shellTurns = { ...s.shellTurns };
      delete runningSessions[sid];
      delete shellTurns[sid];
      const cur = s.threads[sid] ?? emptyThread();
      return {
        runningSessions,
        shellTurns,
        threads: {
          ...s.threads,
          [sid]: {
            ...cur,
            loaded: true,
            blocks: [...cur.blocks, { kind: "status-line", text: "Interrupted", tone: "error" }],
          },
        },
      };
    });
  },

  reconcileRunning: async () => {
    const c = client;
    const running = Object.keys(get().runningSessions);
    if (!c || running.length === 0) return;
    for (const sid of running) {
      try {
        const messages = await c.getMessages(sid);
        // Still ours to answer for? The lock may have cleared while we fetched.
        if (!turnIsOver(messages) || !get().runningSessions[sid]) continue;
        void logDebug(`reconcile: missed idle for ${sid} — unlocking`);
        set((s) => {
          const runningSessions = { ...s.runningSessions };
          const shellTurns = { ...s.shellTurns };
          delete runningSessions[sid];
          delete shellTurns[sid];
          return {
            runningSessions,
            shellTurns,
            // The idle was missed, so the tail of the turn was too — replace
            // the thread with the full history rather than leave it stale.
            threads: {
              ...s.threads,
              [sid]: { ...historyToThread(messages, s.commands), loaded: true },
            },
          };
        });
      } catch {
        /* best-effort — the next reconnect or poll tries again */
      }
    }
  },

  deleteSession: async (id) => {
    if (client) {
      try {
        await client.deleteSession(id);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    }
    set((s) => {
      const threads = { ...s.threads };
      delete threads[id];
      const runningSessions = { ...s.runningSessions };
      delete runningSessions[id];
      const panes = { ...s.panes };
      delete panes[id];
      return {
        sessions: s.sessions.filter((x) => x.id !== id),
        threads,
        runningSessions,
        panes,
        currentId: s.currentId === id ? null : s.currentId,
      };
    });
  },

  hideExample: (id) => {
    const next = Array.from(new Set([...get().hiddenExamples, id]));
    if (typeof window !== "undefined") window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    set({ hiddenExamples: next });
  },
}));

/** Dated folder name like `2026-07-04-1615` for a fresh per-session workspace. */
export function datedWorkspaceName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

export interface FoldState {
  blocks: ThreadBlock[];
  index: Record<string, number>;
  consecutiveTools: number;
}

/** Pure reducer: fold one normalized OpenCode event into a thread's blocks. */

function extractInputSummary(tool: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  if (tool === "bash" || tool === "shell") {
    const cmd = typeof input.command === "string" ? input.command : "";
    return cmd ? `$ ${cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd}` : undefined;
  }
  if (tool === "write" || tool === "edit" || tool === "read") {
    const fp = typeof input.filePath === "string" ? input.filePath : "";
    return fp || undefined;
  }
  if (tool === "task") {
    const desc = typeof input.description === "string" ? input.description : "";
    const subagent = typeof input.subagent_type === "string" ? input.subagent_type : "";
    return desc ? `${subagent}: ${desc.length > 60 ? desc.slice(0, 57) + "..." : desc}` : undefined;
  }
  return undefined;
}

function extractOutputSummary(tool: string, output?: string, input?: Record<string, unknown>): string | undefined {
  if (!output) return undefined;
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  if (tool === "write" || tool === "edit") {
    const lines = trimmed.split("\n").length;
    const content = typeof input?.content === "string" ? input.content : "";
    const contentLines = content ? content.split("\n").length : lines;
    return `${contentLines} 行写入`;
  }
  if (tool === "read") {
    const lines = trimmed.split("\n").length;
    return `${lines} 行读取`;
  }
  if (tool === "bash" || tool === "shell") {
    const firstLine = trimmed.split("\n")[0];
    return firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine;
  }
  if (tool === "task") {
    return trimmed.length > 80 ? trimmed.slice(0, 77) + "..." : trimmed;
  }
  const firstLine = trimmed.split("\n")[0];
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
}

function extractMeta(tool: string, output?: string, input?: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (tool === "write" || tool === "edit") {
    const content = typeof input?.content === "string" ? input.content : (output ?? "");
    const bytes = new Blob([content]).size;
    if (bytes >= 1024) parts.push(`${(bytes / 1024).toFixed(0)}KB`);
    else parts.push(`${bytes}B`);
  }
  if (tool === "bash" || tool === "shell" || tool === "read") {
    if (output) {
      const lines = output.split("\n").length;
      parts.push(`${lines} 行`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function errorSummary(output?: string): string | undefined {
  if (!output) return undefined;
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  const firstLine = trimmed.split("\n")[0];
  return firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine;
}
/**
 * Tidy a tool-call title for the conversation: show workspace files by their
 * relative path (`demo/analyze.py`), not the full `/Users/.../Workbench/...`
 * absolute path, so the thread reads like a narrative, not a shell trace.
 * The workspace path never contains spaces (by design), so a space-free run
 * ending in `Workbench/` matches it whether or not it has a leading slash
 * (OpenCode's write-tool titles drop it).
 */
export function tidyToolTitle(title: string): string {
  return title.replace(/[^\s]*Workbench\//g, "").trim() || title;
}

export function foldEvent(
  state: FoldState,
  event: OpenCodeEvent,
  opts?: { shellTurn?: boolean },
): FoldState {
  const blocks = [...state.blocks];
  const index = { ...state.index };
  switch (event.type) {
    case "text.updated": {
      const key = `text:${event.partId}`;
      if (key in index) blocks[index[key]] = { kind: "agent", markdown: event.text };
      else {
        blocks.push({ kind: "agent", markdown: event.text });
        index[key] = blocks.length - 1;
      }
      return { blocks, index, consecutiveTools: 0 };
    }
    case "reasoning.updated": {
      const key = `reasoning:${event.partId}`;
      if (key in index) {
        blocks[index[key]] = { kind: "reasoning", text: event.text, streaming: event.streaming };
      } else {
        blocks.push({ kind: "reasoning", text: event.text, streaming: event.streaming });
        index[key] = blocks.length - 1;
      }
      return { blocks, index, consecutiveTools: state.consecutiveTools };
    }
    case "tool.updated": {
      // The interactive `question`/`permission` tools render as their own
      // answerable card (InteractionPrompt), not as a blank thread row. `todo*`
      // tools only report an opaque "N todos" count with no useful content —
      // pure noise in the conversation, so drop them.
      if (/question|permission|^ask$|todo/i.test(event.tool)) return { ...state };
      const key = `tool:${event.callId}`;
      // Completed MCP tools (and the shell endpoint) report title as "" — and
      // file tools (write/edit/read) only get a title on completion. Fall back
      // to the bash command line, then the file path from the tool's input,
      // then the tool name; never render a blank row.
      const command = typeof event.input?.command === "string" ? event.input.command : "";
      const filePath = typeof event.input?.filePath === "string" ? event.input.filePath : "";
      // A task tool names its subagent session once — later updates may omit
      // it, so carry the link over from the previous version of the block.
      const prev = key in index ? blocks[index[key]] : undefined;
      const childSessionId =
        event.childSessionId ??
        (prev?.kind === "tool-call" ? prev.childSessionId : undefined);
      const isFailed = event.status === "error" || event.status === "failed";
      const isShell = event.tool === "bash" || event.tool === "shell";
      const block: ThreadBlock = {
        kind: "tool-call",
        title: tidyToolTitle(event.title?.trim() || command || filePath || event.tool || "tool"),
        status: event.status,
        meta: extractMeta(event.tool, event.output, event.input),
        inputSummary: extractInputSummary(event.tool, event.input),
        outputSummary: isFailed
          ? errorSummary(event.output)
          : opts?.shellTurn && isShell
            ? event.output?.replace(/\s+$/, "")
            : extractOutputSummary(event.tool, event.output, event.input),
        ...(childSessionId ? { childSessionId } : {}),
        ...(isShell && command ? { shellCommand: command } : {}),
      };
      if (key in index) {
        blocks[index[key]] = block;
      } else {
        blocks.push(block);
        index[key] = blocks.length - 1;
      }
      // Surface a file the agent wrote as a traceable artifact (deduped by path).
      const artifact = deriveArtifact(event);
      if (artifact) {
        const akey = `artifact:${artifact.path}`;
        if (akey in index) blocks[index[akey]] = artifact;
        else {
          blocks.push(artifact);
          index[akey] = blocks.length - 1;
        }
      }
      return { blocks, index, consecutiveTools: 0 };
    }
    case "session.idle":
      blocks.push({ kind: "status-line", text: "done", tone: "done" });
      return { blocks, index, consecutiveTools: 0 };
    case "session.compacted":
      // Context was summarized/pruned — a cache-reset point. Mark it inline so
      // the user can see when automatic compaction happened (cache-reads that
      // follow will be near zero until the new prefix rebuilds).
      blocks.push({ kind: "status-line", text: "上下文已压缩（cache 已重置）", tone: "done" });
      return { blocks, index, consecutiveTools: 0 };
    default:
      return state;
  }
}

/**
 * One-line live activity of a subagent, derived from its folded thread:
 * the latest tool step's title, "Writing…" while it streams text, and
 * "Working…" before anything is known (e.g. right after an app reload).
 */
export function subagentActivity(blocks?: ThreadBlock[]): string {
  for (let i = (blocks?.length ?? 0) - 1; i >= 0; i--) {
    const b = blocks![i];
    if (b.kind === "tool-call") return b.title;
    if (b.kind === "agent") return "Writing…";
  }
  return "Working…";
}

function mapToolStatus(status?: string): ToolCallStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "error":
      return "failed";
    default:
      return "pending";
  }
}

/** Convert loaded message history into thread blocks. */
export function historyToThread(messages: HistoryMessage[], commands?: CommandInfo[]): FoldState {
  const blocks: ThreadBlock[] = [];
  // OpenCode stores a slash command's EXPANDED template as the user message,
  // with any typed arguments appended after it (no marker) — show the
  // "/name args" the user actually typed instead. Longest template first, so
  // one template being a prefix of another's expansion can't mis-attribute.
  const templates = (commands ?? [])
    .filter((c) => c.template?.trim())
    .map((c) => ({ name: c.name, template: c.template!.trim() }))
    .sort((a, b) => b.template.length - a.template.length);
  const asTypedCommand = (text: string): string | undefined => {
    const hit = templates.find((t) => text.startsWith(t.template));
    if (!hit) return undefined;
    const args = text.slice(hit.template.length).trim();
    return args ? `/${hit.name} ${args}` : `/${hit.name}`;
  };
  // A step frozen mid-run (the runtime restarted or the turn was killed before
  // it finished) must not spin forever in history — render it quietly and say
  // once, at the end, that the turn was interrupted.
  let interrupted = false;
  // A user-typed "!" command is recorded as a synthetic user text plus a bash
  // tool part on the next assistant message. Render it like the live path:
  // the "! cmd" echo and the output inline — never the synthetic marker text.
  let shellTurn = false;
  for (const m of messages) {
    if (m.role === "user") {
      shellTurn = m.parts.some((p) => p.type === "text" && p.synthetic);
      if (shellTurn) continue;
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      const command = asTypedCommand(text);
      const ts = m.completed;
      // A message sent from the remote relay client carries
      // metadata.source === "remote" on its text part — surface it so the
      // desktop thread shows where the message came from.
      const remote = m.parts.some((p) => p.type === "text" && (p as { metadata?: Record<string, unknown> }).metadata?.source === "remote");
      blocks.push({ kind: "turn-divider" });
      if (command) blocks.push({ kind: "user", text: command, ...(ts ? { timestamp: ts } : {}), ...(remote ? { remote: true } : {}) });
      else if (text) blocks.push({ kind: "user", text, ...(ts ? { timestamp: ts } : {}), ...(remote ? { remote: true } : {}) });
    } else {
      for (const p of m.parts) {
        if (p.type === "text" && p.text?.trim()) {
          blocks.push({ kind: "agent", markdown: p.text, ...(m.completed ? { timestamp: m.completed } : {}) });
        }
        else if (p.type === "reasoning" && p.text?.trim()) {
          blocks.push({ kind: "reasoning", text: p.text, streaming: false });
        }
        else if (p.type === "tool") {
          // Interactive tools are surfaced by InteractionPrompt, not the thread;
          // `todo*` tools are opaque "N todos" noise — skip both.
          if (/question|permission|^ask$|todo/i.test(p.tool ?? "")) continue;
          const status = mapToolStatus(p.state?.status);
          const frozen = status === "running" || status === "pending";
          if (frozen) interrupted = true;
          const command =
            typeof p.state?.input?.command === "string" ? p.state.input.command : "";
          const filePath =
            typeof p.state?.input?.filePath === "string" ? p.state.input.filePath : "";
          const userShell = shellTurn && p.tool === "bash";
          const isShell = p.tool === "bash" || p.tool === "shell";
          if (userShell) blocks.push({ kind: "user", text: `! ${command}` });
          const toolInput = userShell ? undefined : extractInputSummary(p.tool ?? "", p.state?.input);
          const toolOutput = userShell && p.state?.output?.trim()
            ? p.state.output.replace(/\s+$/, "")
            : extractOutputSummary(p.tool ?? "", p.state?.output, p.state?.input);
          blocks.push({
            kind: "tool-call",
            title: tidyToolTitle(p.state?.title?.trim() || command || filePath || p.tool || "tool"),
            status: frozen ? "pending" : status,
            ...(toolInput ? { inputSummary: toolInput } : {}),
            ...(toolOutput ? { outputSummary: toolOutput } : {}),
            ...(isShell && command ? { shellCommand: command } : {}),
          });
          const artifact = deriveArtifact({
            type: "tool.updated",
            sessionId: "",
            callId: "",
            tool: p.tool ?? "",
            status,
            input: p.state?.input,
            output: p.state?.output,
          });
          if (artifact) blocks.push(artifact);
        }
      }
      shellTurn = false;
    }
  }
  if (interrupted) {
    blocks.push({
      kind: "status-line",
      text: "Interrupted — this turn did not finish. Send a new message to continue.",
      tone: "error",
    });
  }
  return { blocks, index: {}, consecutiveTools: 0 };
}
