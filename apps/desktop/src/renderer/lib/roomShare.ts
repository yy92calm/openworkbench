/** Session-sharing helpers for the desktop renderer. Mirrors the client-side
 *  roomShare.ts (client and desktop are separate workspaces, so this copy is
 *  kept in sync manually). */

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

/** Compress a session's message history into a shareable markdown summary. */
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
