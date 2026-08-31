// The transport-neutral agent runtime surface.
//
// The UI talks to this interface, never a concrete runtime (opencode,
// claude-code, ...) directly. OpenCodeClient already satisfies it structurally;
// a future ClaudeCodeAdapter implements the same surface over a CLI subprocess.
//
// Design rules:
// - Session-centric: every turn flows through a session id the runtime minted.
// - Event-driven: all runtime output arrives via onEvent() (SSE or stdio).
// - Directory-scoped: the runtime may serve many folders from one process;
//   workspace scoping is decided at construction (the `directory` option),
//   not per-call.

import type {
  AgentCommandInfo,
  AgentHistoryMessage,
  AgentInfo,
  AgentMcpServer,
  AgentProviderInfo,
  AgentRuntimeEvent,
  AgentSessionMeta,
  AgentSkillInfo,
  PermissionAskedEvent,
  PermissionMode,
  PermissionReply,
  RuntimeStatus,
} from './types';

type EventListener = (event: AgentRuntimeEvent) => void;
type StatusListener = (status: RuntimeStatus) => void;

export interface AgentRuntime {
  /** Current connection status. */
  getStatus(): RuntimeStatus;

  /** Open the event stream. Resolves once the runtime acknowledges. */
  connect(): Promise<void>;
  /** Close the event stream and release transport resources. */
  close(): void;

  /** Subscribe to normalized runtime events. Returns an unsubscribe fn. */
  onEvent(listener: EventListener): () => void;
  /** Subscribe to connection status changes. Returns an unsubscribe fn. */
  onStatus(listener: StatusListener): () => void;

  // ---- session lifecycle ----

  /** Create a new agent session, returning its id. */
  createSession(): Promise<string>;
  /** List existing sessions (conversation history), newest first. */
  listSessions(): Promise<AgentSessionMeta[]>;
  /** Delete a session. */
  deleteSession(sessionId: string): Promise<void>;
  /** Load a session's message history. */
  getMessages(sessionId: string): Promise<AgentHistoryMessage[]>;

  // ---- turn control ----

  /** Send a prompt into a session; output streams back via onEvent. */
  sendPrompt(sessionId: string, text: string): Promise<void>;
  /** Interrupt the session's current turn. A no-op on an idle session. */
  abortSession(sessionId: string): Promise<void>;
  /** Run a shell command directly in the session's workspace - no model turn. */
  runShell(sessionId: string, command: string, agent?: string): Promise<void>;
  /** Run a slash command (config command / skill / MCP prompt) in a session. */
  runCommand(sessionId: string, command: string, args?: string): Promise<void>;

  // ---- interactive requests (question / permission) ----
  // These may be session-scoped or directory-scoped depending on the runtime;
  // the `sessionId` argument is accepted for runtimes that need it and ignored
  // by runtimes that expose directory-global pending lists.

  /** Pending questions (recovery on open - an ask can predate connect). */
  listQuestions(sessionId?: string): Promise<AgentRuntimeEvent[]>;
  /** Answer a question: one array of selected option labels per question. */
  answerQuestion(requestId: string, answers: string[][]): Promise<void>;
  /** Reject/dismiss a question (the agent proceeds without an answer). */
  rejectQuestion(requestId: string): Promise<void>;

  /** Pending permission requests (recovery on open). */
  listPermissions(sessionId?: string): Promise<AgentRuntimeEvent[]>;
  /** Reply to a permission request: allow once, allow always, or reject. */
  replyPermission(requestId: string, reply: PermissionReply): Promise<void>;

  /** Set the permission mode preset (review / auto / yolo). */
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /** Read the current permission mode. */
  getPermissionMode(): Promise<PermissionMode>;

  // ---- catalog ----

  /** Skills loaded by the runtime (built-in + bundled + user). */
  listSkills(): Promise<AgentSkillInfo[]>;
  /** Agents configured in the runtime. */
  listAgents(): Promise<AgentInfo[]>;
  /** Slash commands the runtime can run ("/" palette). */
  listCommands(): Promise<AgentCommandInfo[]>;

  // ---- provider / model ----

  /** The configured default model ("provider/model"), or null when unset. */
  getDefaultModel(): Promise<string | null>;
  /** Set the default model in the runtime's global config. */
  setDefaultModel(model: string): Promise<void>;
  /** Providers the runtime can use right now, with their models. */
  listProviders(): Promise<AgentProviderInfo[]>;

  // ---- MCP ----

  /** Configured MCP servers with live status, joined with their config. */
  listMcpServers(): Promise<AgentMcpServer[]>;
  /** Enable or disable an MCP server. */
  toggleMcpServer(name: string, enabled: boolean): Promise<void>;
}

/** Convenience: extract the interactive-request events from a list. */
export function isQuestionAsked(
  e: AgentRuntimeEvent,
): e is Extract<AgentRuntimeEvent, { type: 'question.asked' }> {
  return e.type === 'question.asked';
}

export function isPermissionAsked(e: AgentRuntimeEvent): e is PermissionAskedEvent {
  return e.type === 'permission.asked';
}
