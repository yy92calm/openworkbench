import type { RotationRow, RotationSignal } from '@workbench/shared';

import { cn } from '@/lib/cn';

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(2)}%`;
}

/** A-share convention: red = up, green = down. */
function tone(v: number | null): string {
  if (v === null) return 'text-muted';
  return v >= 0 ? 'text-rise' : 'text-fall';
}

const SIGNAL_STYLE: Record<RotationSignal, string> = {
  overweight: 'bg-rise/10 text-rise ring-1 ring-rise/30',
  neutral: 'bg-surface-2 text-muted ring-1 ring-border',
  underweight: 'bg-fall/10 text-fall ring-1 ring-fall/30',
};

const SIGNAL_LABEL: Record<RotationSignal, string> = {
  overweight: '超配',
  neutral: '中性',
  underweight: '低配',
};

/** Annualized 60-day volatility at or above this is tagged 高波动 (display only). */
const HIGH_VOL = 0.45;

function fmtVol(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function ScoreCell({ row }: { row: RotationRow }) {
  if (row.score === null) {
    return <span className="text-[12px] text-muted">—</span>;
  }
  // Snapshots cached before scoreDelta existed carry undefined; treat as null.
  const delta = row.scoreDelta ?? null;
  return (
    <span className="inline-flex items-baseline justify-end gap-1">
      <span className="font-mono text-[13px] text-text">{row.score}</span>
      {delta !== null && delta !== 0 && (
        <span
          className={cn('font-mono text-[10px]', delta > 0 ? 'text-rise' : 'text-fall')}
          title="较上一交易日评分变化"
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </span>
  );
}

const GRID = 'grid-cols-[1.4fr_0.8fr_0.9fr_0.7fr_0.6fr_0.7fr_1.1fr]';

/** Rotation model table: transparent signals per CSI top-10 industry. */
export function RotationTable({
  rows,
  onDecision,
}: {
  rows: RotationRow[];
  onDecision: (row: RotationRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <div className="min-w-[720px]">
        <div
          className={cn(
            'grid gap-2 border-b border-border-soft px-3 py-1.5 text-[11px] text-muted',
            GRID,
          )}
        >
          <span>行业</span>
          <span className="text-right">60 日</span>
          <span className="text-right">相对沪深300</span>
          <span className="text-right">波动</span>
          <span className="text-right">趋势</span>
          <span className="text-right">评分</span>
          <span className="text-right">信号 / 操作</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.secid}
            className={cn(
              'group grid items-center gap-2 border-b border-border-soft px-3 py-1.5 last:border-b-0 hover:bg-surface-2',
              GRID,
            )}
          >
            <span className="truncate text-[13px] text-text">{r.name}</span>
            <span className={cn('text-right font-mono text-[12px]', tone(r.ret60))}>
              {pct(r.ret60)}
            </span>
            <span className={cn('text-right font-mono text-[12px]', tone(r.rs60))}>
              {pct(r.rs60)}
            </span>
            <span className="text-right">
              <span className="font-mono text-[12px] text-muted">{fmtVol(r.vol60)}</span>
              {r.vol60 !== null && r.vol60 >= HIGH_VOL && (
                <span
                  className="ml-1 rounded-full bg-warn/10 px-1 py-0.5 text-[10px] text-warn ring-1 ring-warn/30"
                  title="年化 60 日波动 ≥45%，配置需控制仓位与回撤"
                >
                  高波动
                </span>
              )}
            </span>
            <span className="text-right text-[12px] text-muted">
              {r.trend === null ? '—' : r.trend ? '线上' : '线下'}
            </span>
            <span className="text-right">
              <ScoreCell row={r} />
            </span>
            <span className="flex items-center justify-end gap-2">
              {r.signal === null ? (
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-border">
                  数据不足
                </span>
              ) : (
                <span
                  className={cn('rounded-full px-1.5 py-0.5 text-[11px]', SIGNAL_STYLE[r.signal])}
                >
                  {SIGNAL_LABEL[r.signal]}
                </span>
              )}
              <button
                type="button"
                onClick={() => onDecision(r)}
                className="hidden text-[11px] text-muted hover:text-text group-hover:inline"
              >
                记录决策
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
