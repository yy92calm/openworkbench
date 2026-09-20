import type { MacroBoard, MacroIndustryDetail } from '@workbench/shared';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

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

/** Industry model: pick an Eastmoney board, inspect its pricing data. */
export function IndustryPanel({
  boards,
  selected,
  detail,
  loading,
  onSelect,
  onAnalyze,
  onDecision,
}: {
  boards: MacroBoard[];
  selected: MacroBoard | null;
  detail: MacroIndustryDetail | null;
  loading: boolean;
  onSelect: (board: MacroBoard) => void;
  onAnalyze: () => void;
  onDecision: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? boards.filter((b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q))
      : boards;
    return list.slice(0, 30);
  }, [boards, query]);

  const closes = detail?.klines.map((p) => p.close) ?? [];

  return (
    <div className="grid gap-2 lg:grid-cols-[280px_1fr]">
      <div className="relative self-start">
        <div className="flex items-center gap-1.5 rounded-input border border-border bg-surface px-2 py-1.5">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="搜索行业（东财细分，市值 TOP100）"
            className="w-full bg-transparent text-[12px] text-text outline-none placeholder:text-muted"
          />
        </div>
        {open && (
          <div className="absolute z-50 mt-1 max-h-[320px] w-full overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card">
            {matches.length === 0 && (
              <div className="px-2 py-3 text-[12px] text-muted">无匹配行业</div>
            )}
            {matches.map((b) => (
              <button
                key={b.code}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(b);
                  setOpen(false);
                  setQuery('');
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left hover:bg-surface-2',
                  selected?.code === b.code && 'bg-accent/5',
                )}
              >
                <span className="flex-1 truncate text-[12px] text-text">{b.name}</span>
                <span className={cn('font-mono text-[11px]', tone(b.changePct))}>
                  {pct(b.changePct)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-card border border-border bg-surface p-3">
        {!selected ? (
          <div className="flex min-h-[180px] items-center justify-center text-[12px] text-muted">
            选择左侧行业，查看行情、估值与成分股定价数据
          </div>
        ) : (
          <>
            <div className="group flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium text-text">{selected.name}</span>
              <span className="font-mono text-[11px] text-muted">{selected.code}</span>
              <span className={cn('font-mono text-[13px]', tone(selected.changePct))}>
                {pct(selected.changePct)}
              </span>
              <span className="flex-1" />
              <span className="hidden items-center gap-2 group-hover:flex">
                <button
                  type="button"
                  onClick={onDecision}
                  className="rounded-input border border-border px-2.5 py-1 text-[12px] text-text hover:bg-surface-2"
                >
                  记录决策
                </button>
                <button
                  type="button"
                  onClick={onAnalyze}
                  disabled={!detail}
                  className="rounded-input bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  交给对话解析
                </button>
              </span>
            </div>

            {loading || !detail ? (
              <div className="mt-3 h-[180px] animate-pulse rounded bg-surface-2" />
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {(
                    [
                      ['换手率', pct(selected.turnover)],
                      ['主力净流入', yi(selected.mainInflow)],
                      ['总市值', yi(selected.mcap)],
                      [
                        '板块 PE',
                        num(selected.pe),
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

                {closes.length > 1 && (
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
                    <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr_0.6fr_0.6fr] gap-2 border-b border-border-soft px-3 py-1.5 text-[11px] text-muted">
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
                        className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr_0.6fr_0.6fr] items-center gap-2 border-b border-border-soft px-3 py-1.5 last:border-b-0"
                      >
                        <span className="truncate text-[12px] text-text">{c.name}</span>
                        <span className="text-right font-mono text-[11px] text-muted">
                          {yi(c.mcap)}
                        </span>
                        <span className={cn('text-right font-mono text-[11px]', tone(c.changePct))}>
                          {pct(c.changePct)}
                        </span>
                        <span className="text-right font-mono text-[11px] text-text">
                          {num(c.pe)}
                        </span>
                        <span className="text-right font-mono text-[11px] text-text">
                          {num(c.pb)}
                        </span>
                        <span className="text-right font-mono text-[11px] text-muted">
                          {c.code}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
