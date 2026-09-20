import type { ThreadBlock } from '@workbench/shared';

/**
 * Turn grouping + summary cleaning for the context panel's request history
 * (docs/20260906-02-context-history-turns.md). Pure functions — the UI keeps
 * them on plain strings, tests cover them without a DOM.
 */

export interface TurnEntry {
  /** Raw user text (cleaned at render). */
  user?: string;
  /** All agent markdown of the turn, joined in order (cleaned at render). */
  agent?: string;
  /** Tool calls that belong to this turn, in thread order. */
  tools: { name: string }[];
}

/** One conversational turn per user message; anything before the first user
 *  message folds into an implicit leading turn so no block is ever dropped.
 *  Reasoning and other non-payload blocks are ignored, as before. */
export function buildTurns(blocks: ReadonlyArray<ThreadBlock>): TurnEntry[] {
  const turns: TurnEntry[] = [];
  let current: TurnEntry | null = null;
  const open = (): TurnEntry => {
    if (!current) {
      current = { tools: [] };
      turns.push(current);
    }
    return current;
  };
  for (const b of blocks) {
    if (b.kind === 'user') {
      current = { user: b.text, tools: [] };
      turns.push(current);
    } else if (b.kind === 'agent') {
      const t = open();
      t.agent = t.agent ? `${t.agent}\n${b.markdown}` : b.markdown;
    } else if (b.kind === 'tool-call') {
      open().tools.push({ name: b.title ?? b.tool });
    }
  }
  return turns;
}

/** Shown when cleaning leaves nothing but the message had real content —
 *  e.g. a reply that is only code/chart fences. */
export const CONTENT_ONLY_FALLBACK = '（代码/图表内容，详见对话）';

/**
 * Reduce raw message markdown to a readable one-line summary: strip fenced
 * code (whole blocks plus stray markers), markdown punctuation, image/link
 * URLs and table chrome; collapse whitespace. Returns '' for truly empty
 * input, the fallback marker when syntax-only content remains.
 */
export function cleanSummary(raw: string): string {
  if (!raw.trim()) return '';

  // Fenced blocks are removed line-wise (markdown fences do not nest), so an
  // unclosed fence swallows its tail exactly like a code viewer would.
  const kept: string[] = [];
  let inFence = false;
  for (const line of raw.split('\n')) {
    if (inFence) {
      if (line.trim() === '```') inFence = false;
      continue;
    }
    if (line.trimStart().startsWith('```')) {
      inFence = true;
      continue;
    }
    kept.push(line);
  }

  const out: string[] = [];
  for (const line of kept) {
    let l = line
      // Image -> alt text, link -> its label, inline code -> its body.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => alt.trim())
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/`/g, '')
      // Bold / italic / strikethrough markers (underscore forms need word
      // boundaries so snake_case survives).
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2')
      .replace(/~~([^~\n]+)~~/g, '$1');
    // Structural lines first: rules and table separators vanish entirely…
    if (/^([-*_])([ \t]*\1){2,}[ \t]*$/.test(l.trim())) continue;
    if (/^\|?([ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-+:?[ \t]*\|?$/.test(l.trim())) continue;
    // …then heading / quote / list markers, and outer table pipes.
    l = l
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^([-*+]|\d{1,3}[.)])\s+/, '');
    l = l.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
    out.push(l.replace(/[ \t]*\|[ \t]*/g, ' · '));
  }

  return (
    out
      .join('\n')
      // Stray inline tags.
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim() || (raw.trim() ? CONTENT_ONLY_FALLBACK : '')
  );
}
