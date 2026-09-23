// Shenwan level-1 industry panorama: 31 rows of live quotes, valuation and
// the same transparent rotation score as the CSI table. Rows are grouped by
// signal and carry a score bar / turnover-share bar / change chip so the
// strongest, weakest and money-magnet industries read at a glance. Clicking a
// row opens the detail dialog (~85 trading days of closes + metrics + actions).

import type { RotationSignal, SwIndustryRow } from '@workbench/shared';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

import { type MacroSeriesPoint, TrendChart } from './IndicatorDialog';
import { SIGNAL_LABEL, SIGNAL_STYLE } from './RotationTable';

function num(v: number | null, digits = 2): string {
  return v === null ? '—' : v.toFixed(digits);
}

/** Percent-unit value (quotes/valuation already come as percent). */
function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(2)}%`;
}

function signedPct(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** Decimal ratio (60-day return) → signed percent. */
function signedRatio(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
}

/** A-share convention: red = up, green = down. */
function tone(v: number | null): string {
  if (v === null) return 'text-muted';
  return v >= 0 ? 'text-rise' : 'text-fall';
}

const GRID = 'grid-cols-[1.05fr_0.62fr_0.95fr_0.6fr_0.5fr_0.5fr_0.68fr_1.12fr_0.93fr]';

/** Signal groups in rotation order (rows arrive sorted by score). */
const GROUPS: { signal: RotationSignal | null; label: string }[] = [
  { signal: 'overweight', label: '超配' },
  { signal: 'neutral', label: '中性' },
  { signal: 'underweight', label: '低配' },
  { signal: null, label: '未评分' },
];

function barColor(signal: RotationSignal | null): string {
  if (signal === 'overweight') return 'bg-rise/60';
  if (signal === 'underweight') return 'bg-fall/60';
  return 'bg-muted/50';
}

/** 0–100 score bar, colored by the signal bucket. */
function ScoreBar({ score, signal }: { score: number; signal: RotationSignal | null }) {
  return (
    <span className="h-1 w-8 overflow-hidden rounded-full bg-surface-2 ring-1 ring-border/60">
      <span
        className={cn('block h-full rounded-full', barColor(signal))}
        style={{ width: `${score}%` }}
      />
    </span>
  );
}

function Metric({ label, value, toneClass }: { label: string; value: string; toneClass?: string }) {
  return (
    <div className="rounded-card border border-border-soft bg-bg/40 px-2.5 py-1.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-[13px] text-text', toneClass)}>{value}</div>
    </div>
  );
}

function SwIndustryDialog({
  row,
  onClose,
  onQuote,
  onAnalyze,
}: {
  row: SwIndustryRow;
  onClose: () => void;
  onQuote: (row: SwIndustryRow) => void;
  onAnalyze: (row: SwIndustryRow) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const series: MacroSeriesPoint[] = row.history.map((p) => ({ x: p.date, y: p.close }));
  const trend = row.trend === null ? '—' : row.trend ? '20 日线上' : '20 日线下';
  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={`${row.name} 明细`}
        className="w-[620px] max-w-[92vw] rounded-card border border-border bg-surface p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-text">申万{row.name}</span>
          <span className="font-mono text-[11px] text-muted">{row.code}</span>
          <span className={cn('font-mono text-[13px]', tone(row.changePct))}>
            {signedPct(row.changePct)}
          </span>
          <span className="flex-1" />
          <span className="text-[11px] text-muted">截止 {row.asOf}</span>
        </div>

        <div className="mt-3 rounded-card border border-border-soft bg-bg/40 p-3">
          {series.length > 1 ? (
            <TrendChart points={series} />
          ) : (
            <div className="flex h-36 items-center justify-center text-[12px] text-muted">
              暂无历史走势
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          <Metric label="收盘" value={num(row.close)} />
          <Metric label="成交额占比" value={pct(row.amountShare)} />
          <Metric label="换手率" value={pct(row.turnover)} />
          <Metric label="流通市值" value={row.mcap === null ? '—' : `${num(row.mcap, 0)} 亿`} />
          <Metric label="PE" value={num(row.pe)} />
          <Metric label="PB" value={num(row.pb)} />
          <Metric label="股息率" value={pct(row.dividend)} />
          <Metric label="60 日" value={signedRatio(row.ret60)} toneClass={tone(row.ret60)} />
          <Metric label="相对沪深300" value={signedRatio(row.rs60)} toneClass={tone(row.rs60)} />
          <Metric label="波动（年化）" value={row.vol60 === null ? '—' : pct(row.vol60 * 100)} />
          <Metric label="趋势" value={trend} />
          <Metric
            label="评分"
            value={
              row.score === null
                ? '—'
                : `${row.score}${row.signal ? `（${SIGNAL_LABEL[row.signal]}）` : ''}${
                    row.scoreDelta
                      ? ` 较上日 ${row.scoreDelta >= 0 ? '+' : ''}${row.scoreDelta}`
                      : ''
                  }`
            }
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onQuote(row)}
            className="rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
          >
            引用到对话
          </button>
          <button
            type="button"
            onClick={() => onAnalyze(row)}
            className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            交给对话解析
          </button>
        </div>
      </div>
    </div>
  );
}

/** One-line metrics summary for the conversation handoff (quote / analyze). */
export function swMetricsText(r: SwIndustryRow): string {
  const bits = [
    `今日 ${signedPct(r.changePct)}`,
    `PE ${num(r.pe)}`,
    `PB ${num(r.pb)}`,
    `股息率 ${pct(r.dividend)}`,
    `换手 ${pct(r.turnover)}`,
    `成交额占比 ${pct(r.amountShare)}`,
    `60 日 ${signedRatio(r.ret60)}`,
    `评分 ${r.score === null ? '—' : `${r.score}${r.signal ? `（${SIGNAL_LABEL[r.signal]}）` : ''}`}`,
  ];
  return bits.join('，');
}

/** 申万一级行业全景表：信号分组 + 评分 / 占比条 + 涨跌色块。 */
export function SwIndustryTable({
  rows,
  onDecision,
  onQuote,
  onAnalyze,
}: {
  rows: SwIndustryRow[];
  onDecision: (row: SwIndustryRow) => void;
  onQuote: (row: SwIndustryRow) => void;
  onAnalyze: (row: SwIndustryRow) => void;
}) {
  const [detail, setDetail] = useState<SwIndustryRow | null>(null);
  const maxShare = Math.max(...rows.map((r) => r.amountShare ?? 0), 0.1);
  const groups = GROUPS.map((g) => ({
    ...g,
    rows: rows.filter((r) => (r.signal ?? null) === g.signal),
  })).filter((g) => g.rows.length > 0);
  const shareWidth = (share: number | null): string =>
    share === null ? '0%' : `${Math.max(4, Math.min(100, (share / maxShare) * 100))}%`;

  return (
    <>
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <div className="min-w-[880px]">
          <div className="max-h-[380px] overflow-y-auto">
            <div
              className={cn(
                'sticky top-0 z-10 grid gap-2 border-b border-border-soft bg-surface px-3 py-1.5 text-[11px] text-muted',
                GRID,
              )}
            >
              <span>行业</span>
              <span className="text-right">今日</span>
              <span className="text-right">成交额占比</span>
              <span className="text-right">换手</span>
              <span className="text-right">PE</span>
              <span className="text-right">股息</span>
              <span className="text-right">60 日</span>
              <span className="text-right">评分</span>
              <span className="text-right">信号 / 操作</span>
            </div>

            {groups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center gap-2 border-b border-border-soft bg-surface-2/60 px-3 py-1 text-[11px] text-muted">
                  <span className="font-medium">{group.label}</span>
                  <span className="font-mono">{group.rows.length}</span>
                  <span className="h-px flex-1 bg-border-soft" />
                </div>
                {group.rows.map((r) => (
                  <div
                    key={r.code}
                    onClick={() => setDetail(r)}
                    title="点击查看走势与明细"
                    className={cn(
                      'group grid cursor-pointer items-center gap-2 border-b border-border-soft px-3 py-1.5 last:border-b-0 hover:bg-surface-2',
                      GRID,
                    )}
                  >
                    <span className="truncate text-[13px] text-text">{r.name}</span>
                    <span className="text-right">
                      <span
                        className={cn(
                          'inline-block rounded px-1.5 font-mono text-[12px]',
                          r.changePct === null
                            ? 'text-muted'
                            : r.changePct >= 0
                              ? 'bg-rise/5 text-rise'
                              : 'bg-fall/5 text-fall',
                        )}
                      >
                        {signedPct(r.changePct)}
                      </span>
                    </span>
                    <span className="flex items-center justify-end gap-1.5">
                      <span className="h-1 w-6 overflow-hidden rounded-full bg-surface-2 ring-1 ring-border/60">
                        <span
                          className="block h-full rounded-full bg-muted/60"
                          style={{ width: shareWidth(r.amountShare) }}
                        />
                      </span>
                      <span className="font-mono text-[11px] text-muted">{pct(r.amountShare)}</span>
                    </span>
                    <span className="text-right font-mono text-[11px] text-muted">
                      {pct(r.turnover)}
                    </span>
                    <span className="text-right font-mono text-[11px] text-muted">{num(r.pe)}</span>
                    <span className="text-right font-mono text-[11px] text-muted">
                      {pct(r.dividend)}
                    </span>
                    <span className={cn('text-right font-mono text-[11px]', tone(r.ret60))}>
                      {signedRatio(r.ret60)}
                    </span>
                    <span className="text-right">
                      {r.score === null ? (
                        <span className="text-[12px] text-muted">—</span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <ScoreBar score={r.score} signal={r.signal} />
                          <span className="font-mono text-[13px] text-text">{r.score}</span>
                          {r.scoreDelta !== null && r.scoreDelta !== 0 && (
                            <span
                              className={cn(
                                'font-mono text-[10px]',
                                r.scoreDelta > 0 ? 'text-rise' : 'text-fall',
                              )}
                              title="较上一交易日评分变化"
                            >
                              {r.scoreDelta > 0 ? `+${r.scoreDelta}` : r.scoreDelta}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center justify-end gap-2">
                      {r.signal === null ? (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-border">
                          数据不足
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[11px]',
                            SIGNAL_STYLE[r.signal],
                          )}
                        >
                          {SIGNAL_LABEL[r.signal]}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDecision(r);
                        }}
                        className="hidden text-[11px] text-muted hover:text-text group-hover:inline"
                      >
                        记录决策
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {detail && (
        <SwIndustryDialog
          row={detail}
          onClose={() => setDetail(null)}
          onQuote={(r) => {
            setDetail(null);
            onQuote(r);
          }}
          onAnalyze={(r) => {
            setDetail(null);
            onAnalyze(r);
          }}
        />
      )}
    </>
  );
}
