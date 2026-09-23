import type {
  MacroBoard,
  MacroIndicator,
  MacroIndustryDetail,
  MacroNotification,
  MacroQuote,
  MacroSourceId,
  MacroSourceState,
  MacroThemeId,
  MacroYieldPoint,
  ResearchContext,
  ResearchDecision,
  SwIndustryRow,
} from '@workbench/shared';
import {
  buildCoreIndicatorLines,
  buildIndicatorLine,
  buildIndustryPrompt,
  buildMacroReportMarkdown,
  buildMacroSignalView,
  buildReviewPrompt,
  buildRotationPrompt,
  buildSwConclusion,
  digestCharCount,
} from '@workbench/shared';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { DecisionLedger } from '@/components/macro/DecisionLedger';
import { ExportMenu } from '@/components/macro/ExportMenu';
import { IndicatorCard } from '@/components/macro/IndicatorCard';
import { IndicatorDialog } from '@/components/macro/IndicatorDialog';
import { IndustryDialog } from '@/components/macro/IndustryDialog';
import { IndustryTreemap } from '@/components/macro/IndustryTreemap';
import { NotificationsMenu } from '@/components/macro/NotificationsMenu';
import { RecordDecisionDialog } from '@/components/macro/RecordDecisionDialog';
import { ReportSection } from '@/components/macro/ReportSection';
import { RotationTable } from '@/components/macro/RotationTable';
import { SwIndustryTable, swMetricsText } from '@/components/macro/SwIndustryTable';
import { cn } from '@/lib/cn';
import {
  macroExportReport,
  macroIndustry,
  macroRegenerate,
  macroSeries,
  researchDecisions,
  researchDigest,
} from '@/lib/electron';
import { useRuntimeStore } from '@/lib/runtime';
import { useUiStore } from '@/lib/store';
import { toast } from '@/lib/toast';
import { useMacroDashboard } from '@/lib/useMacroDashboard';
import { useMacroReports } from '@/lib/useMacroReports';

const MACRO_META: Record<string, string> = {
  cpi: '全国同比 %，来源：国家统计局（东财数据中心）',
  ppi: '同比 %，来源：国家统计局（东财数据中心）',
  pmi: '官方制造业 PMI，来源：国家统计局（东财数据中心）',
  'pmi-non-mfg': '官方非制造业 PMI，来源：国家统计局（东财数据中心）',
  gdp: '累计同比 %，来源：国家统计局（东财数据中心）',
};

const YIELD_FIELDS: Record<string, keyof MacroYieldPoint> = {
  cn2y: 'cn2y',
  cn5y: 'cn5y',
  cn10y: 'cn10y',
  cn30y: 'cn30y',
  cn10y2y: 'cn10y2y',
  us10y: 'us10y',
};

function fmtTime(iso: string | null): string {
  if (!iso) return '暂无数据';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '暂无数据';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function quoteValue(q: MacroQuote): string {
  return q.price === null ? '—' : q.price.toFixed(2);
}

function quoteLine(q: MacroQuote): string {
  if (q.price === null) return '';
  const chg = q.changePct;
  const chgTxt = typeof chg === 'number' ? `（${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%）` : '';
  return buildIndicatorLine(q.name, `${quoteValue(q)}${chgTxt}`);
}

/** KPI tile used by the executive overview. */
function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'rise' | 'fall' }) {
  return (
    <div className="rounded-card border border-border-soft bg-bg/40 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-[16px] leading-tight tabular-nums',
          tone === 'rise' ? 'text-rise' : tone === 'fall' ? 'text-fall' : 'text-text',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** One signal row of the overview: a bucket label plus industry chips. */
function SignalChips({
  label,
  tone,
  names,
}: {
  label: string;
  tone: 'rise' | 'fall';
  names: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
          tone === 'rise'
            ? 'bg-rise/10 text-rise ring-rise/30'
            : 'bg-fall/10 text-fall ring-fall/30',
        )}
      >
        {label}
      </span>
      {names.length === 0 ? (
        <span className="text-[12px] text-muted">暂无</span>
      ) : (
        names.map((name) => (
          <span
            key={name}
            className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-text ring-1 ring-border"
          >
            {name}
          </span>
        ))
      )}
    </div>
  );
}

interface DialogTarget {
  /** Request token: late series responses never touch a newer dialog. */
  token: number;
  loading: boolean;
  title: string;
  value: string;
  sub?: string;
  meta?: string;
  quoteLine: string;
  series: { x: string; y: number }[] | null;
  /** Set when the series must be fetched on open (index / FX daily closes). */
  secid?: string;
}

/** Section shell: skeleton only when there is nothing cached to show. */
function Section({
  title,
  state,
  hasData,
  onQuoteAll,
  children,
}: {
  title: string;
  state: MacroSourceState;
  hasData: boolean;
  onQuoteAll?: () => void;
  children: ReactNode;
}) {
  // idle = the first snapshot has not arrived yet; show the same skeleton as
  // loading so the section never flashes empty.
  const pending = state.status === 'loading' || state.status === 'idle';
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[13px] font-medium text-text">{title}</h2>
        {state.status === 'loading' && hasData && (
          <span className="text-[11px] text-accent">更新中…</span>
        )}
        {state.status === 'error' && <span className="text-[11px] text-error">数据源暂不可用</span>}
        <span className="flex-1" />
        {onQuoteAll && hasData && (
          <button
            type="button"
            onClick={onQuoteAll}
            className="text-[11px] text-muted hover:text-text"
          >
            引用本组
          </button>
        )}
      </div>
      {!hasData && pending ? (
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[70px] animate-pulse rounded-card border border-border bg-surface-2"
              />
            ))}
          </div>
          <div className="mt-1.5 text-center text-[11px] text-muted">
            正在获取数据，完成后自动展示（无需等待，其余分区可用）…
          </div>
        </div>
      ) : !hasData && state.status === 'error' ? (
        <div className="rounded-card border border-border bg-surface px-3 py-6 text-center text-[12px] text-muted">
          数据源暂不可用，稍后刷新重试。
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function MacroInsightsPage() {
  const { snapshot, loading, refresh } = useMacroDashboard();
  const { reports } = useMacroReports();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const dialogTokenRef = useRef(0);
  const [showBase, setShowBase] = useState(false);
  const [showFlows, setShowFlows] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<MacroBoard | null>(null);
  const [industry, setIndustry] = useState<MacroIndustryDetail | null>(null);
  const [industryLoading, setIndustryLoading] = useState(false);
  const [decisions, setDecisions] = useState<ResearchDecision[]>([]);
  const [digest, setDigest] = useState<string | null>(null);
  const [record, setRecord] = useState<{ model: 'rotation' | 'industry'; target: string } | null>(
    null,
  );

  const reloadResearch = useCallback(async () => {
    const [list, knowledge] = await Promise.all([researchDecisions(), researchDigest()]);
    setDecisions(list);
    setDigest(knowledge);
  }, []);

  useEffect(() => {
    void reloadResearch();
  }, [reloadResearch]);

  /** The research context injected into every model prompt (state-backed). */
  const researchCtx = (): ResearchContext => ({ decisions, digest });

  const quote = (lines: string[]) => {
    const text = lines.filter((l) => l.trim().length > 0).join('\n');
    if (!text) return;
    useUiStore.getState().setComposerDraft(text);
    navigate('/live');
  };

  const openSession = async (prompt: string) => {
    if (!prompt) return;
    useRuntimeStore.getState().startDraft();
    const id = await useRuntimeStore.getState().sendPrompt(prompt);
    if (id) navigate(`/live/${id}`);
  };

  const generateRotation = async () => openSession(buildRotationPrompt(snapshot, researchCtx()));

  const generateIndustry = async () => {
    if (!industry) return;
    openSession(buildIndustryPrompt(industry, snapshot, researchCtx()));
  };

  const reviewLoop = async () => openSession(buildReviewPrompt(researchCtx()));

  /** Re-run a theme's background task (generation belongs to the backend). */
  const regenerate = async (themeId: MacroThemeId) => {
    const result = await macroRegenerate(themeId);
    if (result.ok) {
      toast.success('已在后台重新生成，完成后推送简报');
    } else {
      toast.error(
        result.reason === 'runtime-not-ready' ? '运行时未就绪，请稍后重试' : '触发失败，请稍后重试',
      );
    }
  };

  // ---- Shenwan level-1 panorama: quote / hand off to the conversation ----

  const quoteSw = (r: SwIndustryRow) => {
    quote([buildIndicatorLine(`申万一级 ${r.name}`, `${swMetricsText(r)}（截止 ${r.asOf}）`)]);
  };

  const analyzeSw = (r: SwIndustryRow) => {
    const focused = `请特别关注申万一级行业「${r.name}」（${r.code}）：${swMetricsText(r)}。\n\n`;
    void openSession(focused + buildRotationPrompt(snapshot, researchCtx()));
  };

  // ---- Leadership report exports (same markdown for copy and file) ----
  const reportMarkdown = () => buildMacroReportMarkdown(snapshot, decisions, digest);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportMarkdown());
      toast.success('汇报摘要已复制到剪贴板');
    } catch {
      toast.error('复制失败，请改用「导出摘要」');
    }
  };

  const exportReport = async () => {
    const result = await macroExportReport(reportMarkdown());
    if (result) toast.success(`汇报已导出到工作区 ${result.path}`);
    else toast.error('导出失败');
  };

  /** Print in the light theme (dark themes print poorly / waste ink). */
  const printReport = () => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = 'light';
    const restore = () => {
      if (prev === undefined) delete root.dataset.theme;
      else root.dataset.theme = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  };

  const selectIndustry = async (board: MacroBoard) => {
    setSelectedBoard(board);
    setIndustry(null);
    setIndustryLoading(true);
    const detail = await macroIndustry(board);
    setIndustry(detail);
    setIndustryLoading(false);
  };

  const openDialog = (target: Omit<DialogTarget, 'token' | 'loading'>) => {
    const token = ++dialogTokenRef.current;
    const needsSeries = !target.series && Boolean(target.secid);
    setDialog({ ...target, token, loading: needsSeries });
    if (!needsSeries || !target.secid) return;
    const secid = target.secid;
    void macroSeries(secid, 120).then((points) => {
      // Drop responses that belong to a dialog the user already replaced.
      if (dialogTokenRef.current !== token) return;
      setDialog((cur) =>
        cur && cur.token === token
          ? {
              ...cur,
              series: points.map((p) => ({ x: p.date, y: p.close })),
              secid: undefined,
              loading: false,
            }
          : cur,
      );
    });
  };

  const closeDialog = () => {
    dialogTokenRef.current += 1;
    setDialog(null);
  };

  const sourceState = (ids: MacroSourceId[]): MacroSourceState => {
    const states = ids
      .map((id) => snapshot?.sources[id])
      .filter((s): s is MacroSourceState => Boolean(s));
    if (states.some((s) => s.status === 'ready')) return { status: 'ready' };
    if (states.some((s) => s.status === 'loading')) return { status: 'loading' };
    if (states.length > 0 && states.every((s) => s.status === 'error')) {
      return { status: 'error', error: states.find((s) => s.error)?.error };
    }
    return { status: 'idle' };
  };

  const handleNotification = (n: MacroNotification) => {
    if (n.kind === 'briefing' && n.sessionId) navigate(`/live/${n.sessionId}`);
  };

  // ---- Dashboard data shorthands ----
  const indices = snapshot?.data.indices ?? [];
  const funds = snapshot?.data.funds ?? { indices: [], top: [] };
  const macro = snapshot?.data.macro ?? [];
  const yields = snapshot?.data.yields ?? [];
  const latestYield = yields.length > 0 ? yields[yields.length - 1] : null;
  const fx = snapshot?.data.fx ?? null;
  const rotation = snapshot?.data.rotation ?? [];
  const swRows = snapshot?.data.swIndustries ?? [];
  const swConclusion = buildSwConclusion(swRows);
  const boards = snapshot?.data.boards ?? [];
  const flowTop = [...boards]
    .sort((a, b) => (b.mainInflow ?? -Infinity) - (a.mainInflow ?? -Infinity))
    .slice(0, 10);

  // ---- Executive overview numbers ----
  const readySources = Object.values(snapshot?.sources ?? {}).filter(
    (s) => s.status === 'ready',
  ).length;
  const totalSources = Object.keys(snapshot?.sources ?? {}).length;
  const signalCounts = {
    over: rotation.filter((r) => r.signal === 'overweight').length,
    neutral: rotation.filter((r) => r.signal === 'neutral').length,
    under: rotation.filter((r) => r.signal === 'underweight').length,
  };
  const digestChars = digestCharCount(digest);
  const signalView = buildMacroSignalView(snapshot);

  // ---- Collapsed data-base summary (one glance instead of 23 cards) ----
  const quoteBrief = (secid: string): string | null => {
    const q = indices.find((i) => i.secid === secid);
    if (!q || q.price === null) return null;
    const chg =
      typeof q.changePct === 'number'
        ? ` ${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`
        : '';
    return `${q.name} ${q.price.toFixed(2)}${chg}`;
  };
  const cn10y = latestYield?.cn10y;
  const baseBits = [
    totalSources > 0 ? `${readySources}/${totalSources} 源` : null,
    quoteBrief('1.000001'),
    quoteBrief('1.000300'),
    typeof cn10y === 'number' ? `中债 10Y ${cn10y}%` : null,
    fx && fx.price !== null ? `${fx.name} ${fx.price}` : null,
  ].filter((s): s is string => Boolean(s));
  const baseSummary = baseBits.length > 0 ? baseBits.join(' · ') : '数据加载中…';

  const openIndexDialog = (q: MacroQuote) => {
    const series = snapshot?.data.klines[q.secid]?.map((p) => ({ x: p.date, y: p.close })) ?? null;
    openDialog({
      title: q.name,
      value: quoteValue(q),
      sub:
        typeof q.changePct === 'number'
          ? `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`
          : undefined,
      meta: `行情来源：东方财富（${q.secid}）`,
      quoteLine: quoteLine(q),
      series,
      secid: series ? undefined : q.secid,
    });
  };

  const openYieldDialog = (label: string, id: string) => {
    const field = YIELD_FIELDS[id];
    const series = yields.flatMap((p) => {
      const v = p[field];
      return typeof v === 'number' ? [{ x: p.date, y: v }] : [];
    });
    const latest = latestYield?.[field];
    openDialog({
      title: label,
      value: typeof latest === 'number' ? `${latest}%` : '—',
      sub: latestYield?.date,
      meta: '来源：中债 / 美债收益率（东财数据中心）',
      quoteLine: buildIndicatorLine(label, `${latest}%`, latestYield?.date),
      series,
    });
  };

  const openMacroDialog = (ind: MacroIndicator) => {
    const series = ind.history.flatMap((p) =>
      typeof p.value === 'number' ? [{ x: p.date, y: p.value }] : [],
    );
    openDialog({
      title: ind.name,
      value: ind.latest?.value == null ? '—' : `${ind.latest.value}${ind.unit}`,
      sub: ind.latest?.period,
      meta: MACRO_META[ind.id],
      quoteLine:
        ind.latest?.value == null
          ? buildIndicatorLine(ind.name, '暂无数据')
          : buildIndicatorLine(ind.name, `${ind.latest.value}${ind.unit}`, ind.latest.period),
      series,
    });
  };

  const openFxDialog = () => {
    if (!fx) return;
    const date = snapshot?.fetchedAt ? snapshot.fetchedAt.slice(0, 10) : undefined;
    openDialog({
      title: fx.name,
      value: fx.price === null ? '—' : String(fx.price),
      sub: date,
      meta: `汇率来源：东方财富（${fx.pair}）`,
      quoteLine: buildIndicatorLine(fx.name, String(fx.price ?? '—'), date),
      series: null,
      secid: '133.USDCNH',
    });
  };

  return (
    <div className="h-full overflow-y-auto" data-print-root>
      <div className="mx-auto flex max-w-6xl flex-col px-8 py-8">
        <div className="order-1 rounded-card border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-text">宏观洞察</h1>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent ring-1 ring-accent/30">
              AI 投研系统 · 轮动模型 × 行业模型
            </span>
            <span className="flex-1" />
            <span className="text-[12px] text-muted">
              {loading && !snapshot ? '加载中…' : `更新于 ${fmtTime(snapshot?.fetchedAt ?? null)}`}
            </span>
            {snapshot?.refreshing && <span className="text-[12px] text-accent">更新中…</span>}
            <button
              type="button"
              onClick={refresh}
              aria-label="刷新"
              title="刷新"
              className="print-hide rounded-input border border-border p-1.5 text-text hover:bg-surface-2"
            >
              <RefreshCw size={13} className={cn(snapshot?.refreshing && 'animate-spin')} />
            </button>
            <span className="print-hide">
              <ExportMenu
                onCopy={() => void copyReport()}
                onExport={() => void exportReport()}
                onPrint={printReport}
              />
            </span>
            <span className="print-hide">
              <NotificationsMenu onOpen={handleNotification} />
            </span>
          </div>
          {rotation.length > 0 && rotation.some((r) => r.score !== null) ? (
            <>
              <div className="mt-3 flex flex-col gap-1.5">
                <SignalChips label="超配" tone="rise" names={signalView.over} />
                <SignalChips label="低配" tone="fall" names={signalView.under} />
              </div>
              {signalView.change && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{signalView.change}</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              {rotation.length === 0 ? '轮动信号加载中…' : '轮动历史数据不足，等待行情补齐…'}
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            <Kpi
              label="行业覆盖"
              value={
                swRows.length > 0
                  ? `${swRows.length} 申万 · ${rotation.length} 中证 · ${boards.length} 板块`
                  : `${rotation.length} 指数 · ${boards.length} 板块`
              }
            />
            <Kpi
              label="轮动信号"
              value={`超配 ${signalCounts.over} · 中性 ${signalCounts.neutral} · 低配 ${signalCounts.under}`}
            />
            <Kpi label="决策台账" value={`${decisions.length} 条`} />
            <Kpi label="知识资产" value={digestChars > 0 ? `${digestChars} 字` : '待沉淀'} />
            <Kpi label="数据时效" value={`${readySources}/${totalSources} 源`} />
          </div>
        </div>

        <ReportSection
          reports={reports}
          onRegenerate={(themeId) => void regenerate(themeId)}
          onOpenSession={(sessionId) => navigate(`/live/${sessionId}`)}
        />

        <div className="order-7 mt-6">
          <div className="group flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface px-3 py-2">
            <h2 className="text-[13px] font-medium text-text">数据底座 · 模型输入</h2>
            <span className="min-w-0 truncate font-mono text-[11px] text-muted">{baseSummary}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => quote(buildCoreIndicatorLines(snapshot))}
              className="print-hide hidden text-[11px] text-muted hover:text-text group-hover:inline"
            >
              引用核心指标
            </button>
            <button
              type="button"
              onClick={() => setShowBase((v) => !v)}
              className="print-hide flex items-center gap-1 text-[11px] text-muted hover:text-text"
            >
              {showBase ? '收起' : '展开'}
              <ChevronDown
                size={12}
                className={cn('transition-transform', showBase && 'rotate-180')}
              />
            </button>
          </div>
          {showBase && (
            <>
              <Section
                title="市场行情"
                state={sourceState(['indices'])}
                hasData={indices.length > 0}
                onQuoteAll={() => quote(indices.map(quoteLine))}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {indices.map((q) => (
                    <IndicatorCard
                      key={q.secid}
                      label={q.name}
                      value={quoteValue(q)}
                      changePct={q.changePct}
                      spark={snapshot?.data.klines[q.secid]?.map((p) => p.close)}
                      onOpen={() => openIndexDialog(q)}
                      onQuote={() => quote([quoteLine(q)])}
                    />
                  ))}
                </div>
              </Section>

              <Section
                title="利率与汇率"
                state={sourceState(['yields', 'fx'])}
                hasData={Boolean(latestYield || fx)}
                onQuoteAll={() => {
                  const rows = latestYield
                    ? (
                        [
                          ['中债 2Y 收益率', 'cn2y'],
                          ['中债 5Y 收益率', 'cn5y'],
                          ['中债 10Y 收益率', 'cn10y'],
                          ['中债 30Y 收益率', 'cn30y'],
                          ['中债 10Y-2Y 利差', 'cn10y2y'],
                          ['美债 10Y 收益率', 'us10y'],
                        ] as const
                      ).flatMap(([label, id]) => {
                        const v = latestYield[YIELD_FIELDS[id]];
                        return typeof v === 'number'
                          ? [buildIndicatorLine(label, `${v}%`, latestYield.date)]
                          : [];
                      })
                    : [];
                  const fxLine = fx
                    ? [
                        buildIndicatorLine(
                          fx.name,
                          String(fx.price ?? '—'),
                          snapshot?.fetchedAt?.slice(0, 10),
                        ),
                      ]
                    : [];
                  quote([...rows, ...fxLine]);
                }}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {latestYield &&
                    (
                      [
                        ['中债 2Y 收益率', 'cn2y'],
                        ['中债 5Y 收益率', 'cn5y'],
                        ['中债 10Y 收益率', 'cn10y'],
                        ['中债 30Y 收益率', 'cn30y'],
                        ['中债 10Y-2Y 利差', 'cn10y2y'],
                        ['美债 10Y 收益率', 'us10y'],
                      ] as const
                    ).map(([label, id]) => {
                      const v = latestYield[YIELD_FIELDS[id]];
                      return (
                        <IndicatorCard
                          key={id}
                          label={label}
                          value={typeof v === 'number' ? `${v}%` : '—'}
                          sub={latestYield.date}
                          onOpen={() => openYieldDialog(label, id)}
                          onQuote={
                            typeof v === 'number'
                              ? () => quote([buildIndicatorLine(label, `${v}%`, latestYield.date)])
                              : undefined
                          }
                        />
                      );
                    })}
                  {fx && (
                    <IndicatorCard
                      label={fx.name}
                      value={fx.price === null ? '—' : String(fx.price)}
                      sub={snapshot?.fetchedAt?.slice(0, 10)}
                      onOpen={openFxDialog}
                      onQuote={() =>
                        quote([
                          buildIndicatorLine(
                            fx.name,
                            String(fx.price ?? '—'),
                            snapshot?.fetchedAt?.slice(0, 10),
                          ),
                        ])
                      }
                    />
                  )}
                </div>
              </Section>

              <Section
                title="宏观景气"
                state={sourceState(['macro'])}
                hasData={macro.some((i) => i.latest?.value != null)}
                onQuoteAll={() =>
                  quote(
                    macro
                      .filter((i) => i.latest?.value != null)
                      .map((i) =>
                        buildIndicatorLine(i.name, `${i.latest?.value}${i.unit}`, i.latest?.period),
                      ),
                  )
                }
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {macro.map((ind) => (
                    <IndicatorCard
                      key={ind.id}
                      label={ind.name}
                      value={ind.latest?.value == null ? '—' : `${ind.latest.value}${ind.unit}`}
                      sub={ind.latest?.period}
                      onOpen={() => openMacroDialog(ind)}
                      onQuote={
                        ind.latest?.value == null
                          ? undefined
                          : () =>
                              quote([
                                buildIndicatorLine(
                                  ind.name,
                                  `${ind.latest?.value}${ind.unit}`,
                                  ind.latest?.period,
                                ),
                              ])
                      }
                    />
                  ))}
                </div>
              </Section>

              <Section
                title="基金市场"
                state={sourceState(['funds'])}
                hasData={funds.indices.length > 0 || funds.top.length > 0}
                onQuoteAll={() => {
                  const indexLines = funds.indices.map(quoteLine);
                  const topLines = funds.top.flatMap((f) =>
                    f.return1y == null
                      ? []
                      : [
                          buildIndicatorLine(
                            `${f.name}（${f.code}）`,
                            `近 1 年 ${f.return1y >= 0 ? '+' : ''}${f.return1y}%`,
                            f.navDate,
                          ),
                        ],
                  );
                  quote([...indexLines, ...topLines]);
                }}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {funds.indices.map((q) => (
                    <IndicatorCard
                      key={q.secid}
                      label={q.name}
                      value={quoteValue(q)}
                      changePct={q.changePct}
                      spark={snapshot?.data.klines[q.secid]?.map((p) => p.close)}
                      onOpen={() => openIndexDialog(q)}
                      onQuote={() => quote([quoteLine(q)])}
                    />
                  ))}
                </div>
                {funds.top.length > 0 && (
                  <div className="mt-2 overflow-hidden rounded-card border border-border bg-surface">
                    <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5 text-[11px] text-muted">
                      <span className="w-4">#</span>
                      <span className="flex-1">近 1 年涨幅领先（点击引用到对话）</span>
                      <span className="w-16 text-right">近 1 年</span>
                    </div>
                    {funds.top.map((f, i) => (
                      <button
                        key={f.code}
                        type="button"
                        onClick={() =>
                          quote([
                            buildIndicatorLine(
                              `${f.name}（${f.code}）`,
                              f.return1y == null
                                ? '净值数据缺失'
                                : `近 1 年 ${f.return1y >= 0 ? '+' : ''}${f.return1y}%`,
                              f.navDate,
                            ),
                          ])
                        }
                        className="flex w-full items-center gap-2 border-b border-border-soft px-3 py-2 text-left last:border-b-0 hover:bg-surface-2"
                      >
                        <span className="w-4 text-[12px] text-muted">{i + 1}</span>
                        <span className="flex-1 truncate text-[13px] text-text">{f.name}</span>
                        <span className="font-mono text-[11px] text-muted">{f.code}</span>
                        <span
                          className={cn(
                            'w-16 text-right text-[12px] font-medium',
                            (f.return1y ?? 0) >= 0 ? 'text-rise' : 'text-fall',
                          )}
                        >
                          {f.return1y == null ? '—' : `${f.return1y >= 0 ? '+' : ''}${f.return1y}%`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>

        <section className="order-3 mt-6">
          <div className="group mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-medium text-text">轮动模型 · 何时配什么行业</h2>
            <span className="flex-1" />
            <span className="hidden items-center gap-2 group-hover:flex">
              <button
                type="button"
                onClick={() => void regenerate('rotation-daily')}
                title="立即在后台重跑「轮动日报」（轮动周报见上方简报区）"
                className="rounded-input border border-border px-2.5 py-1 text-[12px] text-text hover:bg-surface-2"
              >
                重新生成
              </button>
              <button
                type="button"
                onClick={() => void generateRotation()}
                className="rounded-input bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
              >
                交给对话解析
              </button>
            </span>
          </div>

          {rotation.length === 0 ? (
            <div className="rounded-card border border-border bg-surface px-3 py-6 text-center text-[12px] text-muted">
              {sourceState(['industries']).status === 'error'
                ? '行业数据源暂不可用，稍后刷新重试。'
                : '轮动数据加载中…'}
            </div>
          ) : (
            <RotationTable
              rows={rotation}
              onDecision={(r) => setRecord({ model: 'rotation', target: r.name })}
            />
          )}

          {rotation.length > 0 && (
            <div className="mt-1.5 text-[11px] leading-relaxed text-muted">
              口径：评分 = 0.45×相对强度 + 0.35×动量 + 0.20×趋势（行业内百分位）；
              评分旁数字为较上一交易日变化；年化波动 ≥45% 标注高波动；历史不足的行不计分。
            </div>
          )}

          {flowTop.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowFlows((v) => !v)}
                className="print-hide flex items-center gap-1 text-[11px] text-muted hover:text-text"
              >
                资金流 TOP10（主力净流入）
                <ChevronDown
                  size={12}
                  className={cn('transition-transform', showFlows && 'rotate-180')}
                />
              </button>
              {showFlows ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {flowTop.map((b) => (
                    <span
                      key={b.code}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] ring-1',
                        (b.mainInflow ?? 0) >= 0
                          ? 'bg-rise/5 text-rise ring-rise/20'
                          : 'bg-fall/5 text-fall ring-fall/20',
                      )}
                      title={`${b.name}（${b.code}）`}
                    >
                      {b.name}
                      <span className="ml-1 font-mono">
                        {b.mainInflow === null ? '—' : `${(b.mainInflow / 1e8).toFixed(1)}亿`}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-muted">
                  {flowTop
                    .slice(0, 3)
                    .map(
                      (b) =>
                        `${b.name} ${
                          b.mainInflow === null
                            ? '—'
                            : `${b.mainInflow >= 0 ? '+' : ''}${(b.mainInflow / 1e8).toFixed(1)}亿`
                        }`,
                    )
                    .join(' · ')}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="order-4 mt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-medium text-text">申万行业 · 一级全景</h2>
            <span className="text-[11px] text-muted">
              {swRows.length > 0
                ? `${swRows.length} 个一级行业 · 行情 / 估值 / 评分`
                : '31 个一级行业 · 行情 / 估值 / 评分'}
            </span>
          </div>
          {swRows.length > 0 && (
            <>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-text">
                {swConclusion.ranks}
              </p>
              {swConclusion.focus && (
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{swConclusion.focus}</p>
              )}
            </>
          )}
          <div className="mt-2">
            {swRows.length === 0 ? (
              <div className="rounded-card border border-border bg-surface px-3 py-6 text-center text-[12px] text-muted">
                {sourceState(['sw']).status === 'error'
                  ? '申万数据源暂不可用，稍后刷新重试。'
                  : '申万行业数据加载中…'}
              </div>
            ) : (
              <SwIndustryTable
                rows={swRows}
                onDecision={(r) => setRecord({ model: 'rotation', target: `申万·${r.name}` })}
                onQuote={(r) => quoteSw(r)}
                onAnalyze={(r) => void analyzeSw(r)}
              />
            )}
            {swRows.length > 0 && (
              <div className="mt-1.5 text-[11px] leading-relaxed text-muted">
                {`口径：评分沿用轮动模型（0.45×相对强度 + 0.35×动量 + 0.20×趋势，申万一级行业内百分位）；行情为申万官网实时，估值 / 换手 / 成交占比为截止日（${swRows[0].asOf.slice(5)}）收盘数据；点击行查看约 85 个交易日走势与明细。`}
              </div>
            )}
          </div>
        </section>

        <section className="order-5 mt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-medium text-text">行业模型 · 行业内如何定价</h2>
            <span className="text-[11px] text-muted">
              盈利 / 估值 / 情绪三要素 · 全部板块热力图（面积 = 市值，颜色 = 涨跌）
            </span>
          </div>
          {boards.length === 0 ? (
            <div className="rounded-card border border-border bg-surface px-3 py-6 text-center text-[12px] text-muted">
              {sourceState(['industries']).status === 'error'
                ? '行业数据源暂不可用，稍后刷新重试。'
                : sourceState(['industries']).status === 'ready'
                  ? '板块列表数据源暂不可用（东财板块接口异常）；行情与轮动数据不受影响，稍后自动重试。'
                  : '板块数据加载中…'}
            </div>
          ) : (
            <IndustryTreemap boards={boards} onSelect={(b) => void selectIndustry(b)} />
          )}
          {boards.length > 0 && (
            <div className="mt-1.5 text-[11px] leading-relaxed text-muted">
              口径：面积为东财板块总市值（TOP100
              按市值去重）；红涨绿跌、颜色深浅随涨跌幅；点击方块查看估值、走势与成分股明细。
            </div>
          )}
        </section>

        <section className="order-6 mt-6">
          <DecisionLedger
            decisions={decisions}
            onChanged={() => void reloadResearch()}
            onRegenerate={() => void regenerate('review-weekly')}
            onReview={() => void reviewLoop()}
          />
        </section>

        <div className="order-8 mt-6 border-t border-border-soft pt-3 text-[11px] leading-relaxed text-muted">
          数据来自公开接口，可能存在延迟或误差；评分是透明规则模型，仅供研究参考，不构成投资建议。
          {snapshot?.errors && snapshot.errors.length > 0 && (
            <span className="ml-1 text-error">部分数据源异常：{snapshot.errors.join('；')}</span>
          )}
        </div>
      </div>

      {dialog && (
        <IndicatorDialog
          title={dialog.title}
          value={dialog.value}
          sub={dialog.sub}
          meta={dialog.meta}
          series={dialog.series}
          loading={dialog.loading}
          onClose={closeDialog}
          onQuote={() => {
            quote([dialog.quoteLine]);
            closeDialog();
          }}
          onGenerate={() => {
            const focused = dialog.quoteLine ? `请特别关注以下指标：\n${dialog.quoteLine}\n\n` : '';
            closeDialog();
            void openSession(focused + buildRotationPrompt(snapshot, researchCtx()));
          }}
        />
      )}

      {selectedBoard && (
        <IndustryDialog
          board={selectedBoard}
          detail={industry}
          loading={industryLoading}
          onClose={() => {
            setSelectedBoard(null);
            setIndustry(null);
          }}
          onAnalyze={() => void generateIndustry()}
          onDecision={() => setRecord({ model: 'industry', target: selectedBoard.name })}
        />
      )}

      {record && (
        <RecordDecisionDialog
          model={record.model}
          target={record.target}
          onClose={() => setRecord(null)}
          onSaved={() => void reloadResearch()}
        />
      )}
    </div>
  );
}
