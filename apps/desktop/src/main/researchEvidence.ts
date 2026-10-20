// Decision evidence for the weekly review: what happened after each open
// decision was recorded. Pure formatting + best-effort data reads; network
// failures degrade to an explicit "data unavailable" line instead of blocking
// the review task.

import type {
  MacroKlinePoint,
  ResearchDecision,
  ResearchEvidence,
  RotationSignal,
} from '@workbench/shared';

import { macroStore } from './macro';

const MAX_EVIDENCE_DECISIONS = 10;
const MAX_INDUSTRY_DETAILS = 5;
const SERIES_DAYS = 120;
const BENCHMARK_SECID = '1.000300';

function fmtNum(v: number | null, digits = 2): string {
  return v === null ? '—' : v.toFixed(digits);
}

function fmtPct01(v: number | null): string {
  if (v === null) return '—';
  const pct = v * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Values already expressed in percent (quotes, board change). */
function fmtPct(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtYi(v: number | null): string {
  return v === null ? '—' : `${(v / 1e8).toFixed(2)} 亿`;
}

function fmtScoreDelta(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

function signalLabel(signal: RotationSignal): string {
  return { overweight: '超配', neutral: '中性', underweight: '低配' }[signal];
}

/** Cumulative return from the first close on/after the decision date. */
export function returnSince(points: readonly MacroKlinePoint[], sinceISO: string): number | null {
  const since = sinceISO.slice(0, 10);
  const first = points.find((p) => p.date >= since);
  const last = points[points.length - 1];
  if (!first || !last || first.close <= 0) return null;
  return ((last.close - first.close) / first.close) * 100;
}

/**
 * Build one evidence block per open decision (max 10). Rotation decisions use
 * the CSI industry series + HS300; industry decisions use the Eastmoney board
 * series (max 5 detail fetches).
 */
export async function buildDecisionEvidence(
  decisions: readonly ResearchDecision[],
): Promise<ResearchEvidence[]> {
  const snapshot = macroStore.getSnapshot();
  const open = decisions.filter((d) => d.status === 'open').slice(0, MAX_EVIDENCE_DECISIONS);
  const seriesCache = new Map<string, Promise<MacroKlinePoint[]>>();
  const series = (secid: string): Promise<MacroKlinePoint[]> => {
    const hit = seriesCache.get(secid);
    if (hit) return hit;
    const pending = macroStore.getSeries(secid, SERIES_DAYS);
    seriesCache.set(secid, pending);
    return pending;
  };
  let industryDetails = 0;

  return Promise.all(
    open.map(async (decision) => {
      const lines: string[] = [];
      const since = decision.createdAt.slice(0, 10);

      if (decision.model === 'rotation') {
        const row = snapshot.data.rotation.find((r) => r.name === decision.target);
        if (!row) {
          lines.push('当前中证十大行业中未找到该行业，无法计算决策后表现。');
        } else {
          lines.push(
            `当前评分 ${fmtNum(row.score)} / 信号 ${
              row.signal ? signalLabel(row.signal) : '—'
            } / 较上一交易日 ${fmtScoreDelta(row.scoreDelta)} / 60日收益 ${fmtPct01(
              row.ret60,
            )} / 相对沪深300 ${fmtPct01(row.rs60)}`,
          );
          const [own, bench] = await Promise.all([
            series(row.secid).catch(() => [] as MacroKlinePoint[]),
            series(BENCHMARK_SECID).catch(() => [] as MacroKlinePoint[]),
          ]);
          const ownRet = returnSince(own, since);
          const benchRet = returnSince(bench, since);
          if (ownRet === null) {
            lines.push('决策日至今行情不足（决策日无可用收盘价）。');
          } else if (benchRet === null) {
            lines.push(`决策日至今：行业 ${fmtPct(ownRet)}（同期沪深300 数据不足）。`);
          } else {
            lines.push(
              `决策日至今：行业 ${fmtPct(ownRet)} / 沪深300 ${fmtPct(
                benchRet,
              )} / 超额 ${fmtPct(ownRet - benchRet)}`,
            );
          }
        }
      } else {
        const board = snapshot.data.boards.find((b) => b.name === decision.target);
        if (!board) {
          lines.push('当前东财板块列表中未找到该板块，无法计算决策后表现。');
        } else {
          lines.push(
            `当前板块涨跌 ${fmtPct(board.changePct)} / PE ${fmtNum(
              board.pe,
            )} / 主力净流入 ${fmtYi(board.mainInflow)}`,
          );
          if (industryDetails < MAX_INDUSTRY_DETAILS) {
            industryDetails++;
            const detail = await macroStore.getIndustry(board).catch(() => null);
            const ret = detail ? returnSince(detail.klines, since) : null;
            if (ret === null) lines.push('决策日至今行情不足，暂无法计算板块收益。');
            else lines.push(`决策日至今：板块 ${fmtPct(ret)}`);
          }
        }
      }

      return { decisionId: decision.id, lines };
    }),
  );
}
