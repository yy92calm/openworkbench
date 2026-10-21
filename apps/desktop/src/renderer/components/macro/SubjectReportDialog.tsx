// Report dialog for one rotation-table row. The row already shows every metric,
// so the dialog carries only the report panel (查看 / 生成).

import type { MacroReportSubject } from '@workbench/shared';
import { X } from 'lucide-react';
import { useEffect } from 'react';

import { SubjectReportPanel } from './SubjectReportPanel';

export function SubjectReportDialog({
  subject,
  subtitle,
  buildPrompt,
  onClose,
  onOpenSession,
}: {
  subject: MacroReportSubject;
  /** One-line metrics summary shown under the title. */
  subtitle?: string;
  buildPrompt: () => string | null;
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

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={`${subject.name} 行业报告`}
        className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col rounded-card border border-border bg-surface p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium text-text">{subject.name}</span>
          <span className="font-mono text-[11px] text-muted">{subject.code}</span>
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
        {subtitle && <p className="mt-1 text-[11px] leading-relaxed text-muted">{subtitle}</p>}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
          <SubjectReportPanel
            subject={subject}
            buildPrompt={buildPrompt}
            onOpenSession={onOpenSession}
          />
        </div>
      </div>
    </div>
  );
}
