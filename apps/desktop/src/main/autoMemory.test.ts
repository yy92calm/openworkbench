// @vitest-environment node

import { mkdtempSync } from 'node:fs';
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

vi.mock('./store', () => ({
  getStore: () => ({
    get: () => undefined,
    set: () => {},
  }),
}));

import type { ExtractedMemory } from '@workbench/shared';

import {
  buildMemoryContext,
  countTurns,
  getAccessCount,
  getImportance,
  hasMeaningfulContent,
  incrementAccessCount,
  recallMemories,
  saveAutoMemories,
} from './autoMemory';
import { listEntries, saveEntry } from './knowledge';

function root(): string {
  return mkdtempSync(join(tmpdir(), 'auto-memory-test-'));
}

describe('countTurns', () => {
  it('counts user messages', () => {
    const messages = [
      { role: 'user' as const, parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant' as const, parts: [{ type: 'text', text: 'hello' }] },
      { role: 'user' as const, parts: [{ type: 'text', text: 'how are you' }] },
    ];
    expect(countTurns(messages)).toBe(2);
  });

  it('returns 0 for empty messages', () => {
    expect(countTurns([])).toBe(0);
  });
});

describe('hasMeaningfulContent', () => {
  it('returns true when there are at least 2 meaningful user messages', () => {
    const messages = [
      { role: 'user' as const, parts: [{ type: 'text', text: '帮我写一个 TypeScript 函数' }] },
      { role: 'assistant' as const, parts: [{ type: 'text', text: '好的' }] },
      { role: 'user' as const, parts: [{ type: 'text', text: '用 React 写一个组件' }] },
    ];
    expect(hasMeaningfulContent(messages)).toBe(true);
  });

  it('returns false when user messages are too short', () => {
    const messages = [
      { role: 'user' as const, parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant' as const, parts: [{ type: 'text', text: 'hello' }] },
      { role: 'user' as const, parts: [{ type: 'text', text: 'ok' }] },
    ];
    expect(hasMeaningfulContent(messages)).toBe(false);
  });

  it('returns false when user messages are shell commands', () => {
    const messages = [
      { role: 'user' as const, parts: [{ type: 'text', text: '!ls -la' }] },
      { role: 'assistant' as const, parts: [{ type: 'text', text: 'output' }] },
      { role: 'user' as const, parts: [{ type: 'text', text: '!cat file.txt' }] },
    ];
    expect(hasMeaningfulContent(messages)).toBe(false);
  });

  it('returns false when user messages are slash commands', () => {
    const messages = [
      { role: 'user' as const, parts: [{ type: 'text', text: '/help' }] },
      { role: 'assistant' as const, parts: [{ type: 'text', text: 'commands list' }] },
      { role: 'user' as const, parts: [{ type: 'text', text: '/clear' }] },
    ];
    expect(hasMeaningfulContent(messages)).toBe(false);
  });

  it('returns true for mixed content with at least 2 meaningful messages', () => {
    const messages = [
      { role: 'user' as const, parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant' as const, parts: [{ type: 'text', text: 'hello' }] },
      { role: 'user' as const, parts: [{ type: 'text', text: '帮我分析一下这段代码的问题' }] },
      { role: 'assistant' as const, parts: [{ type: 'text', text: '分析结果' }] },
      { role: 'user' as const, parts: [{ type: 'text', text: '我更喜欢用函数式风格' }] },
    ];
    expect(hasMeaningfulContent(messages)).toBe(true);
  });
});

describe('saveAutoMemories', () => {
  it('saves memories to knowledge base with auto-memory category', () => {
    const dir = root();
    const memories: ExtractedMemory[] = [
      {
        title: '用户偏好',
        summary: '用户喜欢简洁的代码风格',
        content: '用户明确表示偏好简洁的代码风格，不喜欢过多注释',
        tags: ['preference', 'code-style'],
        type: 'preference',
        stability: 'stable',
      },
    ];

    const saved = saveAutoMemories(dir, memories);
    expect(saved).toBe(1);

    // Verify the entry was created
    const entries = listEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('auto-memory');
    expect(entries[0].title).toBe('用户偏好');
    expect(entries[0].tags).toContain('stability:stable');
  });

  it('deduplicates memories with overlapping keywords', () => {
    const dir = root();

    // First save
    const memories1: ExtractedMemory[] = [
      {
        title: '项目技术栈',
        summary: '使用 TypeScript 和 React',
        content: '项目采用 TypeScript + React 技术栈',
        tags: ['tech-stack'],
        type: 'fact',
        stability: 'ephemeral',
      },
    ];
    saveAutoMemories(dir, memories1);

    // Second save with overlapping content
    const memories2: ExtractedMemory[] = [
      {
        title: '项目技术栈更新',
        summary: '使用 TypeScript 和 React 和 Vite',
        content: '项目采用 TypeScript + React + Vite 技术栈',
        tags: ['tech-stack'],
        type: 'fact',
        stability: 'ephemeral',
      },
    ];
    const saved = saveAutoMemories(dir, memories2);

    // Should update existing, not create new
    expect(saved).toBe(0);

    const entries = listEntries(dir);
    expect(entries).toHaveLength(1);
    // Content should be updated
    expect(entries[0].title).toBe('项目技术栈更新');
  });
});

describe('recallMemories', () => {
  it('recalls memories matching query keywords', () => {
    const dir = root();

    // Add some memories
    saveEntry(dir, {
      title: 'TypeScript 偏好',
      summary: '用户偏好 TypeScript 严格模式',
      category: 'auto-memory',
      tags: ['preference', 'typescript', 'stability:stable'],
      content: '用户喜欢 TypeScript 严格模式',
    });

    saveEntry(dir, {
      title: 'React 组件风格',
      summary: '用户偏好函数组件',
      category: 'auto-memory',
      tags: ['preference', 'react', 'stability:stable'],
      content: '用户偏好函数组件和 hooks',
    });

    saveEntry(dir, {
      title: '数据库选择',
      summary: '项目使用 PostgreSQL',
      category: 'auto-memory',
      tags: ['fact', 'database', 'stability:ephemeral'],
      content: '项目数据库选择 PostgreSQL',
    });

    // Query for TypeScript-related memories
    const results = recallMemories(dir, 'TypeScript 配置', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('TypeScript 偏好');
  });

  it('boosts stable memories in recall ranking', () => {
    const dir = root();

    // Ephemeral memory with 1 keyword match
    saveEntry(dir, {
      title: '当前项目',
      summary: '在做 TypeScript 迁移',
      category: 'auto-memory',
      tags: ['stability:ephemeral'],
      content: '正在把项目从 JS 迁移到 TS',
      created: '2026-10-01T00:00:00Z',
      updated: '2026-10-01T00:00:00Z',
    });

    // Stable memory with 1 keyword match (should rank higher due to boost)
    saveEntry(dir, {
      title: 'TypeScript 偏好',
      summary: '用户偏好 TypeScript',
      category: 'auto-memory',
      tags: ['stability:stable'],
      content: '用户喜欢 TypeScript',
      created: '2026-09-01T00:00:00Z',
      updated: '2026-09-01T00:00:00Z',
    });

    const results = recallMemories(dir, 'TypeScript', 5);
    expect(results).toHaveLength(2);
    // Stable memory should rank first despite being older
    expect(results[0].title).toBe('TypeScript 偏好');
  });

  it('returns empty array when no memories match', () => {
    const dir = root();

    saveEntry(dir, {
      title: 'TypeScript 偏好',
      summary: '用户偏好 TypeScript 严格模式',
      category: 'auto-memory',
      tags: ['preference', 'stability:stable'],
      content: '用户喜欢 TypeScript 严格模式',
    });

    const results = recallMemories(dir, 'Python 机器学习', 5);
    expect(results).toHaveLength(0);
  });

  it('returns recent memories when query has no keywords, stable first', () => {
    const dir = root();

    saveEntry(dir, {
      title: '记忆一',
      summary: '第一条记忆',
      category: 'auto-memory',
      tags: ['stability:ephemeral'],
      content: '内容一',
      created: '2026-10-01T00:00:00Z',
      updated: '2026-10-01T00:00:00Z',
    });

    saveEntry(dir, {
      title: '记忆二',
      summary: '第二条记忆',
      category: 'auto-memory',
      tags: ['stability:stable'],
      content: '内容二',
      created: '2026-09-01T00:00:00Z',
      updated: '2026-09-01T00:00:00Z',
    });

    // Query with only stop words
    const results = recallMemories(dir, '的 了 在', 5);
    expect(results.length).toBeGreaterThan(0);
    // Stable memory should come first
    expect(results[0].title).toBe('记忆二');
  });
});

describe('buildMemoryContext', () => {
  it('formats memories into context string', () => {
    const memories = [
      {
        id: 'kb-1',
        title: '用户偏好',
        summary: '喜欢简洁风格',
        category: 'auto-memory',
        tags: ['preference'],
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        content: '用户偏好简洁的代码风格',
      },
    ];

    const context = buildMemoryContext(memories);
    expect(context).toContain('# 长期记忆');
    expect(context).toContain('用户偏好');
    expect(context).toContain('喜欢简洁风格');
  });

  it('returns empty string for no memories', () => {
    expect(buildMemoryContext([])).toBe('');
  });
});

describe('importance scoring', () => {
  it('getImportance reads importance tag with default 3', () => {
    const entry = {
      id: '1',
      title: 'test',
      summary: '',
      category: 'auto-memory',
      tags: ['importance:5', 'stability:stable'],
      created: '',
      updated: '',
      content: '',
    };
    expect(getImportance(entry)).toBe(5);
  });

  it('getImportance defaults to 3 when tag missing', () => {
    const entry = {
      id: '1',
      title: 'test',
      summary: '',
      category: 'auto-memory',
      tags: ['stability:stable'],
      created: '',
      updated: '',
      content: '',
    };
    expect(getImportance(entry)).toBe(3);
  });

  it('higher importance memories rank higher in recall', () => {
    const dir = root();

    saveEntry(dir, {
      title: '低重要性',
      summary: 'TypeScript 配置',
      category: 'auto-memory',
      tags: ['stability:ephemeral', 'importance:1'],
      content: '一些不太重要的 TypeScript 配置',
    });

    saveEntry(dir, {
      title: '高重要性',
      summary: 'TypeScript 核心偏好',
      category: 'auto-memory',
      tags: ['stability:ephemeral', 'importance:5'],
      content: '非常重要的 TypeScript 偏好',
    });

    const results = recallMemories(dir, 'TypeScript', 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('高重要性');
  });
});

describe('access counting', () => {
  it('getAccessCount reads accessCount tag with default 0', () => {
    const entry = {
      id: '1',
      title: 'test',
      summary: '',
      category: 'auto-memory',
      tags: ['accessCount:7'],
      created: '',
      updated: '',
      content: '',
    };
    expect(getAccessCount(entry)).toBe(7);
  });

  it('incrementAccessCount increments the tag', () => {
    const dir = root();

    saveEntry(dir, {
      title: 'TypeScript 偏好',
      summary: '用户偏好 TypeScript',
      category: 'auto-memory',
      tags: ['stability:stable', 'accessCount:0'],
      content: '用户喜欢 TypeScript',
    });

    const entries = listEntries(dir);
    expect(entries).toHaveLength(1);
    incrementAccessCount(dir, entries[0].id);

    const updated = listEntries(dir);
    expect(getAccessCount(updated[0])).toBe(1);
  });

  it('saveAutoMemories encodes importance and accessCount tags', () => {
    const dir = root();
    const memories: ExtractedMemory[] = [
      {
        title: '重要偏好',
        summary: '核心偏好',
        content: '非常重要的偏好',
        tags: ['preference'],
        type: 'preference',
        stability: 'stable',
        importance: 5,
      },
    ];

    saveAutoMemories(dir, memories);

    const entries = listEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].tags).toContain('importance:5');
    expect(entries[0].tags).toContain('accessCount:0');
  });
});

describe('time decay', () => {
  it('old ephemeral memories score lower than recent ones', () => {
    const dir = root();
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const today = now.toISOString();

    saveEntry(dir, {
      title: '旧的 ephemeral',
      summary: 'TypeScript 相关',
      category: 'auto-memory',
      tags: ['stability:ephemeral', 'importance:3'],
      content: '旧的 TypeScript 内容',
      created: twoWeeksAgo,
      updated: twoWeeksAgo,
    });

    saveEntry(dir, {
      title: '新的 ephemeral',
      summary: 'TypeScript 相关',
      category: 'auto-memory',
      tags: ['stability:ephemeral', 'importance:3'],
      content: '新的 TypeScript 内容',
      created: today,
      updated: today,
    });

    const results = recallMemories(dir, 'TypeScript', 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('新的 ephemeral');
  });
});
