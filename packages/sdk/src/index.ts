export { OpenCodeClient } from "./OpenCodeClient";
export {
  OPENCODE_VERSION,
  DEFAULT_OPENCODE_URL,
  type OpenCodeEvent,
  type TextUpdatedEvent,
  type ToolUpdatedEvent,
  type SessionIdleEvent,
  type RuntimeErrorEvent,
  type OpenCodeClientOptions,
  type RuntimeStatus,
  type ToolCallStatus,
  type SessionMeta,
  type SkillInfo,
  type AgentInfo,
  type CommandInfo,
  type HistoryMessage,
  type ProviderInfo,
  type ProviderModelInfo,
  type ProviderAuthMethod,
  type ProviderCatalogEntry,
  type AuthPrompt,
  type OAuthAuthorization,
  type McpConfig,
  type McpServer,
  type QuestionOption,
  type QuestionItem,
  type QuestionAskedEvent,
  type QuestionResolvedEvent,
  type PermissionAskedEvent,
  type PermissionResolvedEvent,
  type PermissionReply,
  type SessionStatus,
  type SessionStatusKind,
  type SessionStatusEvent,
  type SessionStatusMap,
} from "./types";

// Agent runtime abstraction layer (transport-neutral surface the UI targets).
// Only types are re-exported here so the renderer can depend on the contract
// without pulling in the Node-only claude-code adapter (which depends on
// @anthropic-ai/claude-agent-sdk). The factory (createAgentRuntime) lives in
// "@workbench/sdk/agent-runtime", imported only by the Electron main process.
export {
  type AgentRuntime,
  type AgentRuntimeEvent,
  type AgentRuntimeConfig,
  type AgentRuntimeKind,
  type AgentSessionMeta,
  type AgentSkillInfo,
  type AgentCommandInfo,
  type AgentHistoryMessage,
  type AgentHistoryPart,
  type AgentProviderInfo,
  type AgentProviderModelInfo,
  type AgentMcpConfig,
  type AgentMcpServer,
  type PermissionMode,
} from "./agent-runtime";
