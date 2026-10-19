// @vitest-environment node

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('./logging', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

import type { WikiCompileResult } from '@workbench/shared';

import { saveEntry } from './knowledge';
import {
  collectMemorySources,
  compileWiki,
  extractLinks,
  getWikiPage,
  getWikiStatus,
  isValidWikiSlug,
  lintWiki,
  listWikiPages,
  parseWikiCompileResponse,
  recallWiki,
  searchWikiPages,
  upsertWikiPages,
  type WikiSource,
} from './wiki';

function root(): string {
  return mkdtempSync(join(tmpdir(), 'wiki-test-'));
}

function source(overrides: Partial<WikiSource> = {}): WikiSource {
  return {
    id: 'session:ses_1',
    kind: 'session',
    title: 'Sidecar 端口',
    text: '讨论了 sidecar 的动态端口和持久化。',
    fingerprint: '1:10',
    ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'sidecar-port',
    title: 'Sidecar 端口策略',
    summary: '动态端口与持久化',
    tags: ['sidecar'],
    content: '正文内容，足够长以便通过 lint 的空页检查。 [[memory-recall]]',
    sources: ['session:ses_1'],
    ...overrides,
  };
}

function fakeAsk(payload: unknown): (prompt: string) => Promise<string> {
  return async () => JSON.stringify(payload);
}

describe('slug / links / frontmatter', () => {
  it('accepts safe slugs and rejects traversal', () => {
    expect(isValidWikiSlug('sidecar-port')).toBe(true);
    expect(isValidWikiSlug('../etc')).toBe(false);
    expect(isValidWikiSlug('Upper')).toBe(false);
    expect(isValidWikiSlug('')).toBe(false);
  });

  it('extracts unique links from a body', () => {
    expect(extractLinks('[[a]] [[b]] [[a]]')).toEqual(['a', 'b']);
  });
});

describe('storage', () => {
  it('upserts pages, preserves created, and rebuilds the index + backlinks', () => {
    const dir = root();
    const first = upsertWikiPages(dir, [page()], new Date('2026-10-19T08:00:00Z'));
    expect(first.created).toBe(1);
    expect(existsSync(join(dir, 'index.json'))).toBe(true);
    expect(existsSync(join(dir, 'index.md'))).toBe(true);

    upsertWikiPages(
      dir,
      [page({ title: '新标题', content: '第二版正文，仍然足够长。 [[sidecar-port]]' })],
      new Date('2026-10-19T09:00:00Z'),
    );
    const stored = getWikiPage(dir, 'sidecar-port');
    expect(stored.title).toBe('新标题');
    expect(stored.created).toBe('2026-10-19T08:00:00.000Z');
    expect(stored.updated).toBe('2026-10-19T09:00:00.000Z');
    expect(stored.backlinks).toContain('sidecar-port');

    const metas = listWikiPages(dir);
    expect(metas).toHaveLength(1);
    expect(metas[0].title).toBe('新标题');
  });

  it('rejects illegal slugs on read', () => {
    expect(() => getWikiPage(root(), '../x')).toThrow(/非法/);
  });
});

describe('compile protocol', () => {
  it('parses fenced JSON and drops invalid pages', () => {
    const parsed = parseWikiCompileResponse(
      '```json\n{"pages":[' +
        JSON.stringify(page()) +
        ',{"slug":"Bad Slug","title":"x","summary":"y","content":"z"}]}\n```',
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0].slug).toBe('sidecar-port');
    expect(parsed.skipped).toBe(1);
  });

  it('reports a missing pages array without writing', async () => {
    const dir = root();
    const result = await compileWiki({
      dir,
      sources: [source()],
      ask: fakeAsk({ nope: true }),
      trigger: 'manual',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-llm-response');
    expect(listWikiPages(dir)).toHaveLength(0);
  });

  it('writes pages, tracks source fingerprints, then reports no-new-sources', async () => {
    const dir = root();
    let calls = 0;
    const ask = async () => {
      calls++;
      return JSON.stringify({ pages: [page()] });
    };

    const first = await compileWiki({ dir, sources: [source()], ask, trigger: 'manual' });
    expect(first.ok).toBe(true);
    expect(first.created).toBe(1);
    expect(first.sources).toBe(1);
    expect(listWikiPages(dir)).toHaveLength(1);

    const second = await compileWiki({ dir, sources: [source()], ask, trigger: 'daily' });
    expect(second.ok).toBe(true);
    expect(second.reason).toBe('no-new-sources');
    expect(calls).toBe(1);

    const changed = await compileWiki({
      dir,
      sources: [source({ fingerprint: '2:12' })],
      ask,
      trigger: 'daily',
    });
    expect(changed.sources).toBe(1);
    expect(calls).toBe(2);
    expect(getWikiStatus(dir).sourcesTracked).toBe(1);
  });

  it('advances the check time even when the LLM response is unusable', async () => {
    const dir = root();
    await compileWiki({ dir, sources: [source()], ask: async () => 'not json', trigger: 'daily' });
    expect(getWikiStatus(dir).due).toBe(false);
    // The source was not marked processed, so the next run retries it.
    expect(getWikiStatus(dir).sourcesTracked).toBe(0);
  });

  it('marks sources processed when the LLM returns an empty page list', async () => {
    const dir = root();
    const result = await compileWiki({
      dir,
      sources: [source()],
      ask: fakeAsk({ pages: [] }),
      trigger: 'manual',
    });
    expect(result.ok).toBe(true);
    expect(result.created).toBe(0);
    expect(getWikiStatus(dir).sourcesTracked).toBe(1);
  });
});

describe('memory sources', () => {
  it('collects auto-memory entries only, newest first', () => {
    const knowledge = root();
    saveEntry(knowledge, {
      title: '普通知识',
      summary: '不应进入 wiki',
      category: 'notes',
      content: '正文',
    });
    saveEntry(knowledge, {
      title: '偏好记忆',
      summary: '长期偏好',
      category: 'auto-memory',
      tags: ['stability:stable'],
      content: '用户偏好 TypeScript。',
    });
    const sources = collectMemorySources(knowledge);
    expect(sources).toHaveLength(1);
    expect(sources[0].id.startsWith('memory:')).toBe(true);
    expect(sources[0].kind).toBe('memory');
    expect(sources[0].text).toContain('TypeScript');
  });
});

describe('search / recall / lint', () => {
  it('finds pages by title and body keywords', () => {
    const dir = root();
    upsertWikiPages(dir, [
      page(),
      page({
        slug: 'memory-recall',
        title: '记忆召回',
        summary: '新会话注入记忆',
        tags: ['memory'],
        content: '召回逻辑会匹配关键词并注入上下文。',
        sources: [],
      }),
    ]);

    expect(searchWikiPages(dir, 'sidecar').map((p) => p.slug)).toContain('sidecar-port');
    expect(searchWikiPages(dir, '召回').map((p) => p.slug)).toContain('memory-recall');

    const recall = recallWiki(dir, 'sidecar 端口');
    expect(recall.context).toContain('# LLM Wiki');
    expect(recall.pages[0].slug).toBe('sidecar-port');
    expect(recallWiki(dir, '').pages).toHaveLength(0);
  });

  it('reports broken links and index drift', () => {
    const dir = root();
    upsertWikiPages(dir, [page({ content: '链接到不存在的页面 [[missing-page]]，正文足够长。' })]);
    let report = lintWiki(dir);
    expect(report.issues.some((i) => i.kind === 'broken-link')).toBe(true);

    // A missing index is derived data; lint flags the drift.
    const indexFile = join(dir, 'index.json');
    writeFileSync(indexFile, '[]');
    report = lintWiki(dir);
    expect(report.issues.some((i) => i.kind === 'index-drift')).toBe(true);

    // Reading rebuilds a corrupt index.
    expect(listWikiPages(dir)).toHaveLength(1);
    expect(JSON.parse(readFileSync(indexFile, 'utf-8'))).toHaveLength(1);
  });

  it('flags orphan pages when there is more than one', () => {
    const dir = root();
    upsertWikiPages(dir, [
      page({ content: '没有链接的正文，但是足够长。' }),
      page({ slug: 'second-page', title: '第二页', content: '也是孤立页面，正文足够长。' }),
    ]);
    const report = lintWiki(dir);
    expect(report.issues.filter((i) => i.kind === 'orphan-page')).toHaveLength(2);
  });
});

describe('compile result typing', () => {
  it('returns the shared result shape', () => {
    const value: WikiCompileResult = {
      ok: true,
      trigger: 'manual',
      pages: 0,
      created: 0,
      updated: 0,
      sources: 0,
      skipped: 0,
      reason: 'no-new-sources',
    };
    expect(value.ok).toBe(true);
  });
});
