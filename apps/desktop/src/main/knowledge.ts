// Personal knowledge base: markdown entries plus a metadata-only index.
//
// Design notes (ported from OC Manager's service/knowledge):
//  - entry metadata lives in YAML frontmatter; the id is the file name and is
//    never duplicated into the frontmatter
//  - index.json holds metadata only (content stripped) and is rebuilt by
//    scanning *.md whenever it is missing or corrupt — a corrupt index is
//    derived data, so rebuilding it is the fix, not a recovery
//  - one unreadable entry file is skipped rather than failing the whole list
//  - categories are `a/b` paths in categories.json: the hierarchy is implied by
//    the prefix, which keeps the store flat and the UI a plain select
//
// Pure file IO over an explicit directory, so every function is unit-testable;
// the caller resolves <userData>/knowledge.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { KnowledgeEntry, KnowledgeEntryMeta, KnowledgeInput } from '@workbench/shared';

import { atomicWriteFile } from './atomicWrite';

const INDEX_FILE = 'index.json';
const CATEGORIES_FILE = 'categories.json';
const ENTRY_EXT = '.md';
const FRONTMATTER = '---';

export type { KnowledgeEntry, KnowledgeEntryMeta, KnowledgeInput };

// ---- frontmatter ----

/** Values that need quoting are rare; keeping simple ones plain leaves the file
 *  pleasant to hand-edit, which is the point of storing markdown. */
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

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function renderEntry(entry: KnowledgeEntry): string {
  const head = [
    FRONTMATTER,
    `title: ${scalar(entry.title)}`,
    `summary: ${scalar(entry.summary)}`,
    `category: ${scalar(entry.category)}`,
    `tags: ${JSON.stringify(entry.tags)}`,
    `created: ${entry.created}`,
    `updated: ${entry.updated}`,
    FRONTMATTER,
  ].join('\n');
  const body = entry.content;
  return `${head}\n\n${body}`;
}

/** A file without usable frontmatter is treated as body-only rather than lost. */
export function parseEntry(raw: string, id: string): KnowledgeEntry {
  const entry: KnowledgeEntry = {
    id,
    title: '',
    summary: '',
    category: '',
    tags: [],
    created: '',
    updated: '',
    content: '',
  };
  if (!raw.startsWith(FRONTMATTER)) return { ...entry, content: raw };
  const end = raw.indexOf(`\n${FRONTMATTER}`, FRONTMATTER.length);
  if (end === -1) return { ...entry, content: raw };

  for (const line of raw.slice(FRONTMATTER.length, end).split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key === 'title') entry.title = readScalar(value);
    else if (key === 'summary') entry.summary = readScalar(value);
    else if (key === 'category') entry.category = readScalar(value);
    else if (key === 'created') entry.created = value;
    else if (key === 'updated') entry.updated = value;
    else if (key === 'tags') entry.tags = parseTags(value);
  }
  // Skip the newline that ends the `---` line plus the blank separator line, so
  // the body round-trips byte for byte (nothing added, nothing trimmed).
  let body = raw.slice(end + FRONTMATTER.length + 1);
  for (let i = 0; i < 2; i++) {
    if (body.startsWith('\r\n')) body = body.slice(2);
    else if (body.startsWith('\n')) body = body.slice(1);
  }
  entry.content = body;
  return entry;
}

// ---- ids ----

/** An id becomes a file name, so it must not be able to walk out of the vault. */
export function isValidId(id: string): boolean {
  if (!id || id === '.' || id === '..') return false;
  return !/[\\/:*?"<>|]/.test(id);
}

function newId(dir: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = `kb-${stamp}-${randomUUID().slice(0, 4)}`;
    if (!existsSync(entryFile(dir, id))) return id;
  }
  throw new Error('生成知识库条目 ID 失败：连续冲突');
}

// ---- index ----

function entryFile(dir: string, id: string): string {
  return join(dir, `${id}${ENTRY_EXT}`);
}

/** Newest update first; ties broken by id so the order is stable. */
function sortMeta(metas: KnowledgeEntryMeta[]): KnowledgeEntryMeta[] {
  return [...metas].sort((a, b) =>
    a.updated === b.updated ? a.id.localeCompare(b.id) : b.updated.localeCompare(a.updated),
  );
}

function writeIndex(dir: string, metas: KnowledgeEntryMeta[]): void {
  mkdirSync(dir, { recursive: true });
  atomicWriteFile(join(dir, INDEX_FILE), JSON.stringify(metas, null, 2));
}

function rebuildIndex(dir: string): KnowledgeEntryMeta[] {
  if (!existsSync(dir)) return [];
  const metas: KnowledgeEntryMeta[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(ENTRY_EXT)) continue;
    try {
      const { content: _content, ...meta } = parseEntry(
        readFileSync(join(dir, name), 'utf-8'),
        name.slice(0, -ENTRY_EXT.length),
      );
      metas.push(meta);
    } catch {
      // One unreadable entry must not hide the rest of the library.
    }
  }
  const sorted = sortMeta(metas);
  writeIndex(dir, sorted);
  return sorted;
}

function readIndex(dir: string): KnowledgeEntryMeta[] {
  const file = join(dir, INDEX_FILE);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
      if (Array.isArray(parsed)) return sortMeta(parsed as KnowledgeEntryMeta[]);
    } catch {
      /* fall through to a rebuild */
    }
  }
  return rebuildIndex(dir);
}

// ---- public API ----

/** Entry metadata only (no bodies), newest first. */
export function listEntries(dir: string): KnowledgeEntryMeta[] {
  return readIndex(dir);
}

export function getEntry(dir: string, id: string): KnowledgeEntry {
  if (!isValidId(id)) throw new Error(`非法的知识库条目 ID: ${id}`);
  const file = entryFile(dir, id);
  if (!existsSync(file)) throw new Error(`知识库条目不存在: ${id}`);
  return parseEntry(readFileSync(file, 'utf-8'), id);
}

/** Create (no id) or update (with id). Rejects a blank title / summary / body
 *  without writing anything — the three fields are all required. */
export function saveEntry(dir: string, input: KnowledgeInput, now = new Date()): KnowledgeEntry {
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (!title) throw new Error('标题不能为空');
  if (!summary) throw new Error('说明不能为空');
  if (!input.content.trim()) throw new Error('内容不能为空');

  const id = input.id ? input.id : newId(dir, now);
  if (!isValidId(id)) throw new Error(`非法的知识库条目 ID: ${id}`);

  const existing = existsSync(entryFile(dir, id)) ? getEntry(dir, id) : null;
  const entry: KnowledgeEntry = {
    id,
    title,
    summary,
    category: (input.category ?? '').trim(),
    tags: [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    created: existing?.created || now.toISOString(),
    updated: now.toISOString(),
    content: input.content,
  };

  mkdirSync(dir, { recursive: true });
  atomicWriteFile(entryFile(dir, id), renderEntry(entry));
  const kept = readIndex(dir).filter((m) => m.id !== id);
  const { content: _content, ...meta } = entry;
  writeIndex(dir, sortMeta([...kept, meta]));
  return entry;
}

export function deleteEntry(dir: string, id: string): void {
  if (!isValidId(id)) throw new Error(`非法的知识库条目 ID: ${id}`);
  rmSync(entryFile(dir, id), { force: true });
  writeIndex(
    dir,
    readIndex(dir).filter((m) => m.id !== id),
  );
}

export function listCategories(dir: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, CATEGORIES_FILE), 'utf-8')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

/** Category paths, de-duplicated and sorted (`a/b` implies its parent). */
export function saveCategories(dir: string, categories: string[]): string[] {
  const clean = [...new Set(categories.map((c) => c.trim()).filter(Boolean))].sort();
  mkdirSync(dir, { recursive: true });
  atomicWriteFile(join(dir, CATEGORIES_FILE), JSON.stringify(clean, null, 2));
  return clean;
}
