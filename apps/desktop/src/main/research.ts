// Research loop IO: the decision ledger + knowledge asset live in the
// workspace (organizational assets the agent may read). Writes stay in the
// main process because the sandbox protects `.workbench` from the agent.
//   <workspace>/.workbench/research/decisions.jsonl
//   <workspace>/.workbench/research/knowledge.md
//   <workspace>/.workbench/research/reports/   (background-generated reports)

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  MacroReportMeta,
  MacroReportSubject,
  MacroThemeId,
  ResearchAttributionUpdate,
  ResearchContext,
  ResearchDecision,
  ResearchOutcome,
  ResearchStance,
} from '@workbench/shared';
import { digestCharCount } from '@workbench/shared';

import { atomicWriteFile } from './atomicWrite';
import {
  applyAttribution,
  decisionsToCsv,
  isReportFile,
  latestReportsPerTheme,
  latestSubjectReport,
  mergeReviewAttributions,
  parseDecisions,
  parseReports,
  pruneReports,
  removeDecision,
  reportFileName,
  serializeDecisions,
  serializeReports,
  subjectReportFileName,
  updateDecision as updateDecisionInList,
  upsertDecision,
} from './researchData';
import { workspaceDir } from './server';

const RESEARCH_DIR = '.workbench/research';
const DECISIONS_FILE = 'decisions.jsonl';
const KNOWLEDGE_FILE = 'knowledge.md';
const REPORTS_DIR = 'reports';
const REPORTS_INDEX = 'index.json';
const DIGEST_CAP = 4000;
/** Hard cap for the persisted knowledge asset (prompts still take 4000). */
const KNOWLEDGE_CAP = 20_000;

function decisionsPath(): string {
  return join(workspaceDir(), RESEARCH_DIR, DECISIONS_FILE);
}

function knowledgePath(): string {
  return join(workspaceDir(), RESEARCH_DIR, KNOWLEDGE_FILE);
}

function researchFilePath(name: string): string {
  return join(workspaceDir(), RESEARCH_DIR, name);
}

function writeDecisions(list: ResearchDecision[]): void {
  const path = decisionsPath();
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, serializeDecisions(list));
}

export function listDecisions(): ResearchDecision[] {
  try {
    return parseDecisions(readFileSync(decisionsPath(), 'utf-8'));
  } catch {
    return [];
  }
}

export function addDecision(input: {
  model: ResearchDecision['model'];
  target: string;
  stance: ResearchStance;
  thesis: string;
  sessionId?: string;
}): ResearchDecision {
  const decision: ResearchDecision = {
    id: randomUUID(),
    model: input.model,
    target: input.target.trim(),
    stance: input.stance,
    thesis: input.thesis.trim(),
    sessionId: input.sessionId,
    createdAt: new Date().toISOString(),
    status: 'open',
  };
  writeDecisions(upsertDecision(listDecisions(), decision));
  return decision;
}

export function attributeDecision(
  id: string,
  outcome: ResearchOutcome,
  note: string,
): ResearchDecision | null {
  const list = listDecisions();
  if (!list.some((d) => d.id === id)) return null;
  const next = applyAttribution(list, id, {
    outcome,
    note: note.trim(),
    reviewedAt: new Date().toISOString(),
  });
  writeDecisions(next);
  return next.find((d) => d.id === id) ?? null;
}

/** Edit target / stance / thesis; null when the id is unknown. */
export function updateDecision(
  id: string,
  patch: { target?: string; stance?: ResearchStance; thesis?: string },
): ResearchDecision | null {
  const list = listDecisions();
  if (!list.some((d) => d.id === id)) return null;
  const next = updateDecisionInList(list, id, patch);
  writeDecisions(next);
  return next.find((d) => d.id === id) ?? null;
}

/** Remove one decision; false when the id is unknown. */
export function deleteDecision(id: string): boolean {
  const list = listDecisions();
  if (!list.some((d) => d.id === id)) return false;
  writeDecisions(removeDecision(list, id));
  return true;
}

/** Export the full ledger as CSV (workspace file); null when it is empty. */
export function exportDecisionsCsv(): { path: string; count: number } | null {
  const list = listDecisions();
  if (list.length === 0) return null;
  const path = researchFilePath('decisions.csv');
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, decisionsToCsv(list));
  return { path: `${RESEARCH_DIR}/decisions.csv`, count: list.length };
}

function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}`;
}

/** Write the leadership report markdown into the workspace research folder. */
export function exportMacroReport(markdown: string): { path: string } | null {
  const text = markdown.trim();
  if (!text) return null;
  const name = `macro-report-${fileStamp()}.md`;
  const path = researchFilePath(name);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, `${text}\n`);
  return { path: `${RESEARCH_DIR}/${name}` };
}

// ---- Background-generated reports (per macro theme task) ----

function reportsDir(): string {
  return join(workspaceDir(), RESEARCH_DIR, REPORTS_DIR);
}

function readReportsIndex(): MacroReportMeta[] {
  try {
    return parseReports(readFileSync(join(reportsDir(), REPORTS_INDEX), 'utf-8'));
  } catch {
    return [];
  }
}

/** Persist one generated report body + index entry; null on empty markdown. */
export function saveMacroReport(input: {
  themeId: MacroThemeId;
  sessionId?: string;
  markdown: string;
}): MacroReportMeta | null {
  const text = input.markdown.trim();
  if (!text) return null;
  const at = new Date();
  const meta: MacroReportMeta = {
    themeId: input.themeId,
    file: reportFileName(input.themeId, at),
    createdAt: at.toISOString(),
    chars: digestCharCount(text),
    sessionId: input.sessionId,
  };
  return writeReport(meta, text);
}

/** Persist one industry/board report; null on empty markdown. */
export function saveSubjectReport(input: {
  subject: MacroReportSubject;
  sessionId?: string;
  markdown: string;
}): MacroReportMeta | null {
  const text = input.markdown.trim();
  if (!text) return null;
  const at = new Date();
  const meta: MacroReportMeta = {
    subject: input.subject,
    file: subjectReportFileName(input.subject, at),
    createdAt: at.toISOString(),
    chars: digestCharCount(text),
    sessionId: input.sessionId,
  };
  return writeReport(meta, text);
}

/** Body + index write shared by both report families. */
function writeReport(meta: MacroReportMeta, text: string): MacroReportMeta {
  const dir = reportsDir();
  mkdirSync(dir, { recursive: true });
  atomicWriteFile(join(dir, meta.file), `${text}\n`);
  // Index caps are per family so a burst of industry reports cannot evict the
  // background briefings the page lists.
  const next = pruneReports([meta, ...readReportsIndex()]);
  atomicWriteFile(join(dir, REPORTS_INDEX), serializeReports(next));
  return meta;
}

/** Latest report per theme, newest first (what the page renders). */
export function listMacroReports(): MacroReportMeta[] {
  return latestReportsPerTheme(readReportsIndex());
}

/** The newest report for one industry/board, body included; null when none. */
export function readSubjectReport(
  subject: MacroReportSubject,
): { meta: MacroReportMeta; markdown: string } | null {
  const meta = latestSubjectReport(readReportsIndex(), subject);
  if (!meta) return null;
  const markdown = readMacroReport(meta.file);
  return markdown === null ? null : { meta, markdown };
}

/** Report body by file name; null when the name is invalid or the file is gone. */
export function readMacroReport(file: string): string | null {
  if (!isReportFile(file)) return null;
  try {
    return readFileSync(join(reportsDir(), file), 'utf-8');
  } catch {
    return null;
  }
}

/** knowledge.md digest for prompt injection; null when the file is missing/empty. */
export function readKnowledgeDigest(): string | null {
  try {
    const raw = readFileSync(knowledgePath(), 'utf-8').trim();
    if (!raw) return null;
    return raw.length > DIGEST_CAP ? `${raw.slice(0, DIGEST_CAP)}…` : raw;
  } catch {
    return null;
  }
}

/**
 * Persist the knowledge asset produced by the review model. This is the only
 * writer: the agent cannot write under `.workbench` (sandbox-protected), so the
 * review prompt returns a marker block and the main process owns the file.
 * Empty input is a no-op that keeps the existing asset intact.
 */
export function saveKnowledgeDigest(markdown: string): { chars: number; path: string } | null {
  const text = markdown.trim();
  if (!text) return null;
  const clipped = text.length > KNOWLEDGE_CAP ? text.slice(0, KNOWLEDGE_CAP) : text;
  const path = knowledgePath();
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, `${clipped}\n`);
  return { chars: digestCharCount(clipped), path: `${RESEARCH_DIR}/${KNOWLEDGE_FILE}` };
}

/**
 * Apply validated review attributions to the ledger. Only open decisions are
 * touched; unknown ids and already-reviewed entries are ignored by the merge.
 */
export function applyReviewAttributions(updates: readonly ResearchAttributionUpdate[]): {
  applied: number;
} {
  if (updates.length === 0) return { applied: 0 };
  const { list, applied } = mergeReviewAttributions(
    listDecisions(),
    updates,
    new Date().toISOString(),
  );
  if (applied > 0) writeDecisions(list);
  return { applied };
}

/** Everything the model prompts inject from the loop. */
export function getResearchContext(): ResearchContext {
  return { decisions: listDecisions(), digest: readKnowledgeDigest() };
}
