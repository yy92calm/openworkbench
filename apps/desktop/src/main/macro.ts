// Macro insights store: the single source of truth for dashboard data.
//
// Fetching happens here (main process only); the renderer reads the snapshot
// over IPC and receives pushes — it never waits on the network. The snapshot is
// cached in memory, persisted to userData for instant cold starts, and shared
// with the scheduler (macroTheme tasks build their prompt from live data).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  MacroBoard,
  MacroDashboardSnapshot,
  MacroIndicator,
  MacroIndustryDetail,
  MacroKlinePoint,
  MacroNotification,
  MacroSnapshotData,
  MacroSourceId,
  MacroSourceState,
  SwIndustryRow,
} from '@workbench/shared';
import {
  applyCanonicalIndexNames,
  attachRotationDeltas,
  boardPePercentile,
  computeRotation,
  CSI_INDUSTRY_SECIDS,
  emptyMacroSnapshot,
  FUND_INDEX_SECIDS,
} from '@workbench/shared';
import { app, net } from 'electron';

import {
  commonCutoff,
  type MacroReport,
  medianOf,
  parseBoards,
  parseConstituents,
  parseFundRank,
  parseFx,
  parseIndexQuotes,
  parseKline,
  parseMacroIndicators,
  parseSwAnalysis,
  parseSwRealtime,
  parseTreasury,
  type SwAnalysisSeries,
} from './macroData';
import { handleRefreshAlerts, initMacroNotify } from './macroNotify';
import { RotationHistoryStore } from './rotationHistory';

const FRESH_MS = 5 * 60 * 1000;
const SERIES_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** Daily analysis data changes once a day — cached an hour, stale-served. */
const SW_ANALYSIS_TTL_MS = 60 * 60 * 1000;
/** Calendar days of 申万 analysis history (~85 trading days, ~850KB). */
const SW_HISTORY_DAYS = 120;
/** The analysis payload is ~1MB; measured ~6s on a plain connection. */
const SW_FETCH_TIMEOUT_MS = 30_000;

const INDEX_SECIDS = [
  '1.000001', // 上证指数
  '0.399001', // 深证成指
  '1.000300', // 沪深300
  '1.000905', // 中证500
  '0.399006', // 创业板指
  '1.000688', // 科创50
  '100.HSI', // 恒生指数
  '100.SPX', // 标普500
  '100.NDX', // 纳斯达克100
] as const;

/** Daily closes prefetched for the mini charts (HS300 + fund index). */
const KLINE_PREFETCH: readonly string[] = ['1.000300', '1.000011'];

/** Eastmoney industry boards, one page of 100 by market cap (f9 = board PE). */
const BOARDS_URL =
  'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2' +
  '&fid=f20&fs=m:90+t:2&fields=f3,f8,f9,f12,f14,f20,f62';

function boardKlineUrl(code: string, days: number): string {
  return `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=90.${code}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&lmt=${days}&end=20500101`;
}

function constituentUrl(code: string): string {
  return (
    'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2' +
    `&fid=f20&fs=b:${code}&fields=f2,f3,f9,f12,f14,f20,f23,f115`
  );
}

const MACRO_REPORTS: readonly MacroReport[] = ['CPI', 'PPI', 'PMI', 'GDP'];
const MACRO_ORDER = ['cpi', 'ppi', 'pmi', 'pmi-non-mfg', 'gdp'];

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

type ChangeListener = (snapshot: MacroDashboardSnapshot, alerts: MacroNotification[]) => void;

function ulistUrl(secids: readonly string[]): string {
  return `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids.join(',')}&fields=f2,f3,f4,f12,f13,f14&fltt=2`;
}

function klineUrl(secid: string, days: number): string {
  return `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&lmt=${days}&end=20500101`;
}

function reportUrl(report: MacroReport): string {
  return `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_${report}&columns=ALL&pageSize=24&sortColumns=REPORT_DATE&sortTypes=-1`;
}

const TREASURY_URL =
  'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_TREASURYYIELD' +
  '&columns=SOLAR_DATE,EMM00588704,EMM00166462,EMM00166466,EMM00166469,EMM01276014,EMG00001310' +
  '&pageSize=60&sortColumns=SOLAR_DATE&sortTypes=-1';

const FX_URL =
  'https://push2.eastmoney.com/api/qt/stock/get?secid=133.USDCNH&fields=f43,f57,f58&fltt=2';

const FUND_RANK_URL =
  'https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=1nzf&st=desc&pi=1&pn=5&dx=1&v=0.1';

// Shenwan Research index-publish API (public, no key, akshare-documented):
// live quotes for the 31 level-1 industries + the daily analysis report
// (close, turnover, PE/PB, dividend yield, turnover share, float cap).
const SW_CURRENT_URL =
  'https://www.swsresearch.com/institute-sw/api/index_publish/current/?page=1&page_size=50&indextype=%E4%B8%80%E7%BA%A7%E8%A1%8C%E4%B8%9A';

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Level-1 industry analysis over the trailing window (single request). */
function swAnalysisUrl(days: number): string {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    page: '1',
    page_size: '10000',
    index_type: '一级行业',
    start_date: localDate(start),
    end_date: localDate(end),
    type: 'DAY',
    swindexcode: 'all',
  });
  return `https://www.swsresearch.com/institute-sw/api/index_analysis/index_analysis_report/?${params}`;
}

/**
 * Chromium's network stack when running inside Electron: honors the system
 * proxy and completes incomplete TLS chains via AIA (www.swsresearch.com ships
 * a leaf certificate only, which Node's fetch rejects with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE). Falls back to the global fetch outside
 * Electron (unit tests).
 */
function rawFetch(input: string, init: RequestInit): Promise<Response> {
  if (typeof net?.fetch === 'function' && app.isReady()) return net.fetch(input, init);
  return fetch(input, init);
}

/** Fetch failures carry the real reason in `cause` (undici) or the message. */
function fetchErrorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  let detail = '';
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    detail =
      typeof code === 'string' && !cause.message.includes(code)
        ? `${cause.message} (${code})`
        : cause.message;
  } else if (cause !== undefined) {
    detail = String(cause);
  }
  if (!detail || err.message.includes(detail)) return err.message;
  return `${err.message}：${detail}`;
}

/**
 * One text GET. Transient network failures are retried with a short backoff
 * (the quote host drops connections intermittently); HTTP status errors are
 * deterministic and are not retried.
 */
async function fetchText(
  url: string,
  referer?: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  attempts = 3,
): Promise<string> {
  const headers = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    ...(referer ? { Referer: referer } : {}),
  };
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await rawFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (err instanceof Error && /^HTTP \d/.test(err.message)) break;
      if (attempt < attempts - 1)
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(fetchErrorText(lastError));
}

function computeErrors(sources: Record<MacroSourceId, MacroSourceState>): string[] {
  return Object.entries(sources)
    .filter(([, s]) => s.status === 'error')
    .map(([id, s]) => `${id}: ${s.error ?? '数据源不可用'}`);
}

class MacroStore {
  private snapshot: MacroDashboardSnapshot = emptyMacroSnapshot();
  private inFlight: Promise<void> | null = null;
  private listeners = new Set<ChangeListener>();
  private series = new Map<string, { at: number; points: MacroKlinePoint[] }>();
  private industryCache = new Map<string, { at: number; detail: MacroIndustryDetail }>();
  private swAnalysisCache: { at: number; data: Map<string, SwAnalysisSeries> } | null = null;
  private rotationHistory = new RotationHistoryStore();
  private cacheFile: string | null = null;

  /** Load the persisted snapshot and kick off a refresh if stale. */
  init(): void {
    initMacroNotify(app.getPath('userData'));
    this.cacheFile = join(app.getPath('userData'), 'macro-cache.json');
    this.rotationHistory.load(join(app.getPath('userData'), 'macro-rotation-history.json'));
    try {
      const parsed = JSON.parse(readFileSync(this.cacheFile, 'utf-8')) as {
        snapshot?: MacroDashboardSnapshot;
      };
      const cached = parsed?.snapshot;
      if (cached && typeof cached.seq === 'number' && cached.data) {
        const sources = { ...cached.sources };
        for (const key of Object.keys(sources) as MacroSourceId[]) {
          if (sources[key].status === 'loading') sources[key] = { ...sources[key], status: 'idle' };
        }
        this.snapshot = { ...cached, refreshing: false, sources };
      }
    } catch {
      /* first run — no cache yet */
    }
    if (this.isStale()) void this.refresh(true);
  }

  onChange(cb: ChangeListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  getSnapshot(): MacroDashboardSnapshot {
    return this.snapshot;
  }

  /** The scheduler's path: await a live refresh, fall back to last known data. */
  async refreshAndWait(): Promise<MacroDashboardSnapshot> {
    try {
      await this.refresh(true);
    } catch {
      /* keep the last known snapshot */
    }
    return this.snapshot;
  }

  /** Fire-and-forget; skips a refresh when the data is still fresh. */
  refreshIfStale(force = false): void {
    if (!force && !this.isStale()) return;
    void this.refresh(force);
  }

  refresh(force = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!force && !this.isStale()) return Promise.resolve();
    this.inFlight = this.runRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** On-demand daily closes for the detail dialog (cached 5 minutes). */
  async getSeries(secid: string, days = 120): Promise<MacroKlinePoint[]> {
    const key = `${secid}:${days}`;
    const hit = this.series.get(key);
    if (hit && Date.now() - hit.at < SERIES_TTL_MS) return hit.points;
    const points = parseKline(await fetchText(klineUrl(secid, days)));
    this.series.set(key, { at: Date.now(), points });
    return points;
  }

  private isStale(): boolean {
    if (!this.snapshot.fetchedAt) return true;
    return Date.now() - Date.parse(this.snapshot.fetchedAt) > FRESH_MS;
  }

  private async runRefresh(): Promise<void> {
    // Alerts need a baseline: the very first refresh only primes the data.
    const prev = this.snapshot.fetchedAt ? this.snapshot : null;
    this.update({ refreshing: true });

    const groups: readonly [MacroSourceId, () => Promise<Partial<MacroSnapshotData>>][] = [
      ['indices', () => this.fetchIndices()],
      ['yields', () => this.fetchYields()],
      ['macro', () => this.fetchMacro()],
      ['fx', () => this.fetchFx()],
      ['funds', () => this.fetchFunds()],
      ['industries', () => this.fetchIndustries()],
      ['sw', () => this.fetchSw()],
    ];

    await Promise.all(
      groups.map(async ([id, run]) => {
        this.setSource(id, { status: 'loading' });
        try {
          const patch = await run();
          this.update({ data: { ...this.snapshot.data, ...patch } });
          this.setSource(id, { status: 'ready', fetchedAt: new Date().toISOString() });
        } catch (err) {
          this.setSource(id, { status: 'error', error: fetchErrorText(err) });
        }
      }),
    );

    this.update({ refreshing: false, fetchedAt: new Date().toISOString() });
    const alerts = handleRefreshAlerts(prev, this.snapshot);
    this.persist();
    if (alerts.length > 0) this.emit(alerts);
  }

  private async fetchIndices(): Promise<Partial<MacroSnapshotData>> {
    const quotesRaw = await fetchText(ulistUrl(INDEX_SECIDS));
    const indices = parseIndexQuotes(quotesRaw);
    if (indices.length === 0) throw new Error('指数行情解析为空');
    // Mini-chart history is best-effort — never fails the quote group.
    const klines: Record<string, MacroKlinePoint[]> = { ...this.snapshot.data.klines };
    await Promise.all(
      KLINE_PREFETCH.map(async (secid) => {
        try {
          const points = parseKline(await fetchText(klineUrl(secid, 60)));
          if (points.length > 0) klines[secid] = points;
        } catch {
          /* keep the previous series */
        }
      }),
    );
    return { indices, klines };
  }

  private async fetchYields(): Promise<Partial<MacroSnapshotData>> {
    const yields = parseTreasury(await fetchText(TREASURY_URL));
    if (yields.length === 0) throw new Error('收益率数据解析为空');
    return { yields };
  }

  private async fetchMacro(): Promise<Partial<MacroSnapshotData>> {
    const settled = await Promise.allSettled(
      MACRO_REPORTS.map(async (report) => ({
        report,
        items: parseMacroIndicators(report, await fetchText(reportUrl(report))),
      })),
    );
    const byId = new Map<string, MacroIndicator>(this.snapshot.data.macro.map((i) => [i.id, i]));
    let ok = false;
    for (const res of settled) {
      if (res.status !== 'fulfilled') continue;
      for (const item of res.value.items) {
        if (item.latest?.value != null) {
          ok = true;
          byId.set(item.id, item);
        }
      }
    }
    if (!ok) throw new Error('宏观指标解析为空');
    const macro = MACRO_ORDER.map((id) => byId.get(id)).filter((i): i is MacroIndicator => !!i);
    return { macro };
  }

  private async fetchFx(): Promise<Partial<MacroSnapshotData>> {
    const fx = parseFx(await fetchText(FX_URL));
    if (!fx || fx.price === null) throw new Error('汇率数据解析为空');
    return { fx };
  }

  private async fetchFunds(): Promise<Partial<MacroSnapshotData>> {
    const [quotesRes, rankRes] = await Promise.allSettled([
      fetchText(ulistUrl(FUND_INDEX_SECIDS)),
      fetchText(FUND_RANK_URL, 'https://fund.eastmoney.com/'),
    ]);
    const indices =
      quotesRes.status === 'fulfilled'
        ? applyCanonicalIndexNames(parseIndexQuotes(quotesRes.value))
        : [];
    const top = rankRes.status === 'fulfilled' ? parseFundRank(rankRes.value).slice(0, 5) : [];
    if (indices.length === 0 && top.length === 0) throw new Error('基金数据解析为空');
    return { funds: { indices, top } };
  }

  /** Rotation universe: CSI industry indices + boards for the industry model. */
  private async fetchIndustries(): Promise<Partial<MacroSnapshotData>> {
    const [quotesRes, boardsRes, hsRes] = await Promise.allSettled([
      fetchText(ulistUrl(CSI_INDUSTRY_SECIDS)),
      fetchText(BOARDS_URL),
      fetchText(klineUrl('1.000300', 60)),
    ]);
    const quotes =
      quotesRes.status === 'fulfilled'
        ? applyCanonicalIndexNames(parseIndexQuotes(quotesRes.value))
        : [];
    const boards = boardsRes.status === 'fulfilled' ? parseBoards(boardsRes.value) : [];
    const hs300 = hsRes.status === 'fulfilled' ? parseKline(hsRes.value) : [];
    if (quotes.length === 0) throw new Error('行业指数解析为空');
    // Per-industry history is best-effort: a missing kline degrades that row.
    const series = await Promise.all(
      quotes.map(async (q) => {
        try {
          const klines = parseKline(await fetchText(klineUrl(q.secid, 60)));
          return { secid: q.secid, name: q.name, klines };
        } catch {
          return { secid: q.secid, name: q.name, klines: [] as MacroKlinePoint[] };
        }
      }),
    );
    // Deltas are vs the previous trading day (the market date of the fetched
    // data, so weekend refreshes never fabricate a new day).
    const rows = computeRotation(series, hs300);
    const asOf =
      hs300.length > 0 ? hs300[hs300.length - 1].date : new Date().toISOString().slice(0, 10);
    const rotation = attachRotationDeltas(rows, this.rotationHistory.previous(asOf));
    this.rotationHistory.record(asOf, rotation);
    return { rotation, boards };
  }

  /** Daily analysis (fundamentals + closes): cached an hour, stale-served. */
  private async loadSwAnalysis(): Promise<Map<string, SwAnalysisSeries>> {
    const hit = this.swAnalysisCache;
    if (hit && Date.now() - hit.at < SW_ANALYSIS_TTL_MS) return hit.data;
    try {
      const data = parseSwAnalysis(
        // The ~1MB payload gets a wider timeout; two attempts max to bound latency.
        await fetchText(swAnalysisUrl(SW_HISTORY_DAYS), undefined, SW_FETCH_TIMEOUT_MS, 2),
      );
      if (data.size === 0) throw new Error('申万行业分析解析为空');
      this.swAnalysisCache = { at: Date.now(), data };
      return data;
    } catch (err) {
      if (hit) return hit.data;
      throw err;
    }
  }

  /** Shenwan panorama: live quotes + valuation/scoring up to the cutoff date. */
  private async fetchSw(): Promise<Partial<MacroSnapshotData>> {
    const [quotesRes, analysisRes, hsRes] = await Promise.allSettled([
      fetchText(SW_CURRENT_URL),
      this.loadSwAnalysis(),
      fetchText(klineUrl('1.000300', 120)),
    ]);
    const analysis = analysisRes.status === 'fulfilled' ? analysisRes.value : null;
    if (!analysis || analysis.size === 0) {
      throw new Error(
        analysisRes.status === 'rejected' && analysisRes.reason instanceof Error
          ? analysisRes.reason.message
          : '申万行业数据未就绪',
      );
    }
    const cutoff = commonCutoff(analysis);
    if (!cutoff) throw new Error('申万行业分析日期缺失');
    const quotes = quotesRes.status === 'fulfilled' ? parseSwRealtime(quotesRes.value) : [];
    const hs300 = hsRes.status === 'fulfilled' ? parseKline(hsRes.value) : [];
    const quoteByCode = new Map(quotes.map((q) => [q.code, q]));
    const liveTotal = quotes.reduce((sum, q) => sum + (q.amount ?? 0), 0);

    // Same transparent scoring as the CSI rotation: 60 trading days ending at
    // the cutoff date, percentile ranks computed within these industries.
    const industries = [...analysis.entries()].flatMap(([code, series]) => {
      const closes = series.rows.filter((r) => r.date <= cutoff && r.close !== null).slice(-60);
      if (closes.length < 2) return [];
      return [
        {
          secid: code,
          name: series.name,
          klines: closes.map((r) => ({ date: r.date, close: r.close as number })),
        },
      ];
    });
    if (industries.length === 0) throw new Error('申万行业收盘序列缺失');
    const hs = hs300.filter((p) => p.date <= cutoff).slice(-60);
    const rows = computeRotation(industries, hs);
    const scored = attachRotationDeltas(rows, this.rotationHistory.previous(cutoff));
    this.rotationHistory.record(cutoff, scored);

    const swIndustries: SwIndustryRow[] = scored.map((row) => {
      const upto = (analysis.get(row.secid)?.rows ?? []).filter((r) => r.date <= cutoff);
      const latest = upto.length > 0 ? upto[upto.length - 1] : null;
      const quote = quoteByCode.get(row.secid);
      const changePct =
        quote && quote.close !== null && quote.prevClose
          ? Math.round((quote.close / quote.prevClose - 1) * 10000) / 100
          : null;
      return {
        code: row.secid,
        name: row.name,
        changePct,
        amount: quote?.amount ?? null,
        amountShare:
          quote?.amount != null && liveTotal > 0
            ? Math.round((quote.amount / liveTotal) * 10000) / 100
            : null,
        asOf: cutoff,
        close: latest?.close ?? null,
        turnover: latest?.turnover ?? null,
        pe: latest?.pe ?? null,
        pb: latest?.pb ?? null,
        dividend: latest?.dividend ?? null,
        mcap: latest?.mcap ?? null,
        ret60: row.ret60,
        rs60: row.rs60,
        trend: row.trend,
        vol60: row.vol60,
        score: row.score,
        signal: row.signal,
        scoreDelta: row.scoreDelta,
        history: upto.flatMap((r) => (r.close === null ? [] : [{ date: r.date, close: r.close }])),
      };
    });
    return { swIndustries };
  }

  /** On-demand industry detail (constituent valuation + 120-day history). */
  async getIndustry(board: MacroBoard): Promise<MacroIndustryDetail | null> {
    if (!/^BK\d{3,4}$/.test(board.code)) return null;
    const hit = this.industryCache.get(board.code);
    if (hit && Date.now() - hit.at < SERIES_TTL_MS) return hit.detail;
    const [klineRes, consRes] = await Promise.allSettled([
      fetchText(boardKlineUrl(board.code, 120)),
      fetchText(constituentUrl(board.code)),
    ]);
    const klines = klineRes.status === 'fulfilled' ? parseKline(klineRes.value) : [];
    const constituents = consRes.status === 'fulfilled' ? parseConstituents(consRes.value) : [];
    if (klines.length === 0 && constituents.length === 0) return null;
    const detail: MacroIndustryDetail = {
      board,
      klines,
      constituents,
      peMedian: medianOf(constituents.map((c) => c.pe)),
      pbMedian: medianOf(constituents.map((c) => c.pb)),
      pePercentile: boardPePercentile(this.snapshot.data.boards, board.pe),
      fetchedAt: new Date().toISOString(),
    };
    this.industryCache.set(board.code, { at: Date.now(), detail });
    return detail;
  }

  private setSource(id: MacroSourceId, state: MacroSourceState): void {
    this.update({
      sources: { ...this.snapshot.sources, [id]: { ...this.snapshot.sources[id], ...state } },
    });
  }

  private update(patch: Partial<MacroDashboardSnapshot>): void {
    const snapshot: MacroDashboardSnapshot = {
      ...this.snapshot,
      ...patch,
      seq: this.snapshot.seq + 1,
    };
    snapshot.errors = computeErrors(snapshot.sources);
    this.snapshot = snapshot;
    this.emit([]);
  }

  private emit(alerts: MacroNotification[]): void {
    for (const cb of this.listeners) cb(this.snapshot, alerts);
  }

  private persist(): void {
    if (!this.cacheFile) return;
    try {
      writeFileSync(this.cacheFile, JSON.stringify({ snapshot: this.snapshot }, null, 2), 'utf-8');
    } catch {
      /* cache persistence is best-effort */
    }
  }
}

export const macroStore = new MacroStore();
