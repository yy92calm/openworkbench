// ClaudeCodeAdapter: an AgentRuntime backed by the Claude Agent SDK.
//
// Uses @anthropic-ai/claude-agent-sdk's `query()` async iterator to run turns.
// The SDK bundles a native Claude Code binary and manages the agent loop,
// tool execution, and session state (JSONL on disk) internally.
//
// Architecture:
// - Each session is an in-memory handle tracking one active query() iterator.
// - createSession() mints a UUID; the real Claude session is created on the
//   first sendPrompt() (the SDK's init event returns the canonical session_id).
// - sendPrompt() calls query({ prompt, options: { resume, cwd, ... } }) and
//   pumps the async iterator, forwarding extracted events to listeners.
// - abortSession() cancels the active iterator (the SDK supports AbortController).
// - Session resume: the SDK's `resume` option takes a session_id string and
//   replays that session's history before continuing.
//
// Permission handling:
// - Claude Code's permission model differs from OpenCode's: instead of
//   per-action prompts, you pre-configure allowedTools / permissionMode. The
//   AskUserQuestion tool is the closest analog to OpenCode's question.asked.
// - setPermissionMode maps: review -> "default", auto -> "acceptEdits",
//   yolo -> "bypassPermissions".
// - listQuestions/listPermissions return [] (Claude Code doesn't expose a
//   pending-requests REST list); AskUserQuestion events surface as they occur.
//
// Catalog methods:
// - listSkills/listCommands read from .claude/skills/ and .claude/commands/
//   (filesystem-based config). These return [] until that file-reading layer
//   is implemented; the adapter still functions for chat/tool turns.
//
// This module requires Node (the Agent SDK bundles a native binary). It MUST
// only be imported from the Electron main process, never the renderer. The
// factory uses a dynamic import() so this module (and its `node:` deps) never
// enters the renderer bundle.
//
// The SDK's own types (sdk.d.ts) are used directly; `query()` is the only
// surface we touch, via the dynamic import in loadSdk().

import type { AgentRuntime } from './adapter';
import { type ClaudeSdkMessage, extractEvents, extractSessionId } from './claude-event-extractor';
import type {
  AgentCommandInfo,
  AgentHistoryMessage,
  AgentInfo,
  AgentMcpServer,
  AgentProviderInfo,
  AgentRuntimeEvent,
  AgentSessionMeta,
  AgentSkillInfo,
  PermissionMode,
  PermissionReply,
  RuntimeStatus,
} from './types';

export interface ClaudeCodeAdapterOptions {
  /** Path to the claude CLI (reserved - the SDK bundles its own binary). */
  cliPath?: string;
  /** Working directory Claude operates in. */
  directory?: string;
  /** API key; falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Default model id (e.g. "claude-sonnet-4-5-20250929"). */
  model?: string;
}

/** Maps the app's permission presets to Claude Code permission modes. */
function claudePermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case 'review':
      return 'default';
    case 'auto':
      return 'acceptEdits';
    case 'yolo':
      return 'bypassPermissions';
  }
}

/** One active turn: the async iterator and its abort controller. */
interface ActiveTurn {
  iterator: AsyncIterable<ClaudeSdkMessage> | AsyncIterator<ClaudeSdkMessage>;
  abort: AbortController;
  /** The canonical session id from the SDK's init event (null until received). */
  sdkSessionId: string | null;
}

export class ClaudeCodeAdapter implements AgentRuntime {
  private status: RuntimeStatus = 'offline';
  private readonly eventListeners = new Set<(e: AgentRuntimeEvent) => void>();
  private readonly statusListeners = new Set<(s: RuntimeStatus) => void>();
  private readonly sessions = new Map<
    string,
    { sdkSessionId: string | null; title: string; history: AgentHistoryMessage[] }
  >();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private permissionMode: PermissionMode = 'auto';
  private readonly opts: ClaudeCodeAdapterOptions;

  constructor(opts: ClaudeCodeAdapterOptions = {}) {
    this.opts = opts;
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    // The Agent SDK manages its own connection (it bundles the binary). We
    // verify the SDK is importable and set status to ready. A real readiness
    // probe would call a lightweight SDK function; for now, import success is
    // sufficient since the SDK lazy-loads its binary on first query().
    try {
      await this.loadSdk();
      this.setStatus('ready');
    } catch (err) {
      this.setStatus('error');
      throw new Error(
        `Claude Agent SDK not available: ${err instanceof Error ? err.message : String(err)}. ` +
          'Install it with `npm install @anthropic-ai/claude-agent-sdk`.',
      );
    }
  }

  close(): void {
    // Abort every active turn.
    for (const turn of this.activeTurns.values()) {
      turn.abort.abort();
    }
    this.activeTurns.clear();
    this.setStatus('offline');
  }

  onEvent(l: (e: AgentRuntimeEvent) => void): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  onStatus(l: (s: RuntimeStatus) => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  // ---- session lifecycle ----

  async createSession(): Promise<string> {
    // Mint a local id; the canonical Claude session_id arrives on the first
    // turn's init event and is stored back here.
    const id = crypto.randomUUID();
    this.sessions.set(id, { sdkSessionId: null, title: 'New session', history: [] });
    return id;
  }

  async listSessions(): Promise<AgentSessionMeta[]> {
    // Claude Code stores session history as JSONL under
    // ~/.claude/projects/<encoded-cwd>/*. Reading those is a future
    // enhancement; for now return the in-memory sessions.
    return [...this.sessions.entries()].map(([id, s]) => ({
      id,
      title: s.title,
      directory: this.opts.directory,
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    // The SDK's on-disk JSONL is not deleted here; that's a future enhancement.
  }

  async getMessages(sessionId: string): Promise<AgentHistoryMessage[]> {
    const session = this.sessions.get(sessionId);
    return session ? session.history : [];
  }

  // ---- turn control ----

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    if (this.activeTurns.has(sessionId)) {
      throw new Error(`Session ${sessionId} already has a running turn`);
    }

    const sdk = await this.loadSdk();
    const abort = new AbortController();
    const queryOpts = this.buildQueryOptions(session.sdkSessionId, abort.signal);

    // The SDK's query() returns an async iterable of messages.
    const iterator = sdk.query({ prompt: text, options: queryOpts });
    this.activeTurns.set(sessionId, { iterator, abort, sdkSessionId: session.sdkSessionId });

    // Record the user message in our in-memory history.
    session.history.push({ role: 'user', parts: [{ type: 'text', text }] });

    // Pump the iterator on a microtask so sendPrompt resolves immediately
    // (the turn streams via onEvent, matching OpenCode's prompt_async contract).
    void this.pumpIterator(sessionId, iterator);

    // Update the session title from the first prompt (like OpenCode does).
    if (session.title === 'New session') {
      session.title = text.slice(0, 60) || 'Untitled';
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    const turn = this.activeTurns.get(sessionId);
    if (!turn) return;
    turn.abort.abort();
    this.activeTurns.delete(sessionId);
    this.emit({ type: 'session.idle', sessionId });
  }

  async runShell(sessionId: string, command: string, _agent?: string): Promise<void> {
    // Claude Code's Bash tool runs inside the agent loop, not as a standalone
    // shell. Route it as a prompt so the agent executes it.
    return this.sendPrompt(
      sessionId,
      `Run this shell command and show the output:\n\`\`\`bash\n${command}\n\`\`\``,
    );
  }

  async runCommand(sessionId: string, command: string, args?: string): Promise<void> {
    // Slash commands in Claude Code map to skills (.claude/skills/ or
    // .claude/commands/). Route as a prompt with the /name syntax.
    const full = args ? `/${command} ${args}` : `/${command}`;
    return this.sendPrompt(sessionId, full);
  }

  // ---- interactive requests ----

  async listQuestions(): Promise<AgentRuntimeEvent[]> {
    // Claude Code doesn't expose a pending-questions REST endpoint; the
    // AskUserQuestion tool surfaces as an event during a turn.
    return [];
  }

  async answerQuestion(_requestId: string, _answers: string[][]): Promise<void> {
    // AskUserQuestion answers are fed back via the SDK's input mechanism,
    // which requires the turn to still be active. Implementation deferred to
    // when the SDK's user-input API stabilizes.
    throw new Error('answerQuestion is not yet supported for Claude Code');
  }

  async rejectQuestion(_requestId: string): Promise<void> {
    throw new Error('rejectQuestion is not yet supported for Claude Code');
  }

  async listPermissions(): Promise<AgentRuntimeEvent[]> {
    return [];
  }

  async replyPermission(_requestId: string, _reply: PermissionReply): Promise<void> {
    // Claude Code's permission model is pre-configured (allowedTools), not
    // per-action. This is a no-op; the tool was already allowed or blocked.
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode;
  }

  async getPermissionMode(): Promise<PermissionMode> {
    return this.permissionMode;
  }

  // ---- catalog ----
  // These read from .claude/ filesystem config. Returning empty until the
  // file-reading layer is wired; the adapter still functions for chat turns.

  async listSkills(): Promise<AgentSkillInfo[]> {
    return [];
  }

  async listAgents(): Promise<AgentInfo[]> {
    return [{ name: 'claude', description: 'Claude Code default agent', mode: 'default' }];
  }

  async listCommands(): Promise<AgentCommandInfo[]> {
    return [];
  }

  // ---- provider / model ----

  async getDefaultModel(): Promise<string | null> {
    return this.opts.model ?? null;
  }

  async setDefaultModel(model: string): Promise<void> {
    this.opts.model = model;
  }

  async listProviders(): Promise<AgentProviderInfo[]> {
    return [
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: this.opts.model
          ? [{ id: this.opts.model, name: this.opts.model }]
          : [{ id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' }],
      },
    ];
  }

  // ---- MCP ----

  async listMcpServers(): Promise<AgentMcpServer[]> {
    return [];
  }

  async toggleMcpServer(_name: string, _enabled: boolean): Promise<void> {
    // MCP servers in Claude Code are configured via the SDK's mcpServers option
    // or .claude/settings.json. Toggling requires a config write (future).
  }

  // ---- internals ----

  /** Dynamically import the Agent SDK so it (and its node deps) never enters
   *  the renderer bundle. Throws if the package isn't installed. */
  private async loadSdk(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
    try {
      return await import('@anthropic-ai/claude-agent-sdk');
    } catch {
      throw new Error(
        '@anthropic-ai/claude-agent-sdk is not installed. ' +
          'Install it with `npm install @anthropic-ai/claude-agent-sdk` to use Claude Code.',
      );
    }
  }

  private buildQueryOptions(resumeId: string | null, signal: AbortSignal): Record<string, unknown> {
    const opts: Record<string, unknown> = {
      abortController: signal,
      permissionMode: claudePermissionMode(this.permissionMode),
    };
    if (this.opts.directory) opts.cwd = this.opts.directory;
    if (this.opts.model) opts.model = this.opts.model;
    if (resumeId) opts.resume = resumeId;
    return opts;
  }

  /** Pump the SDK's async iterator, forwarding events to listeners. */
  private async pumpIterator(
    sessionId: string,
    iterable: AsyncIterable<ClaudeSdkMessage>,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    const turn = this.activeTurns.get(sessionId);
    if (!session || !turn) return;

    const assistantParts: AgentHistoryMessage['parts'] = [];
    try {
      for await (const msg of iterable) {
        // Capture the canonical session id from the init event.
        const sid = extractSessionId(msg);
        if (sid && !session.sdkSessionId) {
          session.sdkSessionId = sid;
          turn.sdkSessionId = sid;
        }
        // Forward extracted events.
        for (const event of extractEvents(msg, sessionId)) {
          // Track assistant text for history.
          if (event.type === 'text.updated') {
            assistantParts.push({ type: 'text', text: event.text });
          }
          this.emit(event);
        }
      }
    } catch (err) {
      // An aborted turn throws; emit a clean idle so the UI unlocks.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('abort')) {
        this.emit({ type: 'error', sessionId, message: msg });
      }
    } finally {
      this.activeTurns.delete(sessionId);
      // Record assistant output in history (best-effort).
      if (assistantParts.length > 0) {
        session.history.push({ role: 'assistant', completed: Date.now(), parts: assistantParts });
      }
    }
  }

  private emit(event: AgentRuntimeEvent): void {
    this.eventListeners.forEach((l) => l(event));
  }

  private setStatus(status: RuntimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
}
