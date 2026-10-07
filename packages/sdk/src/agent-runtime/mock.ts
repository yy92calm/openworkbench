// Mock implementation of AgentRuntime for testing.
//
// Provides a controllable, in-memory runtime that emits configurable events.
// Tests can drive the mock without a real sidecar or CLI subprocess.

import type { AgentRuntime } from './adapter';
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

type EventListener = (event: AgentRuntimeEvent) => void;
type StatusListener = (status: RuntimeStatus) => void;

export interface MockRuntimeOptions {
  /** Initial status (defaults to 'offline'). */
  initialStatus?: RuntimeStatus;
  /** Pre-configured sessions to return from listSessions(). */
  sessions?: AgentSessionMeta[];
  /** Pre-configured messages per session ID. */
  messages?: Record<string, AgentHistoryMessage[]>;
  /** Pre-configured skills. */
  skills?: AgentSkillInfo[];
  /** Pre-configured agents. */
  agents?: AgentInfo[];
  /** Pre-configured commands. */
  commands?: AgentCommandInfo[];
  /** Pre-configured providers. */
  providers?: AgentProviderInfo[];
  /** Pre-configured MCP servers. */
  mcpServers?: AgentMcpServer[];
}

export class MockRuntime implements AgentRuntime {
  private status: RuntimeStatus;
  private readonly sessions: Map<string, AgentSessionMeta>;
  private readonly messages: Map<string, AgentHistoryMessage[]>;
  private readonly skills: AgentSkillInfo[];
  private readonly agents: AgentInfo[];
  private readonly commands: AgentCommandInfo[];
  private readonly providers: AgentProviderInfo[];
  private readonly mcpServers: Map<string, AgentMcpServer>;
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private defaultModel: string | null = null;
  private permissionMode: PermissionMode = 'review';
  private nextSessionId = 1;

  constructor(opts: MockRuntimeOptions = {}) {
    this.status = opts.initialStatus ?? 'offline';
    this.sessions = new Map(opts.sessions?.map((s) => [s.id, s]) ?? []);
    this.messages = new Map(Object.entries(opts.messages ?? {}));
    this.skills = opts.skills ?? [];
    this.agents = opts.agents ?? [];
    this.commands = opts.commands ?? [];
    this.providers = opts.providers ?? [];
    this.mcpServers = new Map(opts.mcpServers?.map((s) => [s.name, s]) ?? []);
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    this.setStatus('ready');
  }

  close(): void {
    this.setStatus('offline');
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async createSession(): Promise<string> {
    const id = `session-${this.nextSessionId++}`;
    const session: AgentSessionMeta = { id, title: 'New Session' };
    this.sessions.set(id, session);
    this.messages.set(id, []);
    return id;
  }

  async listSessions(): Promise<AgentSessionMeta[]> {
    return [...this.sessions.values()];
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
  }

  async getMessages(sessionId: string): Promise<AgentHistoryMessage[]> {
    return this.messages.get(sessionId) ?? [];
  }

  async sendPrompt(_sessionId: string, _text: string): Promise<void> {
    // No-op: tests can call emit() to simulate responses.
  }

  async abortSession(_sessionId: string): Promise<void> {
    // No-op.
  }

  async runShell(_sessionId: string, _command: string, _agent?: string): Promise<void> {
    // No-op.
  }

  async runCommand(_sessionId: string, _command: string, _args?: string): Promise<void> {
    // No-op.
  }

  async listQuestions(_sessionId?: string): Promise<AgentRuntimeEvent[]> {
    return [];
  }

  async answerQuestion(_requestId: string, _answers: string[][]): Promise<void> {
    // No-op.
  }

  async rejectQuestion(_requestId: string): Promise<void> {
    // No-op.
  }

  async listPermissions(_sessionId?: string): Promise<AgentRuntimeEvent[]> {
    return [];
  }

  async replyPermission(_requestId: string, _reply: PermissionReply): Promise<void> {
    // No-op.
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode;
  }

  async getPermissionMode(): Promise<PermissionMode> {
    return this.permissionMode;
  }

  async listSkills(): Promise<AgentSkillInfo[]> {
    return this.skills;
  }

  async listAgents(): Promise<AgentInfo[]> {
    return this.agents;
  }

  async listCommands(): Promise<AgentCommandInfo[]> {
    return this.commands;
  }

  async getDefaultModel(): Promise<string | null> {
    return this.defaultModel;
  }

  async setDefaultModel(model: string): Promise<void> {
    this.defaultModel = model;
  }

  async listProviders(): Promise<AgentProviderInfo[]> {
    return this.providers;
  }

  async listMcpServers(): Promise<AgentMcpServer[]> {
    return [...this.mcpServers.values()];
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    const server = this.mcpServers.get(name);
    if (server) {
      server.status = enabled ? 'connected' : 'disabled';
    }
  }

  // ---- Test helpers ----

  /** Emit an event to all listeners (simulates runtime output). */
  emit(event: AgentRuntimeEvent): void {
    this.eventListeners.forEach((l) => l(event));
  }

  /** Set status and notify listeners. */
  private setStatus(status: RuntimeStatus): void {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  /** Add a message to a session's history (for test setup). */
  addMessage(sessionId: string, message: AgentHistoryMessage): void {
    const messages = this.messages.get(sessionId) ?? [];
    messages.push(message);
    this.messages.set(sessionId, messages);
  }

  /** Add a session (for test setup). */
  addSession(session: AgentSessionMeta): void {
    this.sessions.set(session.id, session);
  }
}
