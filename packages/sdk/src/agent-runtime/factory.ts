// Agent runtime factory.
//
// The single place that decides which concrete runtime the app talks to.
// "opencode" returns the existing OpenCodeClient (satisfies AgentRuntime).
// "claude-code" returns a ClaudeCodeAdapter (backed by the Claude Agent SDK).

import { OpenCodeClient } from '../OpenCodeClient';
import type { OpenCodeClientOptions } from '../types';
import type { AgentRuntime } from './adapter';
import type { RuntimeStatus } from './types';

export type AgentRuntimeKind = 'opencode' | 'claude-code';

export interface AgentRuntimeConfig {
  kind: AgentRuntimeKind;
  /** OpenCode: base URL of a running `opencode serve`. */
  baseUrl?: string;
  /** OpenCode: OPENCODE_SERVER_PASSWORD (basic auth). */
  password?: string;
  /** OpenCode: username (defaults to "opencode"). */
  username?: string;
  /** Inject fetch (defaults to global fetch; browser + node both have it). */
  fetchImpl?: typeof fetch;
  /**
   * Workspace directory the runtime should scope to. OpenCode initializes
   * per-directory instances lazily; ClaudeCode runs its CLI with this cwd.
   */
  directory?: string;
  /** ClaudeCode: path to the `claude` CLI (defaults to "claude"). */
  cliPath?: string;
}

/**
 * Create an AgentRuntime backed by the configured runtime kind.
 *
 * Returns a ready-to-connect instance; the caller must call connect().
 * The function is async because the claude-code path dynamically imports its
 * adapter (which depends on a Node-only SDK); the opencode path is synchronous
 * under the hood but await is harmless.
 *
 * Throws for an unknown kind so the mistake is caught at boot, not on the
 * first turn.
 */
export async function createAgentRuntime(config: AgentRuntimeConfig): Promise<AgentRuntime> {
  switch (config.kind) {
    case 'opencode': {
      const opts: OpenCodeClientOptions = {
        baseUrl: config.baseUrl,
        password: config.password,
        username: config.username,
        fetchImpl: config.fetchImpl,
        directory: config.directory,
      };
      // OpenCodeClient already satisfies the AgentRuntime interface: same
      // methods, same event shapes (its normalize() emits AgentRuntimeEvent).
      // The structural check below (no cast) proves the contract holds at
      // compile time; if OpenCodeClient drifts, tsc fails here.
      const client: AgentRuntime = new OpenCodeClient(opts);
      return client;
    }
    case 'claude-code': {
      // Dynamic import so @anthropic-ai/claude-agent-sdk (Node-only, bundles a
      // native binary) never enters the renderer bundle. The adapter module
      // itself only imports types at the top level; the SDK is loaded lazily
      // inside the adapter's connect().
      const { ClaudeCodeAdapter } = await import('./claude-code-adapter');
      return new ClaudeCodeAdapter({
        cliPath: config.cliPath,
        directory: config.directory,
      });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Unknown agent runtime kind: ${String(exhaustive)}`);
    }
  }
}

/** Re-exported so callers can read the status type without importing the adapter module. */
export type { RuntimeStatus };
