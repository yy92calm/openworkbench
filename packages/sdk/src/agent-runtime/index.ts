// Public surface of the agent-runtime abstraction.
//
// The UI depends on this module (not on OpenCodeClient directly) so a future
// ClaudeCodeAdapter can be swapped in without touching the UI.

export type { AgentRuntime } from './adapter';
export { type AgentRuntimeConfig, type AgentRuntimeKind, createAgentRuntime } from './factory';
export type {
  AgentCommandInfo,
  AgentHistoryMessage,
  AgentHistoryPart,
  AgentInfo,
  AgentMcpConfig,
  AgentMcpServer,
  AgentProviderInfo,
  AgentProviderModelInfo,
  AgentRuntimeEvent,
  AgentSessionMeta,
  AgentSkillInfo,
  PermissionAskedEvent,
  PermissionMode,
  PermissionReply,
  PermissionResolvedEvent,
  QuestionAskedEvent,
  QuestionItem,
  QuestionOption,
  QuestionResolvedEvent,
  ReasoningUpdatedEvent,
  RuntimeErrorEvent,
  RuntimeStatus,
  SessionIdleEvent,
  TextUpdatedEvent,
  ToolCallStatus,
  ToolUpdatedEvent,
} from './types';
