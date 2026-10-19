// LLM Wiki: the agent compiles conversations and long-term memories into an
// interlinked markdown wiki. The LLM is the only writer; the app owns the
// deterministic parts (storage, index, backlinks, log, incremental state).
//
// Layout under <userData>/wiki:
//   pages/<slug>.md  body + frontmatter
//   index.json       metadata + link graph, rebuilt by scanning pages/
//   index.md         generated human-readable catalog
//   log.md           append-only compile log
//   state.json       last check/compile time + per-source fingerprints
//
// Pure file IO over an explicit directory (except the daily scheduler, which
// takes a runtime getter) so the compile protocol is unit-testable with a
// fake LLM.

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AgentHistoryMessage,
  type AgentRuntime,
  createAgentRuntime,
} from '@workbench/sdk/agent-runtime';
import type {
  WikiCompileResult,
  WikiLintIssue,
  WikiLintReport,
  WikiPage,
  WikiPageMeta,
  WikiStatus,
} from '@workbench/shared';

import { atomicWriteFile, readJsonFile } from './atomicWrite';
import { getEntry, listEntries } from './knowledge';
import { getLogger } from './logging';

const PAGES_DIR = 'pages';
const INDEX_FILE = 'index.json';
const INDEX_MD = 'index.md';
const LOG_FILE = 'log.md';
const STATE_FILE = 'state.json';
const ENTRY_EXT = '.md';
const FRONTMATTER = '---';
const MEMORY_CATEGORY = 'auto-memory';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PAGES_PER_COMPILE = 6;
const MAX_CONTENT_CHARS = 12_000;
const MAX_PROMPT_SOURCE_CHARS = 48_000;
const MAX_TRACKED_SOURCES = 500;
const MAX_CATALOG_PAGES = 80;

// ---- types ----

export interface WikiSource {
  /** `session:<id>` or `memory:<id>`. */
  id: string;
  kind: 'session' | 'memory';
  title: string;
  text: string;
  /** Changes whenever the source content changes. */
  fingerprint: string;
}

export interface WikiPageInput {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  content: string;
  sources: string[];
}

interface WikiState {
  lastCompiledAt?: string;
  lastCheckedAt?: string;
  sources?: Record<string, { fingerprint: string; compiledAt: string }>;
}

let compiling = false;

// ---- slug / frontmatter ----

/** A slug becomes a file name, so it must not be able to walk out of pages/. */
export function isValidWikiSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

const PLAIN_VALUE = /^[^\n"#]*$/;

function scalar(value: string): string {
  return PLAIN_VALUE.test(value) ? value : JSON.stringify(value);
}

function readScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === 'string') return parsed;
    } catch {
      /* keep the literal text */
    }
  }
  return value;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function renderWikiPage(page: WikiPage): string {
  const head = [
    FRONTMATTER,
    `title: ${scalar(page.title)}`,
    `summary: ${scalar(page.summary)}`,
    `tags: ${JSON.stringify(page.tags)}`,
    `sources: ${JSON.stringify(page.sources)}`,
    `created: ${page.created}`,
    `updated: ${page.updated}`,
    FRONTMATTER,
  ].join('\n');
  return `${head}\n\n${page.content}`;
}

/** Missing/broken frontmatter degrades to a body-only page rather than
 *  hiding or deleting it. */
export function parseWikiPage(raw: string, slug: string): WikiPage {
  const page: WikiPage = {
    slug,
    title: '',
    summary: '',
    tags: [],
    sources: [],
    created: '',
    updated: '',
    content: '',
    links: [],
    backlinks: [],
  };
  if (!raw.startsWith(FRONTMATTER)) return { ...page, content: raw };
  const end = raw.indexOf(`\n${FRONTMATTER}`, FRONTMATTER.length);
  if (end === -1) return { ...page, content: raw };

  for (const line of raw.slice(FRONTMATTER.length, end).split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key === 'title') page.title = readScalar(value);
    else if (key === 'summary') page.summary = readScalar(value);
    else if (key === 'created') page.created = value;
    else if (key === 'updated') page.updated = value;
    else if (key === 'tags') page.tags = parseStringArray(value);
    else if (key === 'sources') page.sources = parseStringArray(value);
  }

  let body = raw.slice(end + FRONTMATTER.length + 1);
  for (let i = 0; i < 2; i++) {
    if (body.startsWith('\r\n')) body = body.slice(2);
    else if (body.startsWith('\n')) body = body.slice(1);
  }
  return { ...page, content: body, links: extractLinks(body) };
}

// ---- links ----

const LINK_PATTERN = /\[\[([a-z0-9][a-z0-9-]{0,63})\]\]/g;

export function extractLinks(content: string): string[] {
  const links = new Set<string>();
  for (const match of content.matchAll(LINK_PATTERN)) links.add(match[1]);
  return [...links].sort();
}

// ---- scan / index ----

function pagesDir(dir: string): string {
  return join(dir, PAGES_DIR);
}

function pageFile(dir: string, slug: string): string {
  return join(pagesDir(dir), `${slug}${ENTRY_EXT}`);
}

function metaOf(page: WikiPage): WikiPageMeta {
  const { content: _content, ...meta } = page;
  return meta;
}

/** Newest first; ties broken by slug so listing is stable. */
function sortMetas(metas: WikiPageMeta[]): WikiPageMeta[] {
  return [...metas].sort((a, b) =>
    a.updated === b.updated ? a.slug.localeCompare(b.slug) : b.updated.localeCompare(a.updated),
  );
}

function scanPages(dir: string): { pages: WikiPage[]; errors: string[] } {
  const root = pagesDir(dir);
  if (!existsSync(root)) return { pages: [], errors: [] };
  const pages: WikiPage[] = [];
  const errors: string[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(ENTRY_EXT)) continue;
    const slug = name.slice(0, -ENTRY_EXT.length);
    if (!isValidWikiSlug(slug)) {
      errors.push(name);
      continue;
    }
    try {
      pages.push(parseWikiPage(readFileSync(join(root, name), 'utf-8'), slug));
    } catch {
      errors.push(name);
    }
  }
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  for (const page of pages) page.backlinks = [];
  for (const page of pages) {
    for (const link of page.links) bySlug.get(link)?.backlinks.push(page.slug);
  }
  for (const page of pages) page.backlinks.sort();
  return { pages, errors };
}

function scanMetas(dir: string): { metas: WikiPageMeta[]; errors: string[] } {
  const { pages, errors } = scanPages(dir);
  return { metas: sortMetas(pages.map(metaOf)), errors };
}

/** Deterministic catalog: one section per tag, pages under every tag they carry. */
function renderIndexMarkdown(metas: WikiPageMeta[]): string {
  const groups = new Map<string, WikiPageMeta[]>();
  for (const meta of metas) {
    const tags = meta.tags.length > 0 ? meta.tags : ['未分类'];
    for (const tag of tags) {
      const list = groups.get(tag) ?? [];
      list.push(meta);
      groups.set(tag, list);
    }
  }
  const lines = ['# Wiki Index', '', `共 ${metas.length} 个页面。`, ''];
  for (const tag of [...groups.keys()].sort()) {
    lines.push(`## ${tag}`, '');
    for (const meta of groups.get(tag)!) {
      lines.push(`- [[${meta.slug}]] — ${meta.title}：${meta.summary}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function writeIndex(dir: string, metas: WikiPageMeta[]): void {
  mkdirSync(dir, { recursive: true });
  atomicWriteFile(join(dir, INDEX_FILE), JSON.stringify(metas, null, 2));
  atomicWriteFile(join(dir, INDEX_MD), renderIndexMarkdown(metas));
}

function rebuildIndex(dir: string): WikiPageMeta[] {
  const { metas } = scanMetas(dir);
  writeIndex(dir, metas);
  return metas;
}

function readIndexRaw(dir: string): WikiPageMeta[] | null {
  const file = join(dir, INDEX_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return null;
    if (
      !parsed.every(
        (m) => m && typeof m === 'object' && typeof (m as WikiPageMeta).slug === 'string',
      )
    ) {
      return null;
    }
    return parsed as WikiPageMeta[];
  } catch {
    return null;
  }
}

/** A missing/corrupt index is derived data: rebuild it. A page-count mismatch
 *  is the cheap stale-index signal (content edits are caught by lint/compile). */
function readIndex(dir: string): WikiPageMeta[] {
  const raw = readIndexRaw(dir);
  if (raw) {
    let fileCount = 0;
    try {
      fileCount = readdirSync(pagesDir(dir)).filter((n) => n.endsWith(ENTRY_EXT)).length;
    } catch {
      fileCount = 0;
    }
    if (raw.length === fileCount) return sortMetas(raw);
  }
  return rebuildIndex(dir);
}

// ---- state ----

function stateFile(dir: string): string {
  return join(dir, STATE_FILE);
}

function readState(dir: string): WikiState {
  const raw = readJsonFile<WikiState>(stateFile(dir), {});
  return {
    lastCompiledAt: raw.lastCompiledAt,
    lastCheckedAt: raw.lastCheckedAt ?? raw.lastCompiledAt,
    sources: raw.sources && typeof raw.sources === 'object' ? raw.sources : {},
  };
}

function writeState(dir: string, state: WikiState): void {
  mkdirSync(dir, { recursive: true });
  const entries = Object.entries(state.sources ?? {})
    .sort((a, b) => b[1].compiledAt.localeCompare(a[1].compiledAt))
    .slice(0, MAX_TRACKED_SOURCES);
  atomicWriteFile(
    stateFile(dir),
    JSON.stringify({ ...state, sources: Object.fromEntries(entries) }, null, 2),
  );
}

function appendLog(
  dir: string,
  entry: {
    time: string;
    trigger: 'manual' | 'daily';
    pages: number;
    sources: number;
    slugs: string[];
  },
): void {
  const file = join(dir, LOG_FILE);
  let existing = '';
  try {
    existing = readFileSync(file, 'utf-8');
  } catch {
    /* first compile */
  }
  const line = `- ${entry.time} trigger=${entry.trigger} pages=${entry.pages} sources=${entry.sources} slugs=${entry.slugs.join(',') || '-'}`;
  mkdirSync(dir, { recursive: true });
  atomicWriteFile(
    file,
    existing ? `${existing.replace(/\n?$/, '\n')}${line}\n` : `# Wiki Compile Log\n\n${line}\n`,
  );
}

// ---- public storage API ----

/** Page metadata only (bodies load on demand), newest first. */
export function listWikiPages(dir: string): WikiPageMeta[] {
  return readIndex(dir);
}

export function getWikiPage(dir: string, slug: string): WikiPage {
  if (!isValidWikiSlug(slug)) throw new Error(`非法的 Wiki 页面 slug: ${slug}`);
  const file = pageFile(dir, slug);
  if (!existsSync(file)) throw new Error(`Wiki 页面不存在: ${slug}`);
  const page = parseWikiPage(readFileSync(file, 'utf-8'), slug);
  const index = readIndex(dir);
  return { ...page, backlinks: index.find((m) => m.slug === slug)?.backlinks ?? [] };
}

export interface WikiUpsertResult {
  created: number;
  updated: number;
  metas: WikiPageMeta[];
}

/** Upsert validated pages. `created` is preserved for existing pages; the
 *  index, catalog and backlinks are rebuilt deterministically afterwards. */
export function upsertWikiPages(
  dir: string,
  inputs: WikiPageInput[],
  now = new Date(),
): WikiUpsertResult {
  const bySlug = new Map(inputs.map((input) => [input.slug, input]));
  mkdirSync(pagesDir(dir), { recursive: true });
  let created = 0;
  let updated = 0;
  for (const input of bySlug.values()) {
    const file = pageFile(dir, input.slug);
    const existing = existsSync(file)
      ? parseWikiPage(readFileSync(file, 'utf-8'), input.slug)
      : null;
    const page: WikiPage = {
      slug: input.slug,
      title: input.title.trim(),
      summary: input.summary.trim(),
      tags: normalizeTags(input.tags),
      sources: normalizeSources(input.sources),
      created: existing?.created || now.toISOString(),
      updated: now.toISOString(),
      content: input.content,
      links: extractLinks(input.content),
      backlinks: [],
    };
    atomicWriteFile(file, renderWikiPage(page));
    if (existing) updated++;
    else created++;
  }
  return { created, updated, metas: rebuildIndex(dir) };
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
    .map((t) => t.slice(0, 32))
    .slice(0, 8);
}

function normalizeSources(sources: string[]): string[] {
  return [
    ...new Set(
      sources.map((s) => s.trim()).filter((s) => /^(session|memory):[^\s]{1,200}$/.test(s)),
    ),
  ].slice(0, 20);
}

// ---- source collection ----

export function collectMemorySources(knowledgeDir: string, limit = 40): WikiSource[] {
  const metas = listEntries(knowledgeDir)
    .filter((e) => e.category === MEMORY_CATEGORY)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, limit);

  const sources: WikiSource[] = [];
  for (const meta of metas) {
    try {
      const entry = getEntry(knowledgeDir, meta.id);
      const text = `${entry.title}\n${entry.summary}\n${entry.content}`.slice(0, 1500);
      sources.push({
        id: `memory:${entry.id}`,
        kind: 'memory',
        title: entry.title,
        text,
        fingerprint: entry.updated,
      });
    } catch {
      // One unreadable memory must not block the batch.
    }
  }
  return sources;
}

function formatTranscript(messages: AgentHistoryMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role === 'user' ? '用户' : '助手';
    for (const part of msg.parts) {
      if (part.type === 'text' && part.text && !part.synthetic) {
        lines.push(`【${role}】${part.text}`);
      }
    }
  }
  return lines.join('\n\n');
}

export async function collectSessionSources(
  client: AgentRuntime,
  limit = 10,
  maxCharsPerSession = 4000,
): Promise<WikiSource[]> {
  const sessions = (await client.listSessions())
    .filter((s) => !s.parentId)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);

  const sources: WikiSource[] = [];
  for (const session of sessions) {
    try {
      const messages = await client.getMessages(session.id);
      if (messages.filter((m) => m.role === 'user').length < 2) continue;
      const transcript = formatTranscript(messages);
      if (!transcript.trim()) continue;
      sources.push({
        id: `session:${session.id}`,
        kind: 'session',
        title: session.title,
        text: transcript.slice(0, maxCharsPerSession),
        fingerprint: `${session.updatedAt ?? 0}:${messages.length}`,
      });
    } catch {
      // A session that cannot be read is simply not part of this compile.
    }
  }
  return sources;
}

/** Keep the newest sources that fit the prompt budget. */
function boundSources(sources: WikiSource[], maxChars: number): WikiSource[] {
  const bounded: WikiSource[] = [];
  let used = 0;
  for (const source of sources) {
    const room = maxChars - used;
    if (room < 120) break;
    const text = source.text.slice(0, room);
    bounded.push({ ...source, text });
    used += text.length;
  }
  return bounded;
}

// ---- compile ----

export function buildCompilePrompt(dir: string, sources: WikiSource[]): string {
  const catalog = listWikiPages(dir)
    .slice(0, MAX_CATALOG_PAGES)
    .map((m) => `- ${m.slug} | ${m.title} | ${m.summary} | ${m.tags.join(',')}`);
  return `你是 Workbench 的 LLM Wiki 编译器。请把下面的新素材编译成互相链接的 Markdown 页面。

现有页面目录（优先更新已有页面；只有主题确实不同才新建）：
${catalog.length > 0 ? catalog.join('\n') : '（暂无页面）'}

要求：
- 只输出 JSON，不要输出任何解释或 Markdown 围栏。
- 输出格式：
{"pages":[{"slug":"英文小写短横线","title":"标题","summary":"一句话摘要","tags":["标签"],"content":"正文，可用 [[slug]] 链接其他页面","sources":["素材ID"]}]}
- slug 只能包含 a-z、0-9 和 -，最多 64 字符。
- 每页正文不超过 12000 字符，单次最多输出 6 页。
- 页面必须独立可读：背景、结论、关键决策；不要编造素材中没有的事实。
- sources 只能使用下方素材的方括号 ID。

新素材：
${sources.map((s) => `[${s.id}] ${s.title}\n${s.text}`).join('\n\n---\n\n')}`;
}

export interface ParsedWikiCompile {
  pages: WikiPageInput[];
  skipped: number;
  error?: string;
}

/** Parse the LLM's JSON, tolerating markdown fences and surrounding prose. */
export function parseWikiCompileResponse(text: string): ParsedWikiCompile {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return { pages: [], skipped: 0, error: '响应中没有 JSON 对象' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch (err) {
    return {
      pages: [],
      skipped: 0,
      error: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const rawPages = (parsed as { pages?: unknown }).pages;
  if (!Array.isArray(rawPages)) return { pages: [], skipped: 0, error: '响应缺少 pages 数组' };

  const pages: WikiPageInput[] = [];
  let skipped = 0;
  for (const raw of rawPages) {
    if (pages.length >= MAX_PAGES_PER_COMPILE) {
      skipped++;
      continue;
    }
    const page = validatePageInput(raw);
    if (!page) {
      skipped++;
      continue;
    }
    const duplicate = pages.findIndex((p) => p.slug === page.slug);
    if (duplicate !== -1) pages[duplicate] = page;
    else pages.push(page);
  }
  return { pages, skipped };
}

function validatePageInput(raw: unknown): WikiPageInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.slug !== 'string' || !isValidWikiSlug(obj.slug)) return null;
  if (typeof obj.title !== 'string' || !obj.title.trim()) return null;
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) return null;
  if (typeof obj.content !== 'string' || !obj.content.trim()) return null;
  return {
    slug: obj.slug,
    title: obj.title.trim().slice(0, 120),
    summary: obj.summary.trim().slice(0, 400),
    tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [],
    content: obj.content.slice(0, MAX_CONTENT_CHARS),
    sources: Array.isArray(obj.sources)
      ? obj.sources.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

/**
 * Compile pending sources through the injected LLM. Nothing is written when
 * the response cannot be validated — the same sources are retried next run.
 */
export async function compileWiki(opts: {
  dir: string;
  sources: WikiSource[];
  ask: (prompt: string) => Promise<string>;
  trigger: 'manual' | 'daily';
  force?: boolean;
  now?: Date;
}): Promise<WikiCompileResult> {
  const { dir, sources, ask, trigger, force = false, now = new Date() } = opts;
  const state = readState(dir);
  const pending = sources.filter(
    (s) => force || state.sources?.[s.id]?.fingerprint !== s.fingerprint,
  );
  const totalPages = listWikiPages(dir).length;
  const base: WikiCompileResult = {
    ok: true,
    trigger,
    pages: totalPages,
    created: 0,
    updated: 0,
    sources: 0,
    skipped: 0,
  };

  if (pending.length === 0) {
    writeState(dir, { ...state, lastCheckedAt: now.toISOString() });
    return { ...base, reason: 'no-new-sources' };
  }

  const checkedAt = now.toISOString();
  let response: string;
  try {
    response = await ask(buildCompilePrompt(dir, pending));
  } catch (err) {
    writeState(dir, { ...state, lastCheckedAt: checkedAt });
    return {
      ...base,
      ok: false,
      reason: 'llm-error',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const parsed = parseWikiCompileResponse(response);
  if (parsed.error) {
    writeState(dir, { ...state, lastCheckedAt: checkedAt });
    return {
      ...base,
      ok: false,
      reason: 'invalid-llm-response',
      error: parsed.error,
    };
  }

  const applied = upsertWikiPages(dir, parsed.pages, now);
  const sourcesState = { ...(state.sources ?? {}) };
  for (const source of pending) {
    sourcesState[source.id] = { fingerprint: source.fingerprint, compiledAt: checkedAt };
  }
  writeState(dir, {
    lastCompiledAt: checkedAt,
    lastCheckedAt: checkedAt,
    sources: sourcesState,
  });
  appendLog(dir, {
    time: checkedAt,
    trigger,
    pages: parsed.pages.length,
    sources: pending.length,
    slugs: parsed.pages.map((p) => p.slug),
  });

  return {
    ok: true,
    trigger,
    pages: applied.metas.length,
    created: applied.created,
    updated: applied.updated,
    sources: pending.length,
    skipped: parsed.skipped,
    compiledAt: checkedAt,
  };
}

// ---- runtime glue ----

/** Ask the sidecar through a temporary session (same pattern as auto-memory). */
export async function askRuntime(
  client: AgentRuntime,
  prompt: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<string> {
  const sessionId = await client.createSession();
  let stopIdle = () => {};
  try {
    const idle = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        stopIdle();
        resolve();
      }, timeoutMs);
      const unsubscribe = client.onEvent((event) => {
        if (event.type === 'session.idle' && event.sessionId === sessionId) {
          stopIdle();
          resolve();
        }
      });
      stopIdle = () => {
        clearTimeout(timer);
        unsubscribe();
      };
    });
    await client.sendPrompt(sessionId, prompt);
    await idle;
    const messages = await client.getMessages(sessionId);
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last) throw new Error('LLM 未返回内容');
    return last.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text!)
      .join('\n');
  } finally {
    stopIdle();
    try {
      await client.deleteSession(sessionId);
    } catch {
      // Best-effort cleanup.
    }
  }
}

export async function runWikiCompile(opts: {
  dir: string;
  knowledgeDir: string;
  client: AgentRuntime;
  trigger: 'manual' | 'daily';
  force?: boolean;
  maxSessions?: number;
  maxMemories?: number;
  now?: Date;
}): Promise<WikiCompileResult> {
  if (compiling) {
    return {
      ok: false,
      trigger: opts.trigger,
      pages: listWikiPages(opts.dir).length,
      created: 0,
      updated: 0,
      sources: 0,
      skipped: 0,
      reason: 'already-running',
    };
  }
  compiling = true;
  try {
    const memories = collectMemorySources(opts.knowledgeDir, opts.maxMemories ?? 40);
    const sessions = await collectSessionSources(opts.client, opts.maxSessions ?? 10);
    const sources = boundSources([...sessions, ...memories], MAX_PROMPT_SOURCE_CHARS);
    return await compileWiki({
      dir: opts.dir,
      sources,
      ask: (prompt) => askRuntime(opts.client, prompt),
      trigger: opts.trigger,
      force: opts.force,
      now: opts.now,
    });
  } finally {
    compiling = false;
  }
}

// ---- search / recall ----

const QUERY_SPLIT = /[\s,，。.!！?？;；:：、/\\()（）[\]{}"'“”‘’]+/;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(QUERY_SPLIT)
    .filter((w) => w.length >= 2);
}

function scorePage(page: WikiPageMeta, content: string, keywords: string[]): number {
  const title = page.title.toLowerCase();
  const summary = page.summary.toLowerCase();
  const tags = page.tags.join(' ').toLowerCase();
  const body = content.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (title.includes(keyword)) score += 4;
    if (summary.includes(keyword)) score += 2;
    if (tags.includes(keyword)) score += 2;
    if (body.includes(keyword)) score += 1;
  }
  return score;
}

/** Keyword search over page bodies. Empty query lists pages newest-first. */
export function searchWikiPages(dir: string, query: string, limit = 10): WikiPageMeta[] {
  const { pages } = scanPages(dir);
  const keywords = tokenize(query);
  if (keywords.length === 0) return sortMetas(pages.map(metaOf)).slice(0, limit);
  return pages
    .map((page) => ({ page, score: scorePage(page, page.content, keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.page.updated.localeCompare(a.page.updated);
    })
    .slice(0, limit)
    .map((entry) => metaOf(entry.page));
}

export interface WikiRecallResult {
  context: string;
  pages: { slug: string; title: string; summary: string }[];
}

/** Pages relevant to a new conversation, formatted for prompt injection. */
export function recallWiki(dir: string, query: string, limit = 3): WikiRecallResult {
  const { pages } = scanPages(dir);
  const keywords = tokenize(query);
  if (keywords.length === 0) return { context: '', pages: [] };

  const matches = pages
    .map((page) => ({ page, score: scorePage(page, page.content, keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.page.updated.localeCompare(a.page.updated);
    })
    .slice(0, limit)
    .map((entry) => entry.page);
  if (matches.length === 0) return { context: '', pages: [] };

  const lines = ['# LLM Wiki', '', '以下是过往会话编译出的、与当前任务相关的 Wiki 页面：', ''];
  for (const page of matches) {
    lines.push(`## ${page.title}`);
    lines.push(`- 摘要: ${page.summary}`);
    if (page.sources.length > 0) lines.push(`- 来源: ${page.sources.join(', ')}`);
    lines.push(page.content.slice(0, 1500));
    lines.push('');
  }
  return {
    context: lines.join('\n'),
    pages: matches.map((p) => ({ slug: p.slug, title: p.title, summary: p.summary })),
  };
}

// ---- lint ----

export function lintWiki(dir: string): WikiLintReport {
  const { pages, errors } = scanPages(dir);
  const metas = sortMetas(pages.map(metaOf));
  const slugs = new Set(metas.map((m) => m.slug));
  const issues: WikiLintIssue[] = [];

  for (const name of errors) {
    issues.push({ kind: 'unreadable-page', level: 'error', detail: `无法解析页面文件：${name}` });
  }
  for (const page of pages) {
    if (page.content.trim().length < 20) {
      issues.push({
        kind: 'empty-page',
        level: 'error',
        slug: page.slug,
        detail: '正文为空或过短',
      });
    }
    if (!page.summary.trim()) {
      issues.push({ kind: 'missing-summary', level: 'warn', slug: page.slug, detail: '缺少摘要' });
    }
    for (const link of page.links) {
      if (!slugs.has(link)) {
        issues.push({
          kind: 'broken-link',
          level: 'error',
          slug: page.slug,
          detail: `[[${link}]] 指向不存在的页面`,
        });
      }
    }
    if (metas.length > 1 && page.backlinks.length === 0) {
      issues.push({ kind: 'orphan-page', level: 'warn', slug: page.slug, detail: '没有任何入链' });
    }
  }

  const byTitle = new Map<string, string[]>();
  for (const meta of metas) {
    const key = meta.title.trim().toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), meta.slug]);
  }
  for (const [, group] of byTitle) {
    if (group.length > 1) {
      issues.push({
        kind: 'duplicate-title',
        level: 'warn',
        slug: group[0],
        detail: `标题重复：${group.join(', ')}`,
      });
    }
  }

  const rawIndex = readIndexRaw(dir);
  if (
    metas.length > 0 &&
    (!rawIndex || JSON.stringify(sortMetas(rawIndex)) !== JSON.stringify(metas))
  ) {
    issues.push({
      kind: 'index-drift',
      level: 'warn',
      detail: 'index.json 与页面文件不一致，下次编译会自动重建',
    });
  }

  return { checkedAt: new Date().toISOString(), pages: metas.length, issues };
}

// ---- status / scheduling ----

export function isWikiCompiling(): boolean {
  return compiling;
}

export function isWikiCompileDue(dir: string, now = new Date()): boolean {
  const state = readState(dir);
  if (!state.lastCheckedAt) return true;
  const last = new Date(state.lastCheckedAt).getTime();
  return !Number.isFinite(last) || now.getTime() - last >= DAY_MS;
}

export function getWikiStatus(dir: string): WikiStatus {
  const state = readState(dir);
  return {
    pages: listWikiPages(dir).length,
    lastCompiledAt: state.lastCompiledAt ?? null,
    lastCheckedAt: state.lastCheckedAt ?? null,
    due: isWikiCompileDue(dir),
    sourcesTracked: Object.keys(state.sources ?? {}).length,
    compiling,
  };
}

export interface WikiRuntimeConfig {
  baseUrl: string;
  password: string;
  directory?: string;
}

/** Daily batch: check every 30 min, compile when the last check is ≥24 h old
 *  and the sidecar is up. Manual compiles share the same in-flight guard. */
export function startWikiDailyCompile(opts: {
  dir: string;
  knowledgeDir: string;
  getRuntime: () => WikiRuntimeConfig | null;
  onCompiled?: (result: WikiCompileResult) => void;
  intervalMs?: number;
  initialDelayMs?: number;
}): () => void {
  const log = getLogger();

  const check = async (): Promise<void> => {
    if (isWikiCompiling() || !isWikiCompileDue(opts.dir)) return;
    const runtime = opts.getRuntime();
    if (!runtime) return;

    let client: AgentRuntime | null = null;
    try {
      client = await createAgentRuntime({
        kind: 'opencode',
        baseUrl: runtime.baseUrl,
        password: runtime.password,
        directory: runtime.directory,
      });
      await client.connect();
      const result = await runWikiCompile({
        dir: opts.dir,
        knowledgeDir: opts.knowledgeDir,
        client,
        trigger: 'daily',
      });
      log.info(
        `[wiki] daily compile: ok=${result.ok} reason=${result.reason ?? '-'} pages=${result.pages} sources=${result.sources}`,
      );
      if (result.ok && result.reason !== 'no-new-sources') opts.onCompiled?.(result);
    } catch (err) {
      log.warn(`[wiki] daily compile failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client?.close();
    }
  };

  const initial = setTimeout(() => void check(), opts.initialDelayMs ?? 2 * 60 * 1000);
  const interval = setInterval(() => void check(), opts.intervalMs ?? 30 * 60 * 1000);
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}
