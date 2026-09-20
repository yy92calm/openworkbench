import type { ResearchDecision, ResearchOutcome } from '@workbench/shared';
import { useMemo, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import { researchAttribute, researchDeleteDecision, researchExport } from '@/lib/electron';
import { toast } from '@/lib/toast';

import { RecordDecisionDialog } from './RecordDecisionDialog';

const STANCE_LABEL: Record<ResearchDecision['stance'], string> = {
  overweight: '超配',
  neutral: '中性',
  underweight: '低配',
  watch: '观察',
};

const OUTCOME_LABEL: Record<ResearchOutcome, string> = {
  hit: '命中',
  partial: '部分命中',
  miss: '偏离',
};

type ModelFilter = 'all' | ResearchDecision['model'];
type StatusFilter = 'all' | ResearchDecision['status'];

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Small segmented control used by the ledger filters. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] ring-1',
            value === o.id
              ? 'bg-accent/10 text-accent ring-accent/30'
              : 'bg-surface text-muted ring-border hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Decisions → attribution → retraining: the workspace ledger UI. */
export function DecisionLedger({
  decisions,
  onChanged,
  onRegenerate,
  onReview,
}: {
  decisions: ResearchDecision[];
  onChanged: () => void;
  onRegenerate: () => void;
  onReview: () => void;
}) {
  const [target, setTarget] = useState<ResearchDecision | null>(null);
  const [outcome, setOutcome] = useState<ResearchOutcome>('hit');
  const [note, setNote] = useState('');
  const [editTarget, setEditTarget] = useState<ResearchDecision | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResearchDecision | null>(null);
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const activeFilters =
    (modelFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (query.trim() ? 1 : 0);

  const clearFilters = () => {
    setModelFilter('all');
    setStatusFilter('all');
    setQuery('');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decisions.filter((d) => {
      if (modelFilter !== 'all' && d.model !== modelFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      return `${d.target} ${d.thesis} ${d.attribution?.note ?? ''}`.toLowerCase().includes(q);
    });
  }, [decisions, modelFilter, statusFilter, query]);

  const submit = async () => {
    if (!target || !note.trim()) return;
    const updated = await researchAttribute(target.id, outcome, note.trim());
    if (updated) {
      toast.success('归因已回填，将注入后续模型 prompt');
      setTarget(null);
      setNote('');
      onChanged();
    } else {
      toast.error('归因回填失败');
    }
  };

  const exportCsv = async () => {
    const result = await researchExport();
    if (result) toast.success(`已导出 ${result.count} 条到工作区 ${result.path}`);
    else toast.error('暂无可导出的决策');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const ok = await researchDeleteDecision(deleteTarget.id);
    if (ok) {
      toast.success('已删除该条决策');
      setDeleteTarget(null);
      onChanged();
    } else {
      toast.error('删除失败');
    }
  };

  const reviewed = decisions.filter((d) => d.status === 'reviewed').length;
  const rate = decisions.length > 0 ? Math.round((reviewed / decisions.length) * 100) : 0;

  return (
    <div>
      <div className="group mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-medium text-text">决策台账 · 记录 → 归因 → 再训练</h2>
        <span className="text-[11px] text-muted">
          共 {decisions.length} 条 · 已归因 {reviewed}（{rate}%）· 工作区 decisions.jsonl
        </span>
        <span className="flex-1" />
        <span className="hidden items-center gap-2 group-hover:flex">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'rounded-input border px-2.5 py-1 text-[12px]',
              activeFilters > 0
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-text hover:bg-surface-2',
            )}
          >
            筛选{activeFilters > 0 ? ` · ${activeFilters}` : ''}
          </button>
          <button
            type="button"
            onClick={() => void exportCsv()}
            className="rounded-input border border-border px-2.5 py-1 text-[12px] text-text hover:bg-surface-2"
          >
            导出 CSV
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            title="立即在后台重跑「复盘周报」"
            className="rounded-input border border-border px-2.5 py-1 text-[12px] text-text hover:bg-surface-2"
          >
            重新生成
          </button>
          <button
            type="button"
            onClick={onReview}
            className="rounded-input border border-border px-2.5 py-1 text-[12px] text-text hover:bg-surface-2"
          >
            交给对话解析
          </button>
        </span>
      </div>

      {showFilters && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Segmented<ModelFilter>
            value={modelFilter}
            onChange={setModelFilter}
            options={[
              { id: 'all', label: '全部模型' },
              { id: 'rotation', label: '轮动' },
              { id: 'industry', label: '行业' },
            ]}
          />
          <Segmented<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { id: 'all', label: '全部状态' },
              { id: 'open', label: '待归因' },
              { id: 'reviewed', label: '已归因' },
            ]}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标的 / 论据 / 归因"
            className="w-48 rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none placeholder:text-muted focus:border-accent/40"
          />
          <span className="text-[11px] text-muted">
            显示 {filtered.length} / 共 {decisions.length}
          </span>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] text-muted hover:text-text"
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      {decisions.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-3 py-6 text-center text-[12px] text-muted">
          暂无决策记录。在轮动评分表或行业面板中点击「记录决策」。
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-3 py-6 text-center text-[12px] text-muted">
          没有符合筛选条件的决策。
        </div>
      ) : (
        <div className="max-h-[380px] overflow-y-auto rounded-card border border-border bg-surface">
          {filtered.map((d) => (
            <div
              key={d.id}
              className="group flex items-start gap-2 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted">
                {stamp(d.createdAt)}
              </span>
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[11px]',
                  d.model === 'rotation'
                    ? 'bg-accent/10 text-accent ring-1 ring-accent/30'
                    : 'bg-surface-2 text-text ring-1 ring-border',
                )}
              >
                {d.model === 'rotation' ? '轮动' : '行业'}
              </span>
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[11px]',
                  d.stance === 'underweight'
                    ? 'bg-fall/10 text-fall ring-1 ring-fall/30'
                    : d.stance === 'watch'
                      ? 'bg-surface-2 text-muted ring-1 ring-border'
                      : 'bg-rise/10 text-rise ring-1 ring-rise/30',
                )}
              >
                {STANCE_LABEL[d.stance]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-text" title={d.thesis}>
                  <span className="font-medium">{d.target}</span>
                  <span className="text-muted"> · {d.thesis}</span>
                </span>
                {d.attribution && (
                  <span className="mt-0.5 block text-[11px] text-muted">
                    已归因 · {OUTCOME_LABEL[d.attribution.outcome]}：{d.attribution.note}
                  </span>
                )}
              </span>
              <span className="hidden shrink-0 items-center gap-1.5 group-hover:flex">
                {d.status === 'open' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTarget(d);
                      setOutcome('hit');
                      setNote('');
                    }}
                    className="rounded-input border border-border px-2 py-0.5 text-[11px] text-text hover:bg-surface-2"
                  >
                    归因
                  </button>
                ) : (
                  <span className="text-[11px] text-muted">已复盘</span>
                )}
                <button
                  type="button"
                  onClick={() => setEditTarget(d)}
                  className="text-[11px] text-muted hover:text-text"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(d)}
                  className="text-[11px] text-muted hover:text-error"
                >
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {target && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
          onClick={() => setTarget(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-label="决策归因"
            className="w-[420px] rounded-card border border-border bg-surface p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-text">决策归因 · {target.target}</div>
            <div className="mt-1 text-[12px] text-muted">{target.thesis}</div>
            <div className="mt-3 flex gap-1.5">
              {(Object.keys(OUTCOME_LABEL) as ResearchOutcome[]).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcome(o)}
                  className={cn(
                    'rounded-input border px-2.5 py-1 text-[12px]',
                    outcome === o
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border text-muted hover:bg-surface-2',
                  )}
                >
                  {OUTCOME_LABEL[o]}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="复盘说明：偏差来源（数据/模型/执行）、可复用经验"
              className="mt-3 w-full resize-none rounded-input border border-border bg-bg px-2.5 py-2 text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/40"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!note.trim()}
                className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                保存归因
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <RecordDecisionDialog
          model={editTarget.model}
          target={editTarget.target}
          existing={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={onChanged}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除决策"
          body={`将删除「${deleteTarget.target}」的这条决策记录，删除后不可恢复。`}
          confirmLabel="删除"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
