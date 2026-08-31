/** Session-sharing helpers: compress a history session into a compact text
 *  payload that can be sent as a `session-share` room message. */

import type { HistoryMessage } from '@workbench/sdk';

export interface SessionSharePayload {
  title: string;
  sessionId: string;
  summary: string;
}

const MAX_MESSAGES = 30;
const MAX_CHARS_PER_MESSAGE = 150;

/** Extract the text of a part, falling back to a short placeholder. */
function partText(part: { type?: string; text?: string }): string {
  if (part.type === 'text' && typeof part.text === 'string') return part.text;
  if (part.type === 'tool') return '[工具调用]';
  return '';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Compress a session's message history into a shareable markdown summary.
 *  - Only text parts are kept; each message is labeled 用户/助手.
 *  - Each message is truncated to MAX_CHARS_PER_MESSAGE chars.
 *  - At most the last MAX_MESSAGES messages are included. */
export function compressSession(
  title: string,
  sessionId: string,
  messages: HistoryMessage[],
): SessionSharePayload {
  const lines: string[] = [];
  for (const m of messages.slice(-MAX_MESSAGES)) {
    const label = m.role === 'user' ? '**用户**' : '**助手**';
    const text = m.parts.map(partText).filter(Boolean).join('\n').trim();
    if (!text) continue;
    lines.push(`${label}: ${truncate(text, MAX_CHARS_PER_MESSAGE)}`);
  }
  const summary = [`# ${title || '未命名会话'}`, '', ...lines].join('\n');
  return { title: title || '未命名会话', sessionId, summary };
}
