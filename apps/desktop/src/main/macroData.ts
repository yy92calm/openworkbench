// Pure parsers: raw public-API payloads → normalized macro snapshot pieces.
// No network / Electron / fs here, so every function is unit-testable with
// small fixtures (see macroData.test.ts).

import type {
  MacroBoard,
  MacroConstituent,
  MacroFundRankItem,
  MacroFxQuote,
  MacroIndicator,
  MacroKlinePoint,
  MacroPoint,
  MacroQuote,
  MacroYieldPoint,
} from '@workbench/shared';

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && v !== '-') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** `data.diff` quote rows from the ulist endpoint (fltt=2 → raw numbers). */
export function parseIndexQuotes(raw: string): MacroQuote[] {
  const json = parseJson(raw);
  const data = json?.data as { diff?: unknown } | undefined;
  if (!Array.isArray(data?.diff)) return [];
  const out: MacroQuote[] = [];
  for (const row of data.diff) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const code = asString(r.f12);
    const name = asString(r.f14);
    if (!code || !name) continue;
    out.push({
      secid: `${asNumber(r.f13) ?? 0}.${code}`,
      code,
      name,
      price: asNumber(r.f2),
      changePct: asNumber(r.f3),
      change: asNumber(r.f4),
    });
  }
  return out;
}

/** `data.klines` rows: "2026-08-24,4563.13" → {date, close}. */
export function parseKline(raw: string): MacroKlinePoint[] {
  const json = parseJson(raw);
  const data = json?.data as { klines?: unknown } | undefined;
  if (!Array.isArray(data?.klines)) return [];
  const out: MacroKlinePoint[] = [];
  for (const row of data.klines) {
    if (typeof row !== 'string') continue;
    const [date, close] = row.split(',');
    const c = asNumber(close);
    if (date && c !== null) out.push({ date, close: c });
  }
  return out;
}

/** China / US treasury yields (RPTA_WEB_TREASURYYIELD), oldest row first. */
export function parseTreasury(raw: string): MacroYieldPoint[] {
  const json = parseJson(raw);
  const result = json?.result as { data?: unknown } | undefined;
  if (!Array.isArray(result?.data)) return [];
  const out: MacroYieldPoint[] = [];
  for (const row of result.data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const date = asString(r.SOLAR_DATE)?.slice(0, 10);
    if (!date) continue;
    out.push({
      date,
      cn2y: asNumber(r.EMM00588704),
      cn5y: asNumber(r.EMM00166462),
      cn10y: asNumber(r.EMM00166466),
      cn30y: asNumber(r.EMM00166469),
      cn10y2y: asNumber(r.EMM01276014),
      us10y: asNumber(r.EMG00001310),
    });
  }
  // The API returns newest first; charts want oldest first.
  return out.reverse();
}

export type MacroReport = 'CPI' | 'PPI' | 'PMI' | 'GDP';

/** Report → indicator series definition (field names taken from the API). */
const MACRO_SERIES: Record<
  MacroReport,
  readonly { id: string; name: string; unit: string; field: string }[]
> = {
  CPI: [{ id: 'cpi', name: 'CPI 同比', unit: '%', field: 'NATIONAL_SAME' }],
  PPI: [{ id: 'ppi', name: 'PPI 同比', unit: '%', field: 'BASE_SAME' }],
  PMI: [
    { id: 'pmi', name: '制造业 PMI', unit: '', field: 'MAKE_INDEX' },
    { id: 'pmi-non-mfg', name: '非制造业 PMI', unit: '', field: 'NMAKE_INDEX' },
  ],
  GDP: [{ id: 'gdp', name: 'GDP 累计同比', unit: '%', field: 'SUM_SAME' }],
};

/** One economy report (CPI/PPI/PMI/GDP) → its indicator series, oldest first. */
export function parseMacroIndicators(report: MacroReport, raw: string): MacroIndicator[] {
  const json = parseJson(raw);
  const result = json?.result as { data?: unknown } | undefined;
  const rows = Array.isArray(result?.data) ? result.data : [];
  return MACRO_SERIES[report].map((def) => {
    const history: MacroPoint[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const date = asString(r.REPORT_DATE)?.slice(0, 10);
      if (!date) continue;
      history.push({ date, period: asString(r.TIME) ?? date, value: asNumber(r[def.field]) });
    }
    history.reverse(); // newest first → oldest first
    return {
      id: def.id,
      name: def.name,
      unit: def.unit,
      latest: history.length > 0 ? history[history.length - 1] : null,
      history,
    };
  });
}

/** USDCNH quote. */
export function parseFx(raw: string): MacroFxQuote | null {
  const json = parseJson(raw);
  const data = json?.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const pair = asString(data.f57);
  const name = asString(data.f58);
  if (!pair || !name) return null;
  return { pair, name, price: asNumber(data.f43) };
}

/**
 * Fund ranking text (`var rankData = {datas:["code,name,…,1yReturn,…", …]}`).
 * Not JSON — the endpoint returns JS source, hence the manual scan.
 */
export function parseFundRank(raw: string): MacroFundRankItem[] {
  const start = raw.indexOf('datas:[');
  if (start === -1) return [];
  const end = raw.indexOf(']', start);
  const body = raw.slice(start + 'datas:['.length, end === -1 ? undefined : end);
  const rows = body.match(/"([^"]*)"/g) ?? [];
  const out: MacroFundRankItem[] = [];
  for (const quoted of rows) {
    const fields = quoted.slice(1, -1).split(',');
    if (fields.length < 12) continue;
    const [code, name, , navDate, nav, , , , , , , return1y] = fields;
    if (!code || !name) continue;
    out.push({
      code,
      name,
      navDate: navDate ?? '',
      nav: asNumber(nav),
      return1y: asNumber(return1y),
    });
  }
  return out;
}

// ---- Industry boards (rotation universe + industry model picker) ----

function hasLevelSuffix(name: string): boolean {
  return /[ⅠⅡⅢ]$/.test(name);
}

/**
 * Dedupe boards that describe the same industry at different taxonomy levels
 * (identical market cap, e.g. 银行 / 银行Ⅱ): keep the unsuffixed name.
 */
export function dedupeBoards(boards: MacroBoard[]): MacroBoard[] {
  const kept: MacroBoard[] = [];
  for (const b of boards) {
    if (b.mcap === null) {
      kept.push(b);
      continue;
    }
    const mcap = b.mcap;
    const idx = kept.findIndex((k) => k.mcap !== null && Math.abs(k.mcap - mcap) / mcap < 0.001);
    if (idx === -1) {
      kept.push(b);
      continue;
    }
    if (hasLevelSuffix(kept[idx].name) && !hasLevelSuffix(b.name)) kept[idx] = b;
  }
  return kept;
}

/** Board list rows (涨跌/换手/主力净流入/总市值/PE), deduped across levels. */
export function parseBoards(raw: string): MacroBoard[] {
  const json = parseJson(raw);
  const data = json?.data as { diff?: unknown } | undefined;
  if (!Array.isArray(data?.diff)) return [];
  const out: MacroBoard[] = [];
  for (const row of data.diff) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const code = asString(r.f12);
    const name = asString(r.f14);
    if (!code || !name || !code.startsWith('BK')) continue;
    const pe = asNumber(r.f9);
    out.push({
      code,
      name,
      changePct: asNumber(r.f3),
      turnover: asNumber(r.f8),
      mainInflow: asNumber(r.f62),
      mcap: asNumber(r.f20),
      pe: pe !== null && pe > 0 ? pe : null,
    });
  }
  return dedupeBoards(out);
}

/** Industry constituents; negative/missing PE/PB is dropped (kept as null). */
export function parseConstituents(raw: string): MacroConstituent[] {
  const json = parseJson(raw);
  const data = json?.data as { diff?: unknown } | undefined;
  if (!Array.isArray(data?.diff)) return [];
  const out: MacroConstituent[] = [];
  for (const row of data.diff) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const code = asString(r.f12);
    const name = asString(r.f14);
    if (!code || !name) continue;
    const pe = asNumber(r.f115) ?? asNumber(r.f9);
    const pb = asNumber(r.f23);
    out.push({
      code,
      name,
      price: asNumber(r.f2),
      changePct: asNumber(r.f3),
      pe: pe !== null && pe > 0 ? pe : null,
      pb: pb !== null && pb > 0 ? pb : null,
      mcap: asNumber(r.f20),
    });
  }
  return out;
}

/** Median of the valid values (nulls dropped); null when nothing is valid. */
export function medianOf(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
}
