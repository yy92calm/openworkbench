import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteEntry,
  getEntry,
  isValidId,
  listCategories,
  listEntries,
  parseEntry,
  renderEntry,
  saveCategories,
  saveEntry,
} from './knowledge';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'knowledge-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const base = { title: '轮动策略', summary: '复盘用的打分口径', content: '正文第一行\n第二行' };

describe('frontmatter round-trip', () => {
  it('survives a save/parse cycle, including quoted values', () => {
    const entry = {
      id: 'kb-1',
      title: '含"引号"与:冒号的标题',
      summary: '多行\n说明',
      category: '投资/宏观',
      tags: ['轮动', '宏观'],
      created: '2026-09-30T00:00:00.000Z',
      updated: '2026-09-30T01:00:00.000Z',
      content: '正文',
    };
    expect(parseEntry(renderEntry(entry), 'kb-1')).toEqual(entry);
  });

  it('treats a file without frontmatter as body-only instead of losing it', () => {
    const parsed = parseEntry('随手记的正文', 'kb-9');
    expect(parsed.content).toBe('随手记的正文');
    expect(parsed.title).toBe('');
  });

  it('keeps a trailing colon-containing value intact', () => {
    const parsed = parseEntry('---\ntitle: A: B\n---\n\nbody\n', 'kb-2');
    expect(parsed.title).toBe('A: B');
    expect(parsed.content).toBe('body\n');
  });
});

describe('isValidId', () => {
  it('rejects path traversal and separators', () => {
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b']) {
      expect(isValidId(bad)).toBe(false);
    }
    expect(isValidId('kb-20260930-120000-ab12')).toBe(true);
  });
});

describe('saveEntry', () => {
  it('requires title, summary and content — and writes nothing when one is blank', () => {
    expect(() => saveEntry(dir, { ...base, title: '   ' })).toThrow('标题不能为空');
    expect(() => saveEntry(dir, { ...base, summary: '' })).toThrow('说明不能为空');
    expect(() => saveEntry(dir, { ...base, content: '  \n ' })).toThrow('内容不能为空');
    expect(listEntries(dir)).toEqual([]);
  });

  it('assigns an id and lists metadata without bodies', () => {
    const saved = saveEntry(dir, base);
    expect(saved.id).toMatch(/^kb-\d{8}-\d{6}-[0-9a-f]{4}$/);
    const listed = listEntries(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: saved.id, title: base.title, summary: base.summary });
    expect(listed[0]).not.toHaveProperty('content');
  });

  it('keeps the original created timestamp on update and bumps updated', () => {
    const created = saveEntry(dir, base, new Date('2026-09-01T00:00:00.000Z'));
    const updated = saveEntry(
      dir,
      { id: created.id, ...base, title: '改名' },
      new Date('2026-09-02T00:00:00.000Z'),
    );
    expect(updated.created).toBe('2026-09-01T00:00:00.000Z');
    expect(updated.updated).toBe('2026-09-02T00:00:00.000Z');
    expect(listEntries(dir)).toHaveLength(1);
  });

  it('de-duplicates tags', () => {
    const saved = saveEntry(dir, { ...base, tags: ['a', ' a ', '', 'b'] });
    expect(saved.tags).toEqual(['a', 'b']);
  });
});

describe('index self-healing', () => {
  it('rebuilds from the entry files when the index is corrupt', () => {
    const saved = saveEntry(dir, base);
    writeFileSync(join(dir, 'index.json'), '{ broken');
    const listed = listEntries(dir);
    expect(listed.map((m) => m.id)).toEqual([saved.id]);
    // The rebuild is persisted, not just returned.
    expect(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8'))).toHaveLength(1);
  });

  it('rebuilds from scratch when the index was deleted', () => {
    saveEntry(dir, base);
    rmSync(join(dir, 'index.json'));
    expect(listEntries(dir)).toHaveLength(1);
  });

  it('skips one corrupt entry file instead of losing the whole list', () => {
    const saved = saveEntry(dir, base);
    writeFileSync(join(dir, 'broken-dir-entry.md'), '');
    rmSync(join(dir, 'index.json'));
    // A directory named like an entry makes readFileSync throw.
    writeFileSync(join(dir, 'index.json'), '');
    const listed = listEntries(dir);
    expect(listed.map((m) => m.id)).toContain(saved.id);
  });
});

describe('getEntry / deleteEntry', () => {
  it('round-trips the body through the file on disk', () => {
    const saved = saveEntry(dir, base);
    expect(getEntry(dir, saved.id).content.trim()).toBe(base.content);
  });

  it('rejects an invalid id and a missing entry', () => {
    expect(() => getEntry(dir, '../etc/passwd')).toThrow('非法的知识库条目 ID');
    expect(() => getEntry(dir, 'kb-nope')).toThrow('知识库条目不存在');
  });

  it('deletes idempotently and drops the entry from the index', () => {
    const saved = saveEntry(dir, base);
    deleteEntry(dir, saved.id);
    deleteEntry(dir, saved.id);
    expect(listEntries(dir)).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.endsWith('.md'))).toEqual([]);
  });
});

describe('categories', () => {
  it('de-duplicates, trims and sorts the stored paths', () => {
    expect(saveCategories(dir, [' 投资/宏观 ', '投资', '投资', '', '工作'])).toEqual([
      '工作',
      '投资',
      '投资/宏观',
    ]);
    expect(listCategories(dir)).toEqual(['工作', '投资', '投资/宏观']);
  });

  it('returns an empty list when the file is missing or corrupt', () => {
    expect(listCategories(dir)).toEqual([]);
    writeFileSync(join(dir, 'categories.json'), 'not json');
    expect(listCategories(dir)).toEqual([]);
  });
});
