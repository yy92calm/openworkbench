export { OpenCodeClient } from './OpenCodeClient';
export {
  type AgentInfo,
  type AuthPrompt,
  type CommandInfo,
  DEFAULT_OPENCODE_URL,
  type HistoryMessage,
  type McpConfig,
  type McpServer,
  type OAuthAuthorization,
  OPENCODE_VERSION,
  type OpenCodeClientOptions,
  type OpenCodeEvent,
  type PermissionAskedEvent,
  type PermissionReply,
  type PermissionResolvedEvent,
  type ProviderAuthMethod,
  type ProviderCatalogEntry,
  type ProviderInfo,
  type ProviderModelInfo,
  type QuestionAskedEvent,
  type QuestionItem,
  type QuestionOption,
  type QuestionResolvedEvent,
  type RuntimeErrorEvent,
  type RuntimeStatus,
  type SessionIdleEvent,
  type SessionMeta,
  type SessionStatus,
  type SessionStatusEvent,
  type SessionStatusKind,
  type SessionStatusMap,
  type SkillInfo,
  type TextUpdatedEvent,
  type ToolCallStatus,
  type ToolUpdatedEvent,
} from './types';

// Agent runtime abstraction layer (transport-neutral surface the UI targets).
// Only types are re-exported here so the renderer can depend on the contract
// without pulling in the Node-only claude-code adapter (which depends on
// @anthropic-ai/claude-agent-sdk). The factory (createAgentRuntime) lives in
// "@workbench/sdk/agent-runtime", imported only by the Electron main process.
export {
  type AgentCommandInfo,
  type AgentHistoryMessage,
  type AgentHistoryPart,
  type AgentMcpConfig,
  type AgentMcpServer,
  type AgentProviderInfo,
  type AgentProviderModelInfo,
  type AgentRuntime,
  type AgentRuntimeConfig,
  type AgentRuntimeEvent,
  type AgentRuntimeKind,
  type AgentSessionMeta,
  type AgentSkillInfo,
  type PermissionMode,
} from './agent-runtime';
