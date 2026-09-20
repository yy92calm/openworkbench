import type { ThreadBlock } from '@workbench/shared';
import { describe, expect, it } from 'vitest';

import { buildTurns, cleanSummary, CONTENT_ONLY_FALLBACK } from './messageTurns';

function block(kind: string, extra: Record<string, unknown> = {}): ThreadBlock {
  switch (kind) {
    case 'user':
      return { kind: 'user', text: 'hi', timestamp: 1, ...extra } as ThreadBlock;
    case 'agent':
      return { kind: 'agent', markdown: 'text', timestamp: 1, ...extra } as ThreadBlock;
    case 'tool-call':
      return { kind: 'tool-call', tool: 'read', status: 'success', ...extra } as ThreadBlock;
    default:
      return { kind: 'reasoning', text: 'think', streaming: false, ...extra } as ThreadBlock;
  }
}

describe('buildTurns', () => {
  it('starts one turn per user message with its agent reply attached', () => {
    const turns = buildTurns([block('user', { text: 'q1' }), block('agent', { markdown: 'a1' })]);
    expect(turns).toEqual([{ user: 'q1', agent: 'a1', tools: [] }]);
  });

  it('joins multiple agent text parts of the same turn in order', () => {
    const turns = buildTurns([
      block('user'),
      block('agent', { markdown: 'part1' }),
      block('agent', { markdown: 'part2' }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].agent).toBe('part1\npart2');
  });

  it('attaches tool calls to the turn that contains them', () => {
    const turns = buildTurns([
      block('user', { text: 'q' }),
      block('agent'),
      block('tool-call', { tool: 'bash', title: 'npm test' }),
      block('tool-call', { tool: 'read' }),
      block('agent'),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].tools).toEqual([{ name: 'npm test' }, { name: 'read' }]);
    expect(turns[0].agent).toBe('text\ntext');
  });

  it('opens a new turn at the next user message', () => {
    const turns = buildTurns([
      block('user', { text: 'q1' }),
      block('agent', { markdown: 'a1' }),
      block('user', { text: 'q2' }),
      block('agent', { markdown: 'a2' }),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toEqual({ user: 'q2', agent: 'a2', tools: [] });
  });

  it('ignores reasoning and other non-payload blocks', () => {
    const turns = buildTurns([block('user'), block('reasoning'), block('agent')]);
    expect(turns).toHaveLength(1);
    expect(turns[0].agent).toBe('text');
  });

  it('folds pre-user fragments into an implicit leading turn', () => {
    const turns = buildTurns([block('agent', { markdown: 'lead' }), block('tool-call')]);
    expect(turns).toEqual([{ agent: 'lead', tools: [{ name: 'read' }] }]);
  });

  it('returns an empty list for empty blocks', () => {
    expect(buildTurns([])).toEqual([]);
  });
});

describe('cleanSummary', () => {
  it('returns empty for blank input', () => {
    expect(cleanSummary('   \n ')).toBe('');
  });

  it('removes whole fenced code blocks including their markers', () => {
    expect(cleanSummary('before\n```js\nconst a = 1;\n```\nafter')).toBe('before after');
  });

  it('removes rich fences (html/echarts) and falls back for fence-only text', () => {
    expect(cleanSummary('```echarts\n{"series":[]}\n```')).toBe(CONTENT_ONLY_FALLBACK);
    expect(cleanSummary('```html\n<p>hi</p>\n```')).toBe(CONTENT_ONLY_FALLBACK);
  });

  it('swallows the tail of an unclosed fence', () => {
    expect(cleanSummary('intro\n```html\n<p>half').trim()).toBe('intro');
  });

  it('strips markdown emphasis while keeping the words', () => {
    expect(cleanSummary('**bold** and *italic* and ~~gone~~ and `code`')).toBe(
      'bold and italic and gone and code',
    );
  });

  it('keeps link labels and image alt text instead of URLs', () => {
    expect(cleanSummary('[see docs](https://x.io) ![diagram](img.svg)')).toBe('see docs diagram');
  });

  it('removes headings, quotes, list markers and rules', () => {
    expect(cleanSummary('# Title\n> quoted\n- item\n---\nplain')).toBe('Title quoted item plain');
  });

  it('turns table rows into readable text', () => {
    expect(cleanSummary('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('a · b 1 · 2');
  });

  it('collapses whitespace runs and preserves snake_case', () => {
    expect(cleanSummary('line one\n\n  indented   tail\nuse snake_case here')).toBe(
      'line one indented tail use snake_case here',
    );
  });
});
