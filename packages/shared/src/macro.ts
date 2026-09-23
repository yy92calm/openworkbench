// Macro insights (宏观洞察) domain types + prompt builders.
//
// Browser-safe, shared by the Electron main process (fetch / cache / scheduler)
// and the renderer (dashboard, theme cards, composer references). No Electron
// or Node imports here — pure data and pure functions only.

// ---- Data sources ----

export type MacroSourceId = 'indices' | 'yields' | 'macro' | 'fx' | 'funds' | 'industries' | 'sw';

export type MacroSourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MacroSourceState {
  status: MacroSourceStatus;
  error?: string;
  fetchedAt?: string;
}

/** A live quote (index or fund index) from the quote API. */
export interface MacroQuote {
  /** Quote id in the data source's format, e.g. "1.000300". */
  secid: string;
  code: string;
  name: string;
  price: number | null;
  changePct: number | null;
  change: number | null;
}

export interface MacroKlinePoint {
  date: string;
  close: number;
}

export interface MacroPoint {
  /** ISO date of the reporting period. */
  date: string;
  /** Human period label, e.g. "2026年08月份". */
  period: string;
  value: number | null;
}

/** One macro indicator series (latest value + recent history). */
export interface MacroIndicator {
  id: string;
  name: string;
  unit: string;
  latest: MacroPoint | null;
  /** Oldest → newest; for the detail dialog chart. */
  history: MacroPoint[];
}

export interface MacroYieldPoint {
  date: string;
  cn2y: number | null;
  cn5y: number | null;
  cn10y: number | null;
  cn30y: number | null;
  cn10y2y: number | null;
  us10y: number | null;
}

export interface MacroFxQuote {
  pair: string;
  name: string;
  price: number | null;
}

export interface MacroFundRankItem {
  code: string;
  name: string;
  navDate: string;
  nav: number | null;
  /** Trailing 1-year return, percent. */
  return1y: number | null;
}

export interface MacroFundsData {
  indices: MacroQuote[];
  top: MacroFundRankItem[];
}

// ---- Canonical display names ----
// Eastmoney's f14 names are inconsistent for the CSI industry indices
// ("中证能源" vs "800材料") and too vague for the fund indices. The UI and
// every model prompt use one naming standard through these maps; unknown
// secids keep the data-source name so interface changes never drop data.

/** Rotation universe: the CSI top-10 industry indices. */
export const CSI_INDUSTRY_SECIDS: readonly string[] = [
  '1.000928', // 能源
  '1.000929', // 材料
  '1.000930', // 工业
  '1.000931', // 可选
  '1.000932', // 消费
  '1.000933', // 医药
  '1.000934', // 金融
  '1.000935', // 信息
  '1.000936', // 通信
  '1.000937', // 公用
];

export const CSI_INDUSTRY_NAMES: Record<string, string> = {
  '1.000928': '中证能源',
  '1.000929': '中证材料',
  '1.000930': '中证工业',
  '1.000931': '中证可选',
  '1.000932': '中证消费',
  '1.000933': '中证医药',
  '1.000934': '中证金融',
  '1.000935': '中证信息',
  '1.000936': '中证通信',
  '1.000937': '中证公用',
};

export const FUND_INDEX_SECIDS: readonly string[] = ['1.000011', '0.399306'];

export const FUND_INDEX_NAMES: Record<string, string> = {
  '1.000011': '上证基金指数',
  '0.399306': '深证 ETF',
};

/** Overwrite quote names with the canonical display names (fallback: source). */
export function applyCanonicalIndexNames(quotes: MacroQuote[]): MacroQuote[] {
  return quotes.map((q) => {
    const name = CSI_INDUSTRY_NAMES[q.secid] ?? FUND_INDEX_NAMES[q.secid];
    return name ? { ...q, name } : q;
  });
}

/** An Eastmoney industry board row (细分行业). */
export interface MacroBoard {
  /** Board code, e.g. "BK0475". */
  code: string;
  name: string;
  changePct: number | null;
  /** Turnover rate, percent. */
  turnover: number | null;
  /** Main-capital net inflow, CNY. */
  mainInflow: number | null;
  /** Total market cap, CNY. */
  mcap: number | null;
  /** Board-level PE (Eastmoney f9); null when missing/non-positive. */
  pe: number | null;
}

export interface MacroConstituent {
  code: string;
  name: string;
  price: number | null;
  changePct: number | null;
  /** PE (TTM preferred, falls back to dynamic); null when negative/missing. */
  pe: number | null;
  pb: number | null;
  mcap: number | null;
}

/** On-demand detail for one industry board (industry model). */
export interface MacroIndustryDetail {
  board: MacroBoard;
  klines: MacroKlinePoint[];
  /** Top constituents by market cap. */
  constituents: MacroConstituent[];
  /** Median of positive PE/PB among the fetched constituents. */
  peMedian: number | null;
  pbMedian: number | null;
  /** Board PE percentile vs the top-100 boards (0–100, higher = pricier). */
  pePercentile: number | null;
  fetchedAt: string;
}

export type RotationSignal = 'overweight' | 'neutral' | 'underweight';

/** One rotation-model row (CSI top-10 industry indices). */
export interface RotationRow {
  secid: string;
  name: string;
  /** 60-trading-day return (decimal, e.g. 0.052). */
  ret60: number | null;
  /** ret60 minus HS300's 60-day return. */
  rs60: number | null;
  /** Close above the 20-day moving average; null without enough history. */
  trend: boolean | null;
  /** Annualized 60-day volatility (decimal). */
  vol60: number | null;
  /** 0–100 transparent composite score; null when inputs are missing. */
  score: number | null;
  /** Signal bucket; null alongside a null score (data insufficient). */
  signal: RotationSignal | null;
  /** Score change vs the previous trading day; null when unknown. */
  scoreDelta: number | null;
}

/**
 * Shenwan level-1 industry row: live quote + fundamentals + the same
 * transparent rotation metrics. Fundamentals/valuation come from the daily
 * analysis report as of `asOf` (the newest cutoff published for enough
 * industries); `changePct`/`amount`/`amountShare` are today's live values.
 */
export interface SwIndustryRow {
  /** Shenwan index code, e.g. "801010". */
  code: string;
  name: string;
  /** Live change today, percent. */
  changePct: number | null;
  /** Live turnover today, 亿元. */
  amount: number | null;
  /** Share of the 31-industry live turnover, percent. */
  amountShare: number | null;
  /** Date of the fundamentals / scoring data (daily analysis report). */
  asOf: string;
  close: number | null;
  turnover: number | null;
  pe: number | null;
  pb: number | null;
  /** Dividend yield, percent. */
  dividend: number | null;
  /** Free-float market cap, 亿元. */
  mcap: number | null;
  ret60: number | null;
  rs60: number | null;
  trend: boolean | null;
  vol60: number | null;
  score: number | null;
  signal: RotationSignal | null;
  scoreDelta: number | null;
  /** Daily closes up to `asOf` for the drill-down chart. */
  history: MacroKlinePoint[];
}

export interface MacroSnapshotData {
  indices: MacroQuote[];
  /** Prefetched daily closes keyed by secid (mini charts / detail dialog). */
  klines: Record<string, MacroKlinePoint[]>;
  yields: MacroYieldPoint[];
  macro: MacroIndicator[];
  fx: MacroFxQuote | null;
  funds: MacroFundsData;
  /** Rotation model rows (computed at refresh). */
  rotation: RotationRow[];
  /** Shenwan level-1 industry panorama (quotes + valuation + rotation score). */
  swIndustries: SwIndustryRow[];
  /** Eastmoney industry boards, top by market cap (industry-model picker). */
  boards: MacroBoard[];
}

export interface MacroDashboardSnapshot {
  /** Monotonic; the renderer drops out-of-order pushes. */
  seq: number;
  /** ISO time of the last completed refresh (successful or partial). */
  fetchedAt: string | null;
  refreshing: boolean;
  sources: Record<MacroSourceId, MacroSourceState>;
  data: MacroSnapshotData;
  errors: string[];
}

export function emptyMacroSnapshot(): MacroDashboardSnapshot {
  return {
    seq: 0,
    fetchedAt: null,
    refreshing: false,
    sources: {
      indices: { status: 'idle' },
      yields: { status: 'idle' },
      macro: { status: 'idle' },
      fx: { status: 'idle' },
      funds: { status: 'idle' },
      industries: { status: 'idle' },
      sw: { status: 'idle' },
    },
    data: {
      indices: [],
      klines: {},
      yields: [],
      macro: [],
      fx: null,
      funds: { indices: [], top: [] },
      rotation: [],
      swIndustries: [],
      boards: [],
    },
    errors: [],
  };
}

// ---- Notifications ----

export type MacroNotificationKind = 'briefing' | 'alert';

export interface MacroNotification {
  id: string;
  kind: MacroNotificationKind;
  title: string;
  body?: string;
  createdAt: string;
  read: boolean;
  /** briefing: the session the daily insight ran in. */
  sessionId?: string;
  themeId?: MacroThemeId;
  /** alert: which dashboard indicator moved. */
  indicator?: string;
  /** Dedupe key for alerts (same indicator + direction). */
  dedupeKey?: string;
  /** Reserved for a future system-notification toggle. */
  system?: boolean;
}

// ---- Research loop (decision ledger + knowledge asset) ----

export type ResearchModel = 'rotation' | 'industry';
export type ResearchStance = 'overweight' | 'neutral' | 'underweight' | 'watch';
export type ResearchOutcome = 'hit' | 'partial' | 'miss';

export interface ResearchAttribution {
  outcome: ResearchOutcome;
  note: string;
  reviewedAt: string;
}

export interface ResearchDecision {
  id: string;
  model: ResearchModel;
  target: string;
  stance: ResearchStance;
  thesis: string;
  sessionId?: string;
  createdAt: string;
  status: 'open' | 'reviewed';
  attribution?: ResearchAttribution;
}

/** What the model prompts inject from the loop (decisions + knowledge). */
export interface ResearchContext {
  decisions: ResearchDecision[];
  /** knowledge.md digest, or null when the file does not exist yet. */
  digest: string | null;
}

// ---- Background-generated reports (workspace reports dir) ----

/** One generated report artifact under `<workspace>/.workbench/research/reports/`. */
export interface MacroReportMeta {
  themeId: MacroThemeId;
  /** File name inside the reports directory (validated again on read). */
  file: string;
  createdAt: string;
  /** Non-whitespace character count. */
  chars: number;
  /** The session the report was generated in (kept for follow-up questions). */
  sessionId?: string;
}

// ---- Model task templates (scheduler + model actions) ----

export type MacroThemeId = 'rotation-daily' | 'rotation-weekly' | 'review-weekly';

export interface MacroThemeMeta {
  id: MacroThemeId;
  title: string;
  description: string;
  /** Task instruction injected into the generated prompt. */
  instruction: string;
}

export const MACRO_THEMES: readonly MacroThemeMeta[] = [
  {
    id: 'rotation-daily',
    title: '轮动日报',
    description: '工作日开盘前输出行业轮动信号与增量变化',
    instruction: '重点说明与上一交易日相比的信号变化与增量信息。',
  },
  {
    id: 'rotation-weekly',
    title: '轮动周报',
    description: '每周输出行业配置方案（超配/低配与触发条件）',
    instruction: '输出本周行业配置方案，并给出失效条件。',
  },
  {
    id: 'review-weekly',
    title: '复盘与再训练',
    description: '复盘决策归因并沉淀组织知识资产',
    instruction: '逐条复盘决策、提炼经验并更新知识资产。',
  },
];

export function macroTheme(id: string | undefined | null): MacroThemeMeta | null {
  if (!id) return null;
  return MACRO_THEMES.find((t) => t.id === id) ?? null;
}

// ---- Prompt builders (pure; main process + renderer share these) ----

function num(v: number | null | undefined): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
}

/** A single reference line: `- 沪深300 4507.39（+1.06%，2026-09-18）`. */
export function buildIndicatorLine(label: string, value: string, date?: string): string {
  return `- ${label} ${value}${date ? `（${date}）` : ''}`;
}

function quoteLine(q: MacroQuote, date?: string): string | null {
  const price = num(q.price);
  if (price === null) return null;
  const chg = num(q.changePct);
  if (chg === null) return buildIndicatorLine(q.name, price, date);
  const sign = (q.changePct ?? 0) >= 0 ? '+' : '';
  return buildIndicatorLine(q.name, `${price}（${sign}${chg}%）`, date);
}

function lastOf<T>(list: T[]): T | null {
  return list.length > 0 ? list[list.length - 1] : null;
}

function quoteById(snapshot: MacroDashboardSnapshot, secid: string): MacroQuote | null {
  return snapshot.data.indices.find((q) => q.secid === secid) ?? null;
}

function fundIndexById(snapshot: MacroDashboardSnapshot, secid: string): MacroQuote | null {
  return snapshot.data.funds.indices.find((q) => q.secid === secid) ?? null;
}

/** Macro-input lines injected into every model prompt. */
export function buildMacroContextLines(snapshot: MacroDashboardSnapshot): string[] {
  const date = snapshot.fetchedAt ? snapshot.fetchedAt.slice(0, 10) : undefined;
  const out: string[] = [];
  const y = lastOf(snapshot.data.yields);
  if (y) {
    const rows: [string, number | null][] = [
      ['中债 10Y 收益率', y.cn10y],
      ['中债 10Y-2Y 利差', y.cn10y2y],
      ['美债 10Y 收益率', y.us10y],
    ];
    for (const [label, v] of rows) {
      const s = num(v);
      if (s !== null) out.push(buildIndicatorLine(label, `${s}%`, y.date));
    }
  }
  for (const ind of snapshot.data.macro) {
    if (ind.id === 'gdp') continue; // quarterly — low signal for rotation timing
    const v = num(ind.latest?.value);
    if (v === null || !ind.latest) continue;
    out.push(buildIndicatorLine(ind.name, `${v}${ind.unit}`, ind.latest.period));
  }
  const fx = snapshot.data.fx;
  const fxPrice = num(fx?.price);
  if (fx && fxPrice !== null) out.push(buildIndicatorLine(fx.name, fxPrice, date));
  return out;
}

// ---- Rotation model (transparent rule-based scoring) ----

function pctChange(points: MacroKlinePoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].close;
  if (!first) return null;
  return points[points.length - 1].close / first - 1;
}

function percentileRank(values: (number | null)[], v: number | null): number {
  const valid = values.filter((x): x is number => x !== null);
  if (v === null || valid.length === 0) return 0.5;
  return valid.filter((x) => x <= v).length / valid.length;
}

function volatility(points: MacroKlinePoint[]): number | null {
  if (points.length < 10) return null;
  const rets: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].close;
    if (prev) rets.push(points[i].close / prev - 1);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Score = 100 × (0.45×rankPct(rs60) + 0.35×rankPct(ret60) + 0.20×trend).
 * Percentile ranks are cross-sectional within the given industries; the
 * formula is shown in the UI so the team can audit the standard.
 *
 * Rows whose inputs are missing score `null` (trend / signal likewise) and
 * sort below the scored rows — a degraded row must never look like a signal.
 */
export function computeRotation(
  industries: readonly { secid: string; name: string; klines: MacroKlinePoint[] }[],
  hs300: MacroKlinePoint[],
): RotationRow[] {
  const hsRet = pctChange(hs300);
  const rets = industries.map((i) => pctChange(i.klines));
  const rss = industries.map((_, idx) =>
    rets[idx] !== null && hsRet !== null ? (rets[idx] as number) - hsRet : null,
  );
  return industries
    .map((industry, idx) => {
      const ret60 = rets[idx];
      const rs60 = rss[idx];
      const closes = industry.klines.map((p) => p.close);
      const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
      const trend = ma20 !== null && closes.length > 0 ? closes[closes.length - 1] > ma20 : null;
      const score =
        ret60 !== null && rs60 !== null && trend !== null
          ? Math.round(
              100 *
                (0.45 * percentileRank(rss, rs60) +
                  0.35 * percentileRank(rets, ret60) +
                  0.2 * (trend ? 1 : 0)),
            )
          : null;
      return {
        secid: industry.secid,
        name: industry.name,
        ret60,
        rs60,
        trend,
        vol60: volatility(industry.klines),
        score,
        signal:
          score === null
            ? null
            : score >= 67
              ? 'overweight'
              : score <= 33
                ? 'underweight'
                : 'neutral',
        scoreDelta: null,
      } satisfies RotationRow;
    })
    .sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
}

/** Attach score changes vs the previous trading day's recorded scores. */
export function attachRotationDeltas(
  rows: readonly RotationRow[],
  prevScores: Record<string, number> | null,
): RotationRow[] {
  return rows.map((row) => {
    const prev = prevScores?.[row.secid];
    return {
      ...row,
      scoreDelta:
        typeof prev === 'number' && row.score !== null ? Math.round(row.score - prev) : null,
    };
  });
}

/** Board PE percentile within the fetched board universe (0–100). */
export function boardPePercentile(boards: readonly MacroBoard[], pe: number | null): number | null {
  if (typeof pe !== 'number' || !Number.isFinite(pe) || pe <= 0) return null;
  const valid = boards
    .map((b) => b.pe)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (valid.length === 0) return null;
  return Math.round((valid.filter((v) => v <= pe).length / valid.length) * 100);
}

// ---- Research loop formatting ----

const OUTCOME_LABEL: Record<ResearchOutcome, string> = {
  hit: '命中',
  partial: '部分命中',
  miss: '偏离',
};

function decisionLine(d: ResearchDecision): string {
  const model = d.model === 'rotation' ? '轮动' : '行业';
  const stance = {
    overweight: '超配',
    neutral: '中性',
    underweight: '低配',
    watch: '观察',
  }[d.stance];
  const attr = d.attribution
    ? `（已归因：${OUTCOME_LABEL[d.attribution.outcome]} — ${d.attribution.note}）`
    : '（未归因）';
  return `- [${model}/${stance}] ${d.target}（${d.createdAt.slice(0, 10)}）：${d.thesis}${attr}`;
}

/** The research block appended to model prompts (decisions + knowledge). */
export function formatResearchContext(research: ResearchContext | null | undefined): string {
  if (!research) return '';
  const parts: string[] = [];
  if (research.digest && research.digest.trim()) {
    parts.push(`【知识资产摘要】\n${research.digest.trim().slice(0, 4000)}`);
  }
  const open = research.decisions.filter((d) => d.status === 'open').slice(0, 5);
  const reviewed = research.decisions.filter((d) => d.status === 'reviewed').slice(0, 3);
  if (open.length > 0) parts.push(`【未归因决策】\n${open.map(decisionLine).join('\n')}`);
  if (reviewed.length > 0) parts.push(`【已归因决策】\n${reviewed.map(decisionLine).join('\n')}`);
  return parts.join('\n\n');
}

/** Core reference lines for the dashboard's "引用核心指标" action. */
export function buildCoreIndicatorLines(snapshot: MacroDashboardSnapshot | null): string[] {
  if (!snapshot) return [];
  const date = snapshot.fetchedAt ? snapshot.fetchedAt.slice(0, 10) : undefined;
  const out: string[] = [];
  for (const secid of ['1.000001', '1.000300']) {
    const q = quoteById(snapshot, secid);
    const line = q ? quoteLine(q, date) : null;
    if (line) out.push(line);
  }
  const y = lastOf(snapshot.data.yields);
  const cn10y = num(y?.cn10y);
  if (cn10y !== null) out.push(buildIndicatorLine('中债 10Y 收益率', `${cn10y}%`, y?.date));
  const fx = snapshot.data.fx;
  const fxPrice = num(fx?.price);
  if (fx && fxPrice !== null) out.push(buildIndicatorLine(fx.name, fxPrice, date));
  const cpi = snapshot.data.macro.find((i) => i.id === 'cpi');
  const cpiVal = num(cpi?.latest?.value);
  if (cpi && cpiVal !== null && cpi.latest)
    out.push(buildIndicatorLine(cpi.name, `${cpiVal}${cpi.unit}`, cpi.latest.period));
  const fund = fundIndexById(snapshot, '1.000011');
  const fundLine = fund ? quoteLine(fund, date) : null;
  if (fundLine) out.push(fundLine);
  return out;
}

// ---- Executive summary + exported report (shared by page and export) ----

/** knowledge.md size metric: non-whitespace characters (0 when absent). */
export function digestCharCount(digest: string | null): number {
  return digest ? digest.replace(/\s/g, '').length : 0;
}

/**
 * CEO-facing conclusion in two parts: the recommended actions (full overweight
 * / underweight name lists, never truncated) and the strongest day-over-day
 * score mover in each direction. The page shows the two strings as separate
 * lines; the exported report joins them via buildMacroSummarySentence.
 * Ledger / knowledge numbers live in the KPI row (and the report) instead of
 * repeating here.
 */
/** The overview's industry-signal view (chips + change line). */
export interface MacroSignalView {
  /** Overweight industries in score-descending order (full list). */
  over: string[];
  /** Underweight industries in score-descending order (full list). */
  under: string[];
  /** `较上一交易日：X 走强、Y 走弱。`, or null when nothing moved. */
  change: string | null;
}

/** Strongest day-over-day riser / faller as one line. */
function rotationChangeLine(scored: readonly RotationRow[]): string | null {
  const moved = scored.flatMap((r) =>
    typeof r.scoreDelta === 'number' ? [{ name: r.name, delta: r.scoreDelta }] : [],
  );
  const riser = moved.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const faller = moved.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  const moves = [riser && `${riser.name}走强`, faller && `${faller.name}走弱`].filter(
    (s): s is string => Boolean(s),
  );
  return moves.length > 0 ? `较上一交易日：${moves.join('、')}。` : null;
}

/** Industry signal view for the overview chips (rotation model, CSI names). */
export function buildMacroSignalView(snapshot: MacroDashboardSnapshot | null): MacroSignalView {
  const scored = (snapshot?.data.rotation ?? []).filter((r) => r.score !== null);
  const names = (signal: RotationSignal) =>
    scored.filter((r) => r.signal === signal).map((r) => r.name);
  return {
    over: names('overweight'),
    under: names('underweight'),
    change: rotationChangeLine(scored),
  };
}

/**
 * CEO-facing conclusion sentence (report / clipboard): the recommended
 * actions (full overweight / underweight name lists, never truncated) and the
 * strongest day-over-day score mover in each direction. The page renders the
 * chip view instead; the exported report joins the two strings via
 * buildMacroSummarySentence. Ledger / knowledge numbers live in the KPI row.
 */
export function buildMacroConclusion(snapshot: MacroDashboardSnapshot | null): {
  action: string;
  change: string | null;
} {
  const rotation = snapshot?.data.rotation ?? [];
  if (rotation.length === 0) return { action: '数据加载中，等待轮动信号生成…', change: null };
  if (rotation.filter((r) => r.score !== null).length === 0) {
    return { action: '轮动历史数据不足，等待行情补齐…', change: null };
  }
  const view = buildMacroSignalView(snapshot);
  return {
    action: `建议超配：${view.over.join('、') || '暂无'}；建议低配：${
      view.under.join('、') || '暂无'
    }。`,
    change: view.change,
  };
}

/** One-line executive summary (report / clipboard): conclusion + change. */
export function buildMacroSummarySentence(snapshot: MacroDashboardSnapshot | null): string {
  const { action, change } = buildMacroConclusion(snapshot);
  return change ? `${action} ${change}` : action;
}

/**
 * Shenwan panorama conclusion (CEO lines): the strongest / weakest scored
 * industries and where the live turnover concentrates. The page renders the
 * two strings as separate lines.
 */
export function buildSwConclusion(rows: readonly SwIndustryRow[]): {
  ranks: string;
  focus: string | null;
} {
  if (rows.length === 0) return { ranks: '申万行业数据加载中…', focus: null };
  const scored = rows.filter((r): r is SwIndustryRow & { score: number } => r.score !== null);
  if (scored.length === 0) return { ranks: '申万行业评分数据不足，等待行情补齐…', focus: null };
  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const label = (r: SwIndustryRow & { score: number }) => `${r.name} ${r.score}`;
  const ranks = `评分领先：${byScore.slice(0, 3).map(label).join('、')}；评分垫底：${byScore
    .slice(-3)
    .reverse()
    .map(label)
    .join('、')}。`;
  const byShare = rows
    .filter((r) => r.amountShare !== null)
    .sort((a, b) => (b.amountShare ?? 0) - (a.amountShare ?? 0))
    .slice(0, 2);
  const focus =
    byShare.length > 0
      ? `成交聚焦：${byShare
          .map((r) => `${r.name} ${(r.amountShare ?? 0).toFixed(1)}%`)
          .join('、')}。`
      : null;
  return { ranks, focus };
}

const SOURCE_LABELS: Record<MacroSourceId, string> = {
  indices: '市场行情',
  yields: '利率与汇率',
  macro: '宏观景气',
  fx: '汇率',
  funds: '基金市场',
  industries: '行业轮动 / 板块',
  sw: '申万行业',
};

const SOURCE_STATUS_LABELS: Record<MacroSourceStatus, string> = {
  idle: '未开始',
  loading: '更新中',
  ready: '就绪',
  error: '异常',
};

function reportStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

function reportDelta(d: number | null | undefined): string {
  if (d === null || d === undefined) return '—';
  return d >= 0 ? `+${d}` : `${d}`;
}

/**
 * Markdown report for leadership review: overview KPIs, the rotation table
 * (with day-over-day score changes), the decision ledger and source status.
 * Pure: the renderer copies or exports the returned string.
 */
export function buildMacroReportMarkdown(
  snapshot: MacroDashboardSnapshot | null,
  decisions: readonly ResearchDecision[],
  digest: string | null,
): string {
  const rotation = snapshot?.data.rotation ?? [];
  const boards = snapshot?.data.boards ?? [];
  const scored = rotation.filter((r) => r.score !== null);
  const count = (signal: RotationSignal) => scored.filter((r) => r.signal === signal).length;
  const reviewed = decisions.filter((d) => d.status === 'reviewed').length;
  const rate = decisions.length > 0 ? Math.round((reviewed / decisions.length) * 100) : 0;
  const chars = digestCharCount(digest);
  const entries = Object.entries(snapshot?.sources ?? {}) as [MacroSourceId, MacroSourceState][];
  const ready = entries.filter(([, s]) => s.status === 'ready').length;
  const trendLabel = (t: boolean | null) => (t === null ? '—' : t ? '20 日线上' : '20 日线下');

  const lines: string[] = [
    `# 宏观洞察 · 投研汇报（${reportStamp(new Date().toISOString())}）`,
    '',
    '> AI 投研系统 · 轮动模型 × 行业模型｜数据 → 信号 → 模型 → 决策 → 归因 → 再训练',
    '',
    '## 摘要',
    '',
    buildMacroSummarySentence(snapshot),
    '',
    '## 关键指标',
    '',
    '| 指标 | 数值 |',
    '| --- | --- |',
    `| 行业覆盖 | ${rotation.length} 指数 · ${boards.length} 板块 |`,
    `| 轮动信号 | 超配 ${count('overweight')} · 中性 ${count('neutral')} · 低配 ${count(
      'underweight',
    )} |`,
    `| 决策台账 | ${decisions.length} 条（待归因 ${decisions.length - reviewed}） |`,
    `| 归因率 | ${rate}%（已归因 ${reviewed} 条） |`,
    `| 知识资产 | ${chars > 0 ? `约 ${chars} 字` : '待沉淀'} |`,
    `| 数据时效 | ${ready}/${entries.length} 源${
      snapshot?.fetchedAt ? ` · 更新于 ${reportStamp(snapshot.fetchedAt)}` : ''
    } |`,
    '',
    '## 闭环进度',
    '',
    `数据 ${ready}/${entries.length} · 信号 ${rotation.length} · 模型 2 · 决策 ${
      decisions.length
    } · 归因 ${reviewed}（${rate}%） · 再训练 ${chars > 0 ? `${chars} 字` : '待沉淀'}`,
    '',
    '## 轮动信号（中证十大行业）',
    '',
    '| 行业 | 60 日 | 相对沪深300 | 趋势 | 波动 | 评分 | 较上一交易日 | 信号 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...(rotation.length > 0
      ? rotation.map(
          (r) =>
            `| ${r.name} | ${fmtPct01(r.ret60)} | ${fmtPct01(r.rs60)} | ${trendLabel(
              r.trend,
            )} | ${fmtPct01(r.vol60)} | ${r.score ?? '数据不足'} | ${reportDelta(
              r.scoreDelta,
            )} | ${r.signal ? signalLabel(r.signal) : '数据不足'} |`,
        )
      : ['| （轮动数据未就绪） | | | | | | | |']),
    '',
    '## 决策台账',
    '',
    `共 ${decisions.length} 条，已归因 ${reviewed} 条（${rate}%）。`,
    '',
    ...(decisions.length > 0
      ? decisions.slice(0, 5).map(decisionLine)
      : ['- 暂无决策记录（在轮动评分表或行业面板中记录第一条）']),
    '',
    '## 数据源状态',
    '',
    ...(entries.length > 0
      ? entries.map(
          ([id, s]) =>
            `- ${SOURCE_LABELS[id]}：${SOURCE_STATUS_LABELS[s.status]}${
              s.fetchedAt ? `（${reportStamp(s.fetchedAt)}）` : ''
            }${s.error ? ` — ${s.error}` : ''}`,
        )
      : ['- 快照未就绪']),
    '',
    '---',
    '',
    '> 数据来自公开接口，可能存在延迟或误差；评分是透明规则模型，仅供研究参考，不构成投资建议。',
  ];
  return lines.join('\n');
}

// ---- Model prompt builders ----

function fmtPct01(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(2)}%`;
}

/** Percent-unit values (quotes/constituents already come as percent). */
function fmtPct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(2)}%`;
}

function fmtYi(v: number | null): string {
  return v === null ? '—' : `${(v / 1e8).toFixed(2)} 亿`;
}

function fmtNum(v: number | null, digits = 2): string {
  return v === null ? '—' : v.toFixed(digits);
}

function signalLabel(s: RotationSignal): string {
  return { overweight: '超配', neutral: '中性', underweight: '低配' }[s];
}

function rotationRowLine(r: RotationRow): string {
  if (r.score === null || r.signal === null) {
    return `- ${r.name}：历史数据不足，未参与评分（60 日 ${fmtPct01(r.ret60)}）`;
  }
  const trend = r.trend === null ? '数据不足' : r.trend ? '20 日线上' : '20 日线下';
  // Snapshots cached before scoreDelta existed carry undefined; treat as null.
  const delta = r.scoreDelta ?? null;
  const deltaText = delta === null ? '' : `，较上一交易日 ${delta >= 0 ? '+' : ''}${delta}`;
  return `- ${r.name}：60 日 ${fmtPct01(r.ret60)}，相对沪深300 ${fmtPct01(
    r.rs60,
  )}，趋势 ${trend}，波动 ${fmtPct01(r.vol60)}，评分 ${r.score}（${signalLabel(
    r.signal,
  )}）${deltaText}`;
}

function swIndustryLine(r: SwIndustryRow): string {
  const head =
    r.score === null || r.signal === null
      ? `${r.name}：未参与评分`
      : `${r.name}：评分 ${r.score}（${signalLabel(r.signal)}）`;
  return `- ${[
    head,
    `PE ${fmtNum(r.pe)}`,
    `PB ${fmtNum(r.pb)}`,
    `股息率 ${fmtPct(r.dividend)}`,
    `换手 ${fmtPct(r.turnover)}`,
    `成交占比 ${fmtPct(r.amountShare)}`,
    `60 日 ${fmtPct01(r.ret60)}`,
  ].join('，')}`;
}

function rotationBody(
  title: string,
  snapshot: MacroDashboardSnapshot | null,
  research?: ResearchContext | null,
): string {
  const rows = snapshot?.data.rotation ?? [];
  const table = rows.length > 0 ? rows.map(rotationRowLine).join('\n') : '（轮动数据未就绪）';
  const sw = snapshot?.data.swIndustries ?? [];
  const swTable = sw.length > 0 ? sw.map(swIndustryLine).join('\n') : '（申万行业数据未就绪）';
  const flows = [...(snapshot?.data.boards ?? [])]
    .sort((a, b) => (b.mainInflow ?? -Infinity) - (a.mainInflow ?? -Infinity))
    .slice(0, 10)
    .map((b) => `- ${b.name}：涨跌 ${fmtPct(b.changePct)}，主力净流入 ${fmtYi(b.mainInflow)}`)
    .join('\n');
  const macro = snapshot ? buildMacroContextLines(snapshot) : [];
  const researchBlock = formatResearchContext(research);
  const parts = [
    `请生成一份「${title}」。`,
    `【轮动评分】（中证十大行业；评分 = 0.45×相对强度 + 0.35×动量 + 0.20×趋势，行业内百分位；较上一交易日 = 评分变化，历史不足的行不参与评分）\n${table}`,
    `【申万一级行业 · 31 个】（评分降序；评分口径同上，百分位在申万一级行业内计算；估值 / 换手 / 成交占比为最近收盘数据）\n${swTable}`,
    `【资金流 TOP10（东财细分行业）】\n${flows || '（资金流数据未就绪）'}`,
    macro.length > 0 ? `【宏观输入】\n${macro.join('\n')}` : '【宏观输入】（未就绪）',
    researchBlock,
    [
      '【要求】',
      '1. 明确回答「何时配什么行业」：超配/低配行业、触发条件与失效条件；',
      '2. 引用中证十行业与申万一级两个粒度的评分、资金流与估值数据；信号冲突时说明取舍；',
      '3. 与最近决策及知识摘要保持口径一致，冲突处说明理由；',
      '4. 输出结构：结论摘要 → 信号解读 → 配置建议（含风险）→ 跟踪指标；',
      '5. 优先使用 finance-core / equity-research 等技能，篇幅约 500–800 字。',
    ].join('\n'),
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function buildRotationPrompt(
  snapshot: MacroDashboardSnapshot | null,
  research?: ResearchContext | null,
): string {
  return rotationBody('行业轮动周报', snapshot, research);
}

export function buildIndustryPrompt(
  detail: MacroIndustryDetail,
  snapshot: MacroDashboardSnapshot | null,
  research?: ResearchContext | null,
): string {
  const b = detail.board;
  const holdings = detail.constituents
    .slice(0, 10)
    .map(
      (c) =>
        `- ${c.name}（${c.code}）：市值 ${fmtYi(c.mcap)}，涨跌 ${fmtPct(c.changePct)}，PE ${fmtNum(
          c.pe,
        )}，PB ${fmtNum(c.pb)}`,
    )
    .join('\n');
  const macro = snapshot ? buildMacroContextLines(snapshot) : [];
  const researchBlock = formatResearchContext(research);
  const parts = [
    `请生成一份「行业定价分析」：${b.name}（${b.code}）。`,
    `【行业行情】涨跌 ${fmtPct(b.changePct)}，换手 ${fmtPct(b.turnover)}，主力净流入 ${fmtYi(
      b.mainInflow,
    )}，总市值 ${fmtYi(b.mcap)}`,
    `【估值】板块 PE ${fmtNum(b.pe)}${
      detail.pePercentile === null
        ? ''
        : `（市值 TOP100 板块分位 ${detail.pePercentile}%，越高越贵）`
    }；成分股（市值 TOP20 中位数，剔除负值与缺失）PE ${fmtNum(
      detail.peMedian,
    )} / PB ${fmtNum(detail.pbMedian)}`,
    `【成分股 TOP10】\n${holdings || '（成分股数据未就绪）'}`,
    macro.length > 0 ? `【宏观输入】\n${macro.join('\n')}` : '【宏观输入】（未就绪）',
    researchBlock,
    [
      '【要求】',
      '1. 按「盈利 → 估值 → 情绪」三要素框架系统化回答「行业内如何定价」；',
      '2. 给出估值区间判断与关键假设；数据缺失或口径近似时明确说明；',
      '3. 与最近决策及知识摘要保持口径一致，冲突处说明理由；',
      '4. 输出结构：定价结论 → 三要素依据 → 估值区间与风险 → 跟踪指标；',
      '5. 篇幅约 500–800 字，可用 markdown 表格。',
    ].join('\n'),
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function buildReviewPrompt(research?: ResearchContext | null): string {
  const block = formatResearchContext(research) || '（暂无决策与知识资产记录）';
  return [
    '请做一次「投研复盘与再训练」。',
    block,
    [
      '【要求】',
      '1. 逐条复盘未归因决策：当时依据是否成立、偏差来源（数据/模型/执行）；',
      '2. 提炼可复用经验，并指出需要修订的旧条目；',
      '3. 使用 write 工具更新 `.workbench/research/knowledge.md`（新增/修订条目，保持精炼，保留仍有效的结论）；',
      '4. 输出「修改摘要 + 下一步跟踪清单」。',
    ].join('\n'),
  ].join('\n\n');
}

/**
 * Compose the prompt for one model task template. Works with a partial/empty
 * snapshot: missing data degrades to a research-only instruction instead of
 * blocking the action (the UI never waits on data).
 */
export function buildMacroPrompt(
  themeId: MacroThemeId,
  snapshot: MacroDashboardSnapshot | null,
  research?: ResearchContext | null,
): string {
  switch (themeId) {
    case 'rotation-daily':
      return rotationBody('行业轮动日报（重点：与上一交易日相比的信号变化）', snapshot, research);
    case 'rotation-weekly':
      return buildRotationPrompt(snapshot, research);
    case 'review-weekly':
      return buildReviewPrompt(research);
    default:
      return '';
  }
}
