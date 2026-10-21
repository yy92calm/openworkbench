// Industry/board report runs (macro panel dialogs). Generation happens in a
// real session so the dialog can preview the process live; the finished answer
// is captured by the main process. Both the run state and the captured report
// live in this store rather than in the dialog: closing the dialog must
// neither cancel the run nor lose the save.

import type { MacroReportSubject } from '@workbench/shared';
import { subjectKey } from '@workbench/shared';
import { create } from 'zustand';

import { macroSubjectReport, macroSubjectReportCapture, type SubjectReportView } from './electron';
import { useRuntimeStore } from './runtime';
import { toast } from './toast';

export type SubjectRunStatus = 'starting' | 'running' | 'saving' | 'done' | 'failed';

export interface SubjectRun {
  subject: MacroReportSubject;
  /** Empty while the session is still being created. */
  sessionId: string;
  status: SubjectRunStatus;
  startedAt: number;
  error?: string;
}

interface SubjectReportState {
  /** By subject key; the newest run per subject. */
  runs: Record<string, SubjectRun>;
  /** By subject key; null once loaded and the subject has no report yet. */
  reports: Record<string, SubjectReportView | null>;
  /** Start a generation run in a fresh session (no-op while one is in flight). */
  start: (subject: MacroReportSubject, buildPrompt: () => string | null) => Promise<void>;
  /** Load the newest saved report for a subject (once per subject). */
  load: (subject: MacroReportSubject) => Promise<void>;
}

async function capture(run: SubjectRun): Promise<void> {
  const key = subjectKey(run.subject);
  useSubjectReports.setState((s) => ({
    runs: { ...s.runs, [key]: { ...run, status: 'saving' } },
  }));
  const view = await macroSubjectReportCapture(run.subject, run.sessionId);
  useSubjectReports.setState((s) => ({
    runs: {
      ...s.runs,
      [key]: view
        ? { ...run, status: 'done' }
        : { ...run, status: 'failed', error: '未取到报告正文，请在对话中查看该会话' },
    },
    reports: view ? { ...s.reports, [key]: view } : s.reports,
  }));
}

/**
 * Capture finished runs whenever the runtime's running locks change. A module
 * level subscription (started on the first run) keeps working after the dialog
 * — or the whole macro page — unmounts.
 */
let watching = false;

function ensureWatcher(): void {
  if (watching) return;
  watching = true;
  useRuntimeStore.subscribe((state, prev) => {
    if (state.runningSessions === prev.runningSessions) return;
    for (const run of Object.values(useSubjectReports.getState().runs)) {
      if (run.status === 'running' && !state.runningSessions[run.sessionId]) void capture(run);
    }
  });
}

export const useSubjectReports = create<SubjectReportState>((set, get) => ({
  runs: {},
  reports: {},

  start: async (subject, buildPrompt) => {
    const key = subjectKey(subject);
    const current = get().runs[key];
    if (current && current.status !== 'done' && current.status !== 'failed') return;
    const runtime = useRuntimeStore.getState();
    if (runtime.status !== 'ready') {
      toast.error('运行时未就绪，请稍后重试');
      return;
    }
    const prompt = buildPrompt();
    if (!prompt) {
      toast.error('行业数据未就绪，无法生成报告');
      return;
    }
    const startedAt = Date.now();
    // Reserve the slot before the send: creating the session switches the app
    // into a fresh dated workspace folder, which can take seconds, and a second
    // click in that window must not start a second run.
    set((s) => ({
      runs: { ...s.runs, [key]: { subject, sessionId: '', status: 'starting', startedAt } },
    }));
    runtime.startDraft();
    const sessionId = await runtime.sendPrompt(prompt);
    if (!sessionId) {
      set((s) => ({
        runs: {
          ...s.runs,
          [key]: {
            subject,
            sessionId: '',
            status: 'failed',
            startedAt,
            error: '生成未能启动（可能已有消息在发送），请稍后重试',
          },
        },
      }));
      toast.error('生成未能启动，请稍后重试');
      return;
    }
    set((s) => ({
      runs: { ...s.runs, [key]: { subject, sessionId, status: 'running', startedAt } },
    }));
    ensureWatcher();
  },

  load: async (subject) => {
    const key = subjectKey(subject);
    if (key in get().reports) return;
    // Reserve the slot so a second dialog opening the same subject does not
    // re-read; the value is filled in below (null = no report yet).
    set((s) => ({ reports: { ...s.reports, [key]: null } }));
    const view = await macroSubjectReport(subject);
    set((s) => ({ reports: { ...s.reports, [key]: view } }));
  },
}));

/** Live thread blocks of a run's session (the dialog's generation preview). */
export function useRunBlocks(sessionId: string | undefined) {
  return useRuntimeStore((s) => (sessionId ? s.threads[sessionId]?.blocks : undefined));
}
