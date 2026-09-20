// Pure helpers for the research loop (decision ledger). No fs / Electron here
// so the merge logic stays unit-testable; IO lives in research.ts.

import type {
  MacroReportMeta,
  MacroThemeId,
  ResearchAttribution,
  ResearchDecision,
  ResearchStance,
} from '@workbench/shared';

/** Parse the JSONL ledger; malformed lines are skipped (append-only file). */
export function parseDecisions(raw: string): ResearchDecision[] {
  const out: ResearchDecision[] = [];
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    try {
      const d = JSON.parse(text) as ResearchDecision;
      if (d && typeof d.id === 'string' && typeof d.target === 'string') out.push(d);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

export function serializeDecisions(list: ResearchDecision[]): string {
  if (list.length === 0) return '';
  return `${list.map((d) => JSON.stringify(d)).join('\n')}\n`;
}

/** Append, or replace the existing entry with the same id. */
export function upsertDecision(
  list: ResearchDecision[],
  decision: ResearchDecision,
): ResearchDecision[] {
  const idx = list.findIndex((d) => d.id === decision.id);
  if (idx === -1) return [...list, decision];
  const next = list.slice();
  next[idx] = decision;
  return next;
}

/** Attach the attribution and flip the status to reviewed (no-op when id is unknown). */
export function applyAttribution(
  list: ResearchDecision[],
  id: string,
  attribution: ResearchAttribution,
): ResearchDecision[] {
  return list.map((d) => (d.id === id ? { ...d, status: 'reviewed' as const, attribution } : d));
}

/** Edit target / stance / thesis; attribution and status stay untouched. */
export function updateDecision(
  list: ResearchDecision[],
  id: string,
  patch: { target?: string; stance?: ResearchStance; thesis?: string },
): ResearchDecision[] {
  return list.map((d) =>
    d.id === id
      ? {
          ...d,
          ...(patch.target !== undefined ? { target: patch.target.trim() } : {}),
          ...(patch.stance !== undefined ? { stance: patch.stance } : {}),
          ...(patch.thesis !== undefined ? { thesis: patch.thesis.trim() } : {}),
        }
      : d,
  );
}

/** Drop one decision (no-op when the id is unknown). */
export function removeDecision(list: ResearchDecision[], id: string): ResearchDecision[] {
  return list.filter((d) => d.id !== id);
}

const CSV_HEADER = [
  'id',
  '记录时间',
  '模型',
  '标的',
  '立场',
  '论据',
  '状态',
  '归因结果',
  '归因说明',
  '归因时间',
];

function csvCell(value: string | undefined): string {
  const s = value ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with a BOM so Excel opens the Chinese text correctly. */
export function decisionsToCsv(list: readonly ResearchDecision[]): string {
  const lines = list.map((d) =>
    [
      d.id,
      d.createdAt,
      d.model,
      d.target,
      d.stance,
      d.thesis,
      d.status,
      d.attribution?.outcome,
      d.attribution?.note,
      d.attribution?.reviewedAt,
    ]
      .map(csvCell)
      .join(','),
  );
  const body = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  return `\uFEFF${CSV_HEADER.join(',')}\n${body}`;
}

// ---- Background-generated reports (pure: naming + index parsing) ----

/** Report file name: `YYYYMMDD-HHmm-<themeId>.md`. */
export function reportFileName(themeId: MacroThemeId, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(
    at.getMinutes(),
  )}-${themeId}.md`;
}

/** Only report names we generate may be read back (path traversal guard). */
export function isReportFile(name: string): boolean {
  return /^[0-9]{8}-[0-9]{4}-[a-z-]+\.md$/.test(name);
}

/** Parse the reports index; malformed entries are dropped. */
export function parseReports(raw: string): MacroReportMeta[] {
  try {
    const list = JSON.parse(raw) as MacroReportMeta[];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (r) =>
        r &&
        typeof r.themeId === 'string' &&
        typeof r.file === 'string' &&
        typeof r.createdAt === 'string' &&
        typeof r.chars === 'number',
    );
  } catch {
    return [];
  }
}

export function serializeReports(list: readonly MacroReportMeta[]): string {
  return `${JSON.stringify(list, null, 2)}\n`;
}

/** Latest report per theme, newest first (the page shows one row per theme). */
export function latestReportsPerTheme(list: readonly MacroReportMeta[]): MacroReportMeta[] {
  const best = new Map<string, MacroReportMeta>();
  for (const report of list) {
    const current = best.get(report.themeId);
    if (!current || report.createdAt > current.createdAt) best.set(report.themeId, report);
  }
  return [...best.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
