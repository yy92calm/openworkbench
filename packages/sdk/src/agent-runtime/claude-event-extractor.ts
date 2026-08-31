// Event extractor: maps Claude Agent SDK messages -> AgentRuntimeEvent.
//
// The Claude Agent SDK (TypeScript) yields typed messages from its `query()`
// async iterator. Each message is one of:
//   - { type: "system", subtype: "init", session_id, ... }
//   - { type: "assistant", message: { content: ContentBlock[] } }
//   - { type: "user", message: { content: ContentBlock[] } }
//   - { type: "result", subtype: "success"|"error_max_tokens"|..., result, ... }
//
// Content blocks within assistant/user messages:
//   - { type: "text", text }
//   - { type: "thinking", thinking }
//   - { type: "tool_use", id, name, input }
//   - { type: "tool_result", tool_use_id, content, is_error }
//   - { type: "tool_use_with_approval", ... } (permission prompt)
//
// This module is pure (no I/O): it takes a raw SDK message object and returns
// zero or more AgentRuntimeEvent objects. Keeping it separate from the adapter
// makes the mapping testable without spawning a real Claude process.

import type { AgentRuntimeEvent, ToolCallStatus } from './types';

/** A raw message object yielded by the Claude Agent SDK's query() iterator. */

export type ClaudeSdkMessage = Record<string, any>;

/** Content block shapes inside assistant/user messages. */
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | unknown; is_error?: boolean };

/** Monotonic counter so each emitted event has a unique partId/callId within a turn. */
let emitSeq = 0;
function nextId(prefix: string): string {
  emitSeq = (emitSeq + 1) % 1_000_000;
  return `${prefix}_${emitSeq}`;
}

function mapToolStatus(isError?: boolean): ToolCallStatus {
  if (isError) return 'failed';
  return 'success';
}

/** Extract the session_id from a system/init message, or null if not one. */
export function extractSessionId(msg: ClaudeSdkMessage): string | null {
  if (msg.type === 'system' && msg.subtype === 'init') {
    const sid = msg.session_id ?? msg.data?.session_id;
    return typeof sid === 'string' ? sid : null;
  }
  return null;
}

/**
 * Convert one Claude Agent SDK message into zero or more AgentRuntimeEvent.
 *
 * @param msg - A raw message from the SDK's query() iterator.
 * @param sessionId - The session id this message belongs to (from the init event).
 */
export function extractEvents(msg: ClaudeSdkMessage, sessionId: string): AgentRuntimeEvent[] {
  const events: AgentRuntimeEvent[] = [];

  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content as ContentBlock[]) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        events.push({
          type: 'text.updated',
          sessionId,
          partId: nextId('txt'),
          text: block.text,
        });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        events.push({
          type: 'reasoning.updated',
          sessionId,
          partId: nextId('rsn'),
          text: block.thinking,
          streaming: false,
        });
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        events.push({
          type: 'tool.updated',
          sessionId,
          callId: block.id,
          tool: typeof block.name === 'string' ? block.name : 'tool',
          status: 'running',
          title: typeof block.name === 'string' ? block.name : undefined,
          input: block.input as Record<string, unknown> | undefined,
        });
      }
    }
  }

  if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content as ContentBlock[]) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const output =
          typeof block.content === 'string'
            ? block.content
            : typeof block.content === 'object' && block.content !== null
              ? JSON.stringify(block.content)
              : '';
        events.push({
          type: 'tool.updated',
          sessionId,
          callId: block.tool_use_id,
          tool: 'tool',
          status: mapToolStatus(block.is_error),
          output,
        });
      }
    }
  }

  // The result message signals turn completion.
  if (msg.type === 'result') {
    if (msg.subtype === 'error_max_tokens' || msg.subtype === 'error_during_execution') {
      events.push({
        type: 'error',
        sessionId,
        message: typeof msg.result === 'string' ? msg.result : `Claude turn ended: ${msg.subtype}`,
      });
    }
    events.push({ type: 'session.idle', sessionId });
  }

  return events;
}
