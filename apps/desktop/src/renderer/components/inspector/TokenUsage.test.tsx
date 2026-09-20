import { fireEvent, render, screen } from '@testing-library/react';
import type { ThreadBlock } from '@workbench/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { useRuntimeStore } from '@/lib/runtime';

import { TokenUsage } from './TokenUsage';

const mkThread = (blocks: ThreadBlock[]) => ({
  blocks,
  index: {},
  consecutiveTools: 0,
  loaded: true,
});

afterEach(() => {
  useRuntimeStore.setState({ threads: {}, currentId: null });
});

function seed(blocks: ThreadBlock[]) {
  useRuntimeStore.setState({ currentId: 's1', threads: { s1: mkThread(blocks) } });
}

describe('TokenUsage request history', () => {
  it('renders each turn as cleaned user/AI rows', () => {
    seed([
      { kind: 'user', text: '帮我看看 **报告**' },
      { kind: 'agent', markdown: '```html\n<p>page</p>\n```\n报告在这里' },
    ]);
    render(<TokenUsage />);
    expect(screen.getByText('用户')).toBeDefined();
    expect(screen.getByText('AI')).toBeDefined();
    // Markdown punctuation and fence bodies never leak into the preview.
    expect(screen.getByText('帮我看看 报告')).toBeDefined();
    expect(screen.getByText('报告在这里')).toBeDefined();
    expect(screen.queryByText('**报告**')).toBeNull();
    expect(screen.queryByText('<p>page</p>')).toBeNull();
  });

  it('folds tool calls behind a counter that expands on click', () => {
    seed([
      { kind: 'user', text: '跑一下测试' },
      { kind: 'agent', markdown: '开始' },
      { kind: 'tool-call', title: 'npm test', status: 'success' },
      { kind: 'tool-call', title: 'git status', status: 'success' },
      { kind: 'agent', markdown: '完成了' },
    ]);
    render(<TokenUsage />);
    // One turn; tools collapsed by default.
    expect(screen.getByText('工具调用 ×2')).toBeDefined();
    expect(screen.queryByText('npm test')).toBeNull();
    fireEvent.click(screen.getByText('工具调用 ×2'));
    expect(screen.getByText('npm test')).toBeDefined();
    expect(screen.getByText('git status')).toBeDefined();
  });

  it('counts turns in the session info card', () => {
    seed([
      { kind: 'user', text: 'q1' },
      { kind: 'agent', markdown: 'a1' },
      { kind: 'tool-call', title: 'read', status: 'success' },
      { kind: 'user', text: 'q2' },
      { kind: 'agent', markdown: 'a2' },
    ]);
    render(<TokenUsage />);
    const label = screen.getByText('轮次');
    expect(label.closest('div')?.textContent).toBe('轮次2');
  });

  it('shows the empty hint when there are no messages', () => {
    seed([]);
    render(<TokenUsage />);
    expect(screen.getByText(/暂无消息/)).toBeDefined();
  });
});
