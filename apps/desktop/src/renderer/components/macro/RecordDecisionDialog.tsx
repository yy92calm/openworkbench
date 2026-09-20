import type { ResearchDecision, ResearchModel, ResearchStance } from '@workbench/shared';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { researchAddDecision, researchUpdateDecision } from '@/lib/electron';
import { toast } from '@/lib/toast';

const STANCES: { id: ResearchStance; label: string }[] = [
  { id: 'overweight', label: '超配' },
  { id: 'neutral', label: '中性' },
  { id: 'underweight', label: '低配' },
  { id: 'watch', label: '观察' },
];

/** Record (or edit) a model decision in the workspace ledger. */
export function RecordDecisionDialog({
  model,
  target,
  existing,
  onClose,
  onSaved,
}: {
  model: ResearchModel;
  target: string;
  /** When set, the dialog edits this ledger entry instead of creating one. */
  existing?: ResearchDecision;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [stance, setStance] = useState<ResearchStance>(existing?.stance ?? 'overweight');
  const [thesis, setThesis] = useState(existing?.thesis ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!thesis.trim() || saving) return;
    setSaving(true);
    const saved = existing
      ? await researchUpdateDecision(existing.id, { stance, thesis: thesis.trim() })
      : await researchAddDecision({ model, target, stance, thesis: thesis.trim() });
    setSaving(false);
    if (saved) {
      toast.success(existing ? '已保存修改' : '已记录决策，可在下方台账中归因');
      onSaved();
      onClose();
    } else {
      toast.error(existing ? '决策修改失败' : '决策记录失败');
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={existing ? '编辑决策' : '记录决策'}
        className="w-[440px] rounded-card border border-border bg-surface p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium text-text">
          {existing ? '编辑决策' : '记录决策'} · {target}
        </div>
        <div className="mt-3 flex gap-1.5">
          {STANCES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStance(s.id)}
              className={cn(
                'rounded-input border px-2.5 py-1 text-[12px]',
                stance === s.id
                  ? s.id === 'underweight'
                    ? 'border-fall/40 bg-fall/10 text-fall'
                    : s.id === 'watch'
                      ? 'border-border bg-surface-2 text-text'
                      : 'border-rise/40 bg-rise/10 text-rise'
                  : 'border-border text-muted hover:bg-surface-2',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <textarea
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          rows={4}
          placeholder="决策依据：信号/触发条件/失效条件（将写入组织决策台账）"
          className="mt-3 w-full resize-none rounded-input border border-border bg-bg px-2.5 py-2 text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/40"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!thesis.trim() || saving}
            className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {existing ? '保存修改' : '记录'}
          </button>
        </div>
      </div>
    </div>
  );
}
