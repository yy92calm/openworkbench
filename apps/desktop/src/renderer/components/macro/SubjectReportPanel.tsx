// Industry/board report panel: 查看 the newest saved report, or 生成 a new one
// in a real session and watch the process live inside the dialog. Embedded in
// the board / Shenwan detail dialogs and in the rotation-row report dialog; the
// run itself lives in `useSubjectReports` so closing a dialog does not lose it.

import type { MacroReportSubject, ThreadBlock } from '@workbench/shared';
import { SUBJECT_KIND_LABEL, subjectKey } from '@workbench/shared';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { useRunBlocks, useSubjectReports } from '@/lib/useSubjectReports';

import { MarkdownViewer } from '../markdown-viewer/MarkdownViewer';
import { BlockList } from '../thread/BlockList';

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The prompt echo and the recall cards are noise in a small preview pane. */
const HIDDEN_PREVIEW: ThreadBlock['kind'][] = [
  'user',
  'turn-divider',
  'memory-recall',
  'wiki-recall',
];

const BUTTON =
  'rounded-input border border-border px-2.5 py-1 text-[12px] text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40';

export function SubjectReportPanel({
  subject,
  buildPrompt,
  onOpenSession,
}: {
  subject: MacroReportSubject;
  /** Prompt for a fresh run; null when the subject's data is not loaded yet. */
  buildPrompt: () => string | null;
  onOpenSession: (sessionId: string) => void;
}) {
  const key = subjectKey(subject);
  const run = useSubjectReports((s) => s.runs[key]);
  const view = useSubjectReports((s) => s.reports[key]);
  const start = useSubjectReports((s) => s.start);
  const load = useSubjectReports((s) => s.load);
  const blocks = useRunBlocks(run?.sessionId);
  const [showReport, setShowReport] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);
  // `subject` is rebuilt on every parent render; the effects key off `key`.
  const subjectRef = useRef(subject);
  subjectRef.current = subject;

  useEffect(() => {
    void load(subjectRef.current);
  }, [load, key]);

  // A finished run shows its report right away — that is what 生成 is for.
  const status = run?.status;
  useEffect(() => {
    if (status === 'done') setShowReport(true);
  }, [status]);

  // Keep the streaming tail in view while the agent works.
  useEffect(() => {
    const el = liveRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  const busy = status === 'starting' || status === 'running' || status === 'saving';
  const sessionId = run?.sessionId || view?.meta.sessionId;
  const preview = (blocks ?? []).filter((b) => !HIDDEN_PREVIEW.includes(b.kind));

  const copyReport = async () => {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.markdown);
      toast.success('报告全文已复制');
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <div className="rounded-card border border-border-soft bg-bg/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-text">行业报告</span>
        <span className="text-[11px] text-muted">{SUBJECT_KIND_LABEL[subject.kind]}</span>
        {view && (
          <span className="text-[11px] text-muted">
            最近 {stamp(view.meta.createdAt)} · 约 {view.meta.chars.toLocaleString('zh-CN')} 字
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className={BUTTON}
          disabled={!view}
          title={view ? '查看最近一份报告' : '尚未生成报告'}
          onClick={() => setShowReport((v) => !v)}
        >
          {showReport && view ? '收起' : '查看'}
        </button>
        <button
          type="button"
          className="rounded-input bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          title="新建会话生成报告，生成过程在下方实时预览"
          onClick={() => {
            setShowReport(false);
            void start(subjectRef.current, buildPrompt);
          }}
        >
          {busy ? '生成中…' : '生成'}
        </button>
      </div>

      {busy && (
        <div className="mt-2">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {status === 'saving'
              ? '生成完成，正在保存报告…'
              : status === 'starting'
                ? '正在启动会话…'
                : '正在生成报告（过程实时预览）'}
          </div>
          <div
            ref={liveRef}
            className="mt-1.5 max-h-[42vh] min-h-[120px] overflow-y-auto rounded-card border border-border-soft bg-surface/60 p-2"
          >
            {preview.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted">等待模型输出…</div>
            ) : (
              <BlockList blocks={preview} handlers={{ sessionId: run?.sessionId }} />
            )}
          </div>
        </div>
      )}

      {!busy && status === 'failed' && (
        <p className="mt-2 text-[11px] leading-relaxed text-error">
          {run?.error ?? '生成失败'}
          {sessionId ? '；可在对话中查看该会话。' : '。'}
        </p>
      )}

      {!busy && showReport && view && (
        <div className="mt-2">
          <div className="max-h-[46vh] overflow-y-auto rounded-card border border-border-soft bg-surface/60 p-2.5">
            <MarkdownViewer className="text-[13px] leading-relaxed">{view.markdown}</MarkdownViewer>
          </div>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" className={BUTTON} onClick={() => void copyReport()}>
              复制全文
            </button>
            {sessionId && (
              <button
                type="button"
                className={cn(BUTTON, 'border-accent/40 text-accent')}
                onClick={() => onOpenSession(sessionId)}
              >
                在对话中打开
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
