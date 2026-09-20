import type { ThreadBlock } from '@workbench/shared';
import { describe, expect, it } from 'vitest';

import { groupIsStreaming, isGroupableWorkBlock, isShortAgentOutput } from './threadGroups';

const agent = (markdown: string, over: Partial<ThreadBlock> = {}): ThreadBlock => ({
  kind: 'agent',
  markdown,
  ...over,
});
const tool = (status: 'running' | 'success' | 'failed' = 'success'): ThreadBlock => ({
  kind: 'tool-call',
  title: 't',
  status,
});

describe('isShortAgentOutput', () => {
  it('accepts brief narration', () => {
    expect(isShortAgentOutput(agent('让我查一下财务数据…'))).toBe(true);
  });

  it('rejects long answers', () => {
    expect(isShortAgentOutput(agent('长'.repeat(201)))).toBe(false);
  });

  it('rejects structured markdown even when short', () => {
    expect(isShortAgentOutput(agent('结论：\n```\ncode\n```'))).toBe(false);
    expect(isShortAgentOutput(agent('## 标题'))).toBe(false);
    expect(isShortAgentOutput(agent('| a | b |\n| - | - |'))).toBe(false);
  });

  it('rejects non-agent blocks', () => {
    expect(isShortAgentOutput({ kind: 'user', text: '短' })).toBe(false);
    expect(isShortAgentOutput(tool())).toBe(false);
  });
});

describe('isGroupableWorkBlock', () => {
  it('groups reasoning, tool-call, status-line and short agent output', () => {
    expect(isGroupableWorkBlock({ kind: 'reasoning', text: 'x' })).toBe(true);
    expect(isGroupableWorkBlock(tool())).toBe(true);
    expect(isGroupableWorkBlock({ kind: 'status-line', text: 'done' })).toBe(true);
    expect(isGroupableWorkBlock(agent('好的，开始分析'))).toBe(true);
  });

  it('never groups user messages, artifacts, or long answers', () => {
    expect(isGroupableWorkBlock({ kind: 'user', text: '问题' })).toBe(false);
    expect(
      isGroupableWorkBlock({
        kind: 'artifact',
        path: 'a.csv',
        filename: 'a.csv',
        artifact: 'table',
        tool: 'write',
      }),
    ).toBe(false);
    expect(isGroupableWorkBlock(agent('长'.repeat(300)))).toBe(false);
  });
});

describe('groupIsStreaming', () => {
  it('detects running tools, streaming reasoning, and agent text without timestamp', () => {
    expect(groupIsStreaming([tool('running')])).toBe(true);
    expect(groupIsStreaming([{ kind: 'reasoning', text: 'x', streaming: true }])).toBe(true);
    expect(groupIsStreaming([agent('写一半')])).toBe(true);
    expect(groupIsStreaming([tool(), agent('完成', { timestamp: 1 })])).toBe(false);
  });
});
