// Unified, agent-runtime-agnostic event and domain types.
//
// These mirror the normalized shapes already produced by OpenCodeClient's
// normalize() step (see ../types.ts). Defining them here lets the UI depend on
// a transport-neutral surface so a future ClaudeCodeAdapter can emit the same
// events without the UI knowing which runtime is behind it.

import type { RuntimeStatus, ToolCallStatus } from '@workbench/shared';

import type { SessionStatus } from '../types';

export type { RuntimeStatus, ToolCallStatus };
export type { SessionStatus };

// ---- Normalized events (runtime -> app) ----
// Each event is idempotent where possible: text/tool events carry a stable id
// and the app upserts by that id; only text/reasoning deltas are accumulative.

export interface TextUpdatedEvent {
  type: 'text.updated';
  sessionId: string;
  partId: string;
  text: string;
}

export interface ReasoningUpdatedEvent {
  type: 'reasoning.updated';
  sessionId: string;
  partId: string;
  text: string;
  /** True while the reasoning is still streaming (delta events still arriving). */
  streaming?: boolean;
}

export interface ToolUpdatedEvent {
  type: 'tool.updated';
  sessionId: string;
  callId: string;
  tool: string;
  status: ToolCallStatus;
  title?: string;
  /** Tool arguments (e.g. a write tool's `filePath` + `content`). */
  input?: Record<string, unknown>;
  /** Tool result text, when the tool returned one. */
  output?: string;
  /** A `task` tool's spawned subagent session - that session's interactive
   *  requests (question/permission) belong to THIS conversation. */
  childSessionId?: string;
}

export interface SessionIdleEvent {
  type: 'session.idle';
  sessionId: string;
}

/** Session metadata updated (tokens/cost changed mid-turn). */
export interface SessionUpdatedEvent {
  type: 'session.updated';
  sessionId: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

/** Session activity state changed (busy / idle / retry with a reason, e.g.
 *  a model quota error). Lets the UI surface why a turn is not producing
 *  text instead of staying silent. */
export interface SessionStatusEvent {
  type: 'session.status';
  sessionId: string;
  status: SessionStatus;
}

/** Context was compacted (old messages summarized/pruned). A cache-reset
 *  point — every subsequent turn starts a fresh prompt prefix. */
export interface SessionCompactedEvent {
  type: 'session.compacted';
  sessionId: string;
}

export interface RuntimeErrorEvent {
  type: 'error';
  sessionId?: string;
  message: string;
}

// ---- Interactive requests (the agent asks; the user must answer) ----
// The runtime blocks the run until answered. Two kinds: a `question` (pick
// from options) and a `permission` (approve a command / file write / etc.).

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  /** Allow selecting more than one option. */
  multiple?: boolean;
  /** Allow a free-text answer in addition to the options. */
  custom?: boolean;
}

export interface QuestionAskedEvent {
  type: 'question.asked';
  sessionId: string;
  requestId: string;
  questions: QuestionItem[];
}

/** A question was answered or rejected elsewhere - clear it from the UI. */
export interface QuestionResolvedEvent {
  type: 'question.resolved';
  sessionId: string;
  requestId: string;
}

export interface PermissionAskedEvent {
  type: 'permission.asked';
  sessionId: string;
  requestId: string;
  /** e.g. "bash", "write", "edit" - what the agent wants to do. */
  action: string;
  /** The concrete targets (a command line, file paths). */
  resources: string[];
}

export interface PermissionResolvedEvent {
  type: 'permission.resolved';
  sessionId: string;
  requestId: string;
}

export type AgentRuntimeEvent =
  | TextUpdatedEvent
  | ReasoningUpdatedEvent
  | ToolUpdatedEvent
  | SessionIdleEvent
  | SessionUpdatedEvent
  | SessionStatusEvent
  | SessionCompactedEvent
  | RuntimeErrorEvent
  | QuestionAskedEvent
  | QuestionResolvedEvent
  | PermissionAskedEvent
  | PermissionResolvedEvent;

/** Approve a permission once, always (persist a rule), or reject it. */
export type PermissionReply = 'once' | 'always' | 'reject';

/** Permission mode presets for the agent. */
export type PermissionMode = 'review' | 'auto' | 'yolo';

// ---- REST shapes the app consumes ----

export interface AgentSessionMeta {
  id: string;
  title: string;
  slug?: string;
  /** Workspace folder this session operates in (absolute path). */
  directory?: string;
  /** Set on subagent sessions: the session whose task tool spawned this one. */
  parentId?: string;
}

export interface AgentSkillInfo {
  name: string;
  description: string;
  location?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  mode?: string;
}

/** A slash command the runtime can run. GET /command merges every source:
 *  config commands, skills, and MCP prompts - one list for the composer's
 *  "/" palette. */
export interface AgentCommandInfo {
  name: string;
  description?: string;
  /** Where it came from, e.g. "command" | "skill" | "mcp". */
  source?: string;
  /** Agent the command pins, when it does. */
  agent?: string;
  /** The prompt text the command expands to. The runtime stores that EXPANSION
   *  as the user message in history - the template lets the app reverse-map
   *  it back to the "/name" the user actually typed. */
  template?: string;
}

/** A message loaded from history. */
export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  /** Epoch ms when the message finished - unset while it is still streaming.
   *  On the LAST message this is the server's truth for "is the turn over". */
  completed?: number;
  parts: AgentHistoryPart[];
}

export interface AgentHistoryPart {
  type: string;
  text?: string;
  /** True on runtime-generated text (e.g. the "tool was executed by the user"
   *  marker a "!" shell run leaves in history) - not something the user typed. */
  synthetic?: boolean;
  tool?: string;
  state?: {
    status?: string;
    title?: string;
    input?: Record<string, unknown>;
    output?: string;
  };
}

export interface AgentProviderModelInfo {
  id: string;
  name: string;
}

/** A provider the runtime can use right now (auth present or public). */
export interface AgentProviderInfo {
  id: string;
  name: string;
  models: AgentProviderModelInfo[];
}

export type AgentMcpConfig =
  | { type: 'local'; command: string[]; enabled?: boolean; environment?: Record<string, string> }
  | { type: 'remote'; url: string; enabled?: boolean; headers?: Record<string, string> };

export interface AgentMcpServer {
  name: string;
  /** e.g. "connected" | "failed" | "disabled" | "pending" */
  status: string;
  config?: AgentMcpConfig;
}
