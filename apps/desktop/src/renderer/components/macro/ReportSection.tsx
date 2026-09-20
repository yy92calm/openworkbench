// The background briefing list: one row per macro theme task showing the
// latest generated report (or the schedule when nothing ran yet). Clicking a
// row opens the report; hover actions copy it or re-run the background task.

import type { MacroReportMeta, MacroThemeId } from '@workbench/shared';
import { MACRO_THEMES, macroTheme } from '@workbench/shared';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { MarkdownViewer } from '@/components/markdown-viewer/MarkdownViewer';
import { macroReportRead } from '@/lib/electron';
import { toast } from '@/lib/toast';

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function copyText(markdown: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(markdown);
    toast.success('报告全文已复制');
  } catch {
    toast.error('复制失败');
  }
}

/** Report viewer: rendered markdown + the two follow-up paths. */
function ReportDialog({
  meta,
  markdown,
  onClose,
  onOpenSession,
}: {
  meta: MacroReportMeta;
  markdown: string;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const theme = macroTheme(meta.themeId);
  const sessionId = meta.sessionId;
  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={theme?.title ?? '宏观简报'}
        className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col rounded-card border border-border bg-surface p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-text">{theme?.title ?? '宏观简报'}</div>
          <span className="text-[11px] text-muted">
            {stamp(meta.createdAt)} · 约 {meta.chars.toLocaleString('zh-CN')} 字
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
          >
            <X size={15} />
          </button>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-card border border-border-soft bg-bg/40 p-3">
          <MarkdownViewer className="text-[13px] leading-relaxed">{markdown}</MarkdownViewer>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void copyText(markdown)}
            className="rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
          >
            复制全文
          </button>
          {sessionId && (
            <button
              type="button"
              onClick={() => onOpenSession(sessionId)}
              className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              在对话中打开
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 后台简报 · 自动生成 — the viewing surface for background task output. */
export function ReportSection({
  reports,
  onRegenerate,
  onOpenSession,
}: {
  reports: MacroReportMeta[];
  onRegenerate: (themeId: MacroThemeId) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [viewing, setViewing] = useState<{ meta: MacroReportMeta; markdown: string } | null>(null);

  const open = async (meta: MacroReportMeta) => {
    const result = await macroReportRead(meta.file);
    if (!result) {
      toast.error('报告读取失败');
      return;
    }
    setViewing({ meta, markdown: result.markdown });
  };

  const copyReport = async (meta: MacroReportMeta) => {
    const result = await macroReportRead(meta.file);
    if (!result) {
      toast.error('报告读取失败');
      return;
    }
    await copyText(result.markdown);
  };

  return (
    <section className="order-2 mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-medium text-text">后台简报 · 自动生成</h2>
        <span className="text-[11px] text-muted">
          后台任务按期生成，报告落盘工作区 .workbench/research/reports/
        </span>
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        {MACRO_THEMES.map((theme) => {
          const latest = reports.find((r) => r.themeId === theme.id);
          const button =
            'rounded-input border border-border px-2 py-0.5 text-[11px] text-text hover:bg-surface-2';
          return (
            <div
              key={theme.id}
              className="group flex items-center gap-3 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <span className="w-16 shrink-0 text-[13px] text-text">{theme.title}</span>
              {latest ? (
                <>
                  <button
                    type="button"
                    onClick={() => void open(latest)}
                    className="min-w-0 flex-1 truncate text-left text-[11px] text-muted hover:text-text"
                  >
                    {stamp(latest.createdAt)} · 约 {latest.chars.toLocaleString('zh-CN')} 字 ·
                    点击查看
                  </button>
                  <span className="hidden shrink-0 items-center gap-2 group-hover:flex">
                    <button
                      type="button"
                      onClick={() => void copyReport(latest)}
                      className={button}
                    >
                      复制
                    </button>
                    <button type="button" onClick={() => onRegenerate(theme.id)} className={button}>
                      重新生成
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {theme.description} · 尚未生成
                  </span>
                  <button type="button" onClick={() => onRegenerate(theme.id)} className={button}>
                    立即生成
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {viewing && (
        <ReportDialog
          meta={viewing.meta}
          markdown={viewing.markdown}
          onClose={() => setViewing(null)}
          onOpenSession={onOpenSession}
        />
      )}
    </section>
  );
}
