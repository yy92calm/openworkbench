// Pricing detail dialog for one Eastmoney board (opened from the treemap):
// quote + valuation summary, 120-day trend, top-10 constituents, and the two
// conversation actions. The detail payload is fetched on click and cached.

import type { MacroBoard, MacroIndustryDetail } from '@workbench/shared';
import { X } from 'lucide-react';
import { useEffect } from 'react';

import { cn } from '@/lib/cn';

import { Sparkline } from './IndicatorCard';

function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(2)}%`;
}

// `undefined` tolerated: snapshots cached before a field existed omit it.
function num(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? '—' : v.toFixed(digits);
}

function yi(v: number | null): string {
  return v === null ? '—' : `${(v / 1e8).toFixed(2)} 亿`;
}

/** A-share convention: red = up, green = down. */
function tone(v: number | null): string {
  if (v === null) return 'text-muted';
  return v >= 0 ? 'text-rise' : 'text-fall';
}

const METRIC_GRID = 'grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5';
const CONSTITUENT_GRID = 'grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr_0.6fr_0.6fr] gap-2';

export function IndustryDialog({
  board,
  detail,
  loading,
  onClose,
  onAnalyze,
  onDecision,
}: {
  board: MacroBoard;
  detail: MacroIndustryDetail | null;
  loading: boolean;
  onClose: () => void;
  onAnalyze: () => void;
  onDecision: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const closes = detail?.klines.map((p) => p.close) ?? [];

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={`${board.name} 定价明细`}
        className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col rounded-card border border-border bg-surface p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text">{board.name}</span>
          <span className="font-mono text-[11px] text-muted">{board.code}</span>
          <span className={cn('font-mono text-[13px]', tone(board.changePct))}>
            {pct(board.changePct)}
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

        {loading || !detail ? (
          <div className="mt-3 h-[300px] animate-pulse rounded-card bg-surface-2" />
        ) : (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
            <div className={cn('grid', METRIC_GRID)}>
              {(
                [
                  ['换手率', pct(board.turnover)],
                  ['主力净流入', yi(board.mainInflow)],
                  ['总市值', yi(board.mcap)],
                  [
                    '板块 PE',
                    num(board.pe),
                    detail.pePercentile === null
                      ? undefined
                      : `TOP100 分位 ${detail.pePercentile}%`,
                  ],
                  ['成分股 PE / PB 中位', `${num(detail.peMedian)} / ${num(detail.pbMedian)}`],
                ] as const
              ).map(([label, value, sub]) => (
                <div
                  key={label}
                  className="rounded-card border border-border-soft bg-bg/40 px-2.5 py-1.5"
                >
                  <div className="text-[11px] text-muted">{label}</div>
                  <div className="mt-0.5 font-mono text-[13px] text-text">{value}</div>
                  {sub && <div className="text-[10px] text-muted/80">{sub}</div>}
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-muted">
              估值口径：板块 PE 为东财板块口径；分位为市值 TOP100 板块截面（仅正 PE）；
              成分股中位取市值 TOP20、剔除负值与缺失。
            </div>

            {closes.length > 1 && detail && (
              <div className="mt-3 rounded-card border border-border-soft bg-bg/40 p-2">
                <Sparkline values={closes} className="h-12 w-full" />
                <div className="mt-1 flex justify-between text-[11px] text-muted">
                  <span>{detail.klines[0].date}</span>
                  <span>近 120 个交易日</span>
                  <span>{detail.klines[detail.klines.length - 1].date}</span>
                </div>
              </div>
            )}

            {detail.constituents.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-card border border-border-soft">
                <div
                  className={cn(
                    'grid border-b border-border-soft px-3 py-1.5 text-[11px] text-muted',
                    CONSTITUENT_GRID,
                  )}
                >
                  <span>成分股 TOP10（按市值）</span>
                  <span className="text-right">市值</span>
                  <span className="text-right">涨跌</span>
                  <span className="text-right">PE</span>
                  <span className="text-right">PB</span>
                  <span className="text-right">代码</span>
                </div>
                {detail.constituents.slice(0, 10).map((c) => (
                  <div
                    key={c.code}
                    className={cn(
                      'grid items-center border-b border-border-soft px-3 py-1.5 last:border-b-0',
                      CONSTITUENT_GRID,
                    )}
                  >
                    <span className="truncate text-[12px] text-text">{c.name}</span>
                    <span className="text-right font-mono text-[11px] text-muted">
                      {yi(c.mcap)}
                    </span>
                    <span className={cn('text-right font-mono text-[11px]', tone(c.changePct))}>
                      {pct(c.changePct)}
                    </span>
                    <span className="text-right font-mono text-[11px] text-text">{num(c.pe)}</span>
                    <span className="text-right font-mono text-[11px] text-text">{num(c.pb)}</span>
                    <span className="text-right font-mono text-[11px] text-muted">{c.code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDecision}
            className="rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
          >
            记录决策
          </button>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={!detail}
            className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            交给对话解析
          </button>
        </div>
      </div>
    </div>
  );
}
