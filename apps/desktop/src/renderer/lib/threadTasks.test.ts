import type { ThreadBlock } from '@workbench/shared';
import { describe, expect, it } from 'vitest';

import { groupTodos, isTodoTool, parseTodos, subtasksOf } from './threadTasks';

describe('isTodoTool', () => {
  it('matches the agent todo tools and nothing else', () => {
    expect(isTodoTool('todowrite')).toBe(true);
    expect(isTodoTool('todoread')).toBe(true);
    expect(isTodoTool('task')).toBe(false);
    expect(isTodoTool('bash')).toBe(false);
    expect(isTodoTool('edit')).toBe(false);
  });
});

describe('parseTodos', () => {
  it('reads content and status, defaulting an unknown status to pending', () => {
    expect(
      parseTodos({
        todos: [
          { content: '写测试', status: 'completed' },
          { content: '改文档', status: 'in_progress' },
          { content: '发版', status: 'weird' },
        ],
      }),
    ).toEqual([
      { content: '写测试', status: 'completed' },
      { content: '改文档', status: 'in_progress' },
      { content: '发版', status: 'pending' },
    ]);
  });

  it('skips entries without usable content and trims the ones it keeps', () => {
    expect(
      parseTodos({ todos: [{ content: '  ' }, { content: ' ok ' }, {}, 'junk', null] }),
    ).toEqual([{ content: 'ok', status: 'pending' }]);
  });

  it('returns null when the call carries no todo list, so callers keep the old one', () => {
    expect(parseTodos(undefined)).toBeNull();
    expect(parseTodos({ command: 'ls' })).toBeNull();
    expect(parseTodos({ todos: 'not-an-array' })).toBeNull();
  });

  it('returns an empty list for an explicitly empty todo list', () => {
    expect(parseTodos({ todos: [] })).toEqual([]);
  });
});

describe('groupTodos', () => {
  it('splits open from done, counting cancelled as done', () => {
    const todos = [
      { content: 'a', status: 'completed' as const },
      { content: 'b', status: 'in_progress' as const },
      { content: 'c', status: 'pending' as const },
      { content: 'd', status: 'cancelled' as const },
    ];
    const { open, done } = groupTodos(todos);
    expect(open.map((t) => t.content)).toEqual(['b', 'c']);
    expect(done.map((t) => t.content)).toEqual(['a', 'd']);
  });
});

describe('subtasksOf', () => {
  it('keeps only tool-call blocks that spawned a child session', () => {
    const blocks: ThreadBlock[] = [
      { kind: 'agent', markdown: 'hi' },
      {
        kind: 'tool-call',
        title: 'subagent: 调研',
        status: 'running',
        childSessionId: 'ses_child',
      },
      { kind: 'tool-call', title: 'write a.ts', status: 'success' },
      {
        kind: 'tool-call',
        title: 'subagent: 复核',
        status: 'success',
        childSessionId: 'ses_2',
        meta: '12s',
      },
    ];
    expect(subtasksOf(blocks)).toEqual([
      { sessionId: 'ses_child', title: 'subagent: 调研', status: 'running' },
      { sessionId: 'ses_2', title: 'subagent: 复核', status: 'success', meta: '12s' },
    ]);
  });

  it('returns nothing for a thread without subagents', () => {
    expect(subtasksOf([{ kind: 'agent', markdown: 'hi' }])).toEqual([]);
  });
});
