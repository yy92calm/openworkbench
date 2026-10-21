import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MacroReportSubject, ThreadBlock } from '@workbench/shared';
import { subjectKey } from '@workbench/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Thread, useRuntimeStore } from '@/lib/runtime';
import { useToastStore } from '@/lib/toast';
import { useSubjectReports } from '@/lib/useSubjectReports';

import { SubjectReportPanel } from './SubjectReportPanel';

const subject: MacroReportSubject = { kind: 'board', code: 'BK0448', name: '电子' };

const saved = {
  meta: {
    subject,
    file: '20260921-0831-board-bk0448.md',
    createdAt: '2026-09-21T08:31:00.000Z',
    chars: 128,
    sessionId: 's0',
  },
  markdown: '# 电子行业报告\n\n超配。',
};

const onOpenSession = vi.fn();

/** The jsdom bridge is a noop proxy whose get trap ignores writes — replace it. */
function stubBridge(overrides: Record<string, unknown>): void {
  (window as unknown as Record<string, unknown>).electronAPI = {
    ...((window as unknown as Record<string, unknown>).electronAPI as object),
    ...overrides,
  };
}

function threadWith(blocks: ThreadBlock[]): Thread {
  return { blocks, index: {}, consecutiveTools: 0, loaded: true, todos: [], coldExpanded: false };
}

function renderPanel(buildPrompt: () => string | null = () => '请生成电子行业报告') {
  return render(
    <SubjectReportPanel
      subject={subject}
      buildPrompt={buildPrompt}
      onOpenSession={onOpenSession}
    />,
  );
}

beforeEach(() => {
  useSubjectReports.setState({ runs: {}, reports: {} });
  useToastStore.setState({ toasts: [] });
  useRuntimeStore.setState({ status: 'offline', threads: {}, runningSessions: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SubjectReportPanel', () => {
  it('loads the newest report and keeps 查看 disabled without one', async () => {
    const macroSubjectReport = vi.fn().mockResolvedValue(null);
    stubBridge({ macroSubjectReport });
    renderPanel();

    await waitFor(() => expect(macroSubjectReport).toHaveBeenCalledWith(subject));
    expect(screen.getByRole('button', { name: '查看' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成' })).toBeEnabled();
  });

  it('查看 renders the saved report and jumps to its session', async () => {
    stubBridge({ macroSubjectReport: vi.fn().mockResolvedValue(saved) });
    renderPanel();

    expect(await screen.findByText(/约 128 字/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(await screen.findByText('电子行业报告')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '在对话中打开' }));
    expect(onOpenSession).toHaveBeenCalledWith('s0');
  });

  it('生成 previews the live session, then saves the answer once it goes idle', async () => {
    const capture = vi.fn().mockResolvedValue(saved);
    stubBridge({
      macroSubjectReport: vi.fn().mockResolvedValue(null),
      macroSubjectReportCapture: capture,
    });
    const startDraft = vi.fn();
    const sendPrompt = vi.fn(async () => 's1');
    useRuntimeStore.setState({ status: 'ready', startDraft, sendPrompt });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: '生成' }));
    expect(startDraft).toHaveBeenCalled();
    expect(await screen.findByText('正在生成报告（过程实时预览）')).toBeInTheDocument();

    useRuntimeStore.setState((s) => ({
      threads: { ...s.threads, s1: threadWith([{ kind: 'agent', markdown: '正在分析电子板块…' }]) },
      runningSessions: { ...s.runningSessions, s1: true },
    }));
    expect(await screen.findByText('正在分析电子板块…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成中…' })).toBeDisabled();

    useRuntimeStore.setState({ runningSessions: {} });
    await waitFor(() => expect(capture).toHaveBeenCalledWith(subject, 's1'));
    expect(await screen.findByText('电子行业报告')).toBeInTheDocument();
    expect(useSubjectReports.getState().runs[subjectKey(subject)].status).toBe('done');
  });

  it('refuses to start when the runtime is not ready', async () => {
    stubBridge({ macroSubjectReport: vi.fn().mockResolvedValue(null) });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: '生成' }));
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      '运行时未就绪，请稍后重试',
    );
    expect(useSubjectReports.getState().runs).toEqual({});
  });

  it('refuses to start while the subject data is still loading', async () => {
    stubBridge({ macroSubjectReport: vi.fn().mockResolvedValue(null) });
    useRuntimeStore.setState({ status: 'ready' });
    renderPanel(() => null);

    await userEvent.click(await screen.findByRole('button', { name: '生成' }));
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      '行业数据未就绪，无法生成报告',
    );
    expect(useSubjectReports.getState().runs).toEqual({});
  });
});
