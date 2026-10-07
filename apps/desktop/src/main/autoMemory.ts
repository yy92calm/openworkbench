// Auto long-term memory: extract memories from session transcripts and inject
// relevant ones into new sessions. Phase 1 uses keyword matching (no vectors).
//
// Design: when a user session goes idle, we create a temporary session to
// extract structured memories from the transcript. These are persisted to the
// knowledge base under category 'auto-memory'. On new session creation, we
// recall relevant memories by keyword matching and inject them as context.

import type { AgentHistoryMessage, AgentRuntime } from '@workbench/sdk/agent-runtime';
import type { AutoMemoryConfig, ExtractedMemory, KnowledgeEntry } from '@workbench/shared';

import { deleteEntry, getEntry, listEntries, saveEntry } from './knowledge';
import { getLogger } from './logging';
import { getStore } from './store';

const STORE_SCOPE = 'workbench.autoMemory';
const MEMORY_CATEGORY = 'auto-memory';

// Track which sessions have been processed to avoid redundant extraction.
// A session can go idle multiple times (user resumes after pause); we only
// extract once per session unless new messages arrive.
const processedSessions = new Set<string>();
const lastProcessedIndex = new Map<string, number>();

// ---- Config ----

export function getAutoMemoryConfig(): AutoMemoryConfig {
  const store = getStore(STORE_SCOPE);
  const defaults: AutoMemoryConfig = {
    enabled: true,
    maxEntries: 500,
    recallLimit: 5,
    minTurns: 3,
  };
  return { ...defaults, ...store.get('config') };
}

export function setAutoMemoryConfig(patch: Partial<AutoMemoryConfig>): void {
  const store = getStore(STORE_SCOPE);
  const current = getAutoMemoryConfig();
  store.set('config', { ...current, ...patch });
}

// ---- Extraction ----

const EXTRACTION_PROMPT = `请从以下对话中提取值得长期记住的信息，输出 JSON 数组：
[
  {
    "title": "简短标题",
    "summary": "一句话说明",
    "content": "详细内容",
    "tags": ["标签1", "标签2"],
    "type": "fact|preference|decision",
    "stability": "stable|ephemeral",
    "importance": 3
  }
]

提取原则：
- 只提取有长期价值的信息（用户偏好、重要事实、关键决策）
- 不要提取临时性信息（当前任务细节、调试过程、一次性问题）
- 每条记忆应独立可理解，不依赖对话上下文
- stability 分类：
  - "stable"：用户画像类（长期偏好、身份特征、技术栈选择等，几个月内不会变）
  - "ephemeral"：最近关注类（当前项目、近期决策、临时上下文等，一两周可能过时）
- importance 评分（1-5）：
  - 1：低价值，可能很快过时
  - 2：一般，偶尔有用
  - 3：中等，多次可能用到
  - 4：重要，经常需要参考
  - 5：关键，核心偏好或关键决策
- 如果没有值得记忆的内容，返回空数组 []

示例：
用户说"我更喜欢用 TypeScript 而不是 JavaScript" → 提取为 stable preference, importance 4
用户说"这个项目用的是 React 18" → 提取为 ephemeral fact, importance 3
用户说"我们决定用 PostgreSQL 而不是 MongoDB" → 提取为 ephemeral decision, importance 4
用户说"帮我写个函数" → 不提取（临时性请求）

对话内容：
`;

/** Format session messages into a transcript string for extraction. */
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

/** Count user turns in a session (each user message = 1 turn). */
export function countTurns(messages: AgentHistoryMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}

/** Check if user messages contain meaningful content worth extracting.
 *  Filters out sessions where all user messages are short commands or greetings. */
export function hasMeaningfulContent(messages: AgentHistoryMessage[]): boolean {
  const userMessages = messages.filter((m) => m.role === 'user');
  let meaningfulCount = 0;

  for (const msg of userMessages) {
    for (const part of msg.parts) {
      if (part.type === 'text' && part.text && !part.synthetic) {
        const text = part.text.trim();
        // Skip very short messages (< 10 chars) or shell commands (start with !)
        if (text.length >= 10 && !text.startsWith('!') && !text.startsWith('/')) {
          meaningfulCount++;
          break;
        }
      }
    }
  }

  // Need at least 2 meaningful user messages for extraction to be worthwhile
  return meaningfulCount >= 2;
}

/**
 * Extract memories from a session transcript. Creates a temporary session,
 * sends the transcript with extraction prompt, parses the response.
 * Returns extracted memories or empty array on failure.
 */
export async function extractMemories(
  client: AgentRuntime,
  messages: AgentHistoryMessage[],
): Promise<ExtractedMemory[]> {
  const log = getLogger();
  const config = getAutoMemoryConfig();

  if (!config.enabled) return [];
  if (countTurns(messages) < config.minTurns) {
    log.info(
      `[auto-memory] skipping extraction: only ${countTurns(messages)} turns (min ${config.minTurns})`,
    );
    return [];
  }

  const transcript = formatTranscript(messages);
  if (!transcript.trim()) return [];

  let extractionSessionId: string | null = null;
  try {
    extractionSessionId = await client.createSession();
    const prompt = EXTRACTION_PROMPT + transcript;
    await client.sendPrompt(extractionSessionId, prompt);

    // Wait for the session to go idle
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve();
      }, 60_000);

      const unsubscribe = client.onEvent((event) => {
        if (event.type === 'session.idle' && event.sessionId === extractionSessionId) {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
    });

    // Get the assistant's response
    const responseMessages = await client.getMessages(extractionSessionId);
    const lastAssistant = [...responseMessages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) {
      log.warn('[auto-memory] no assistant response from extraction session');
      return [];
    }

    const responseText = lastAssistant.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text!)
      .join('\n');

    return parseExtractionResponse(responseText);
  } catch (err) {
    log.error(
      `[auto-memory] extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  } finally {
    if (extractionSessionId) {
      try {
        await client.deleteSession(extractionSessionId);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

/** Parse the Agent's JSON response, tolerating markdown code fences. */
function parseExtractionResponse(text: string): ExtractedMemory[] {
  // Strip markdown code fences if present
  let json = text.trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) json = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidMemory);
  } catch {
    // Try to find an array in the text
    const arrayMatch = json.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]) as unknown;
        if (Array.isArray(parsed)) return parsed.filter(isValidMemory);
      } catch {
        // give up
      }
    }
    return [];
  }
}

function isValidMemory(m: unknown): m is ExtractedMemory {
  if (!m || typeof m !== 'object') return false;
  const obj = m as Record<string, unknown>;
  return (
    typeof obj.title === 'string' &&
    typeof obj.summary === 'string' &&
    typeof obj.content === 'string' &&
    Array.isArray(obj.tags) &&
    typeof obj.type === 'string' &&
    typeof obj.stability === 'string' &&
    (obj.stability === 'stable' || obj.stability === 'ephemeral')
  );
}
// ---- Persistence ----

/** Save extracted memories to the knowledge base, deduplicating against existing. */
export function saveAutoMemories(knowledgeDir: string, memories: ExtractedMemory[]): number {
  const log = getLogger();
  const config = getAutoMemoryConfig();
  const existing = listEntries(knowledgeDir).filter((e) => e.category === MEMORY_CATEGORY);

  let saved = 0;
  for (const memory of memories) {
    const duplicate = findDuplicate(existing, memory);
    const importance = clampImportance(memory.importance);
    // Encode metadata as tags so they persist in the knowledge entry
    const metaTags = [
      `stability:${memory.stability}`,
      `importance:${importance}`,
      `accessCount:${duplicate ? getAccessCount(duplicate) : 0}`,
    ];
    const baseTags = [...new Set([...memory.tags, ...metaTags])];
    if (duplicate) {
      log.info(`[auto-memory] updating duplicate: ${duplicate.id} (${memory.title})`);
      // Preserve existing access count when updating
      const mergedTags = [...new Set([...duplicate.tags, ...baseTags])];
      saveEntry(knowledgeDir, {
        id: duplicate.id,
        title: memory.title,
        summary: memory.summary,
        category: MEMORY_CATEGORY,
        tags: mergedTags,
        content: memory.content,
      });
    } else {
      saveEntry(knowledgeDir, {
        title: memory.title,
        summary: memory.summary,
        category: MEMORY_CATEGORY,
        tags: baseTags,
        content: memory.content,
      });
      saved++;
      log.info(`[auto-memory] saved: ${memory.title}`);
    }
  }

  pruneAutoMemories(knowledgeDir, config.maxEntries);

  return saved;
}

/** Simple dedup: check if title or summary keywords overlap significantly. */
function findDuplicate(existing: KnowledgeEntry[], memory: ExtractedMemory): KnowledgeEntry | null {
  const newKeywords = tokenize(`${memory.title} ${memory.summary}`);
  if (newKeywords.length === 0) return null;

  for (const entry of existing) {
    const existingKeywords = tokenize(`${entry.title} ${entry.summary}`);
    const overlap = newKeywords.filter((k) => existingKeywords.includes(k)).length;
    const overlapRatio = overlap / Math.max(newKeywords.length, existingKeywords.length);
    if (overlapRatio >= 0.6) return entry;
  }
  return null;
}

/** Tokenize into lowercase words, filtering stop words and short tokens. */
function tokenize(text: string): string[] {
  const stopWords = new Set([
    '的',
    '了',
    '在',
    '是',
    '我',
    '有',
    '和',
    '就',
    '不',
    '人',
    '都',
    '一',
    '一个',
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
  ]);
  return text
    .toLowerCase()
    .split(/[\s,，。.!！?？;；:：、]+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));
}

// ---- Tag-encoded metadata helpers ----

function clampImportance(v: number | undefined): number {
  if (v == null) return 3;
  return Math.max(1, Math.min(5, Math.round(v)));
}

/** Read `importance:N` tag from a knowledge entry (default 3). */
export function getImportance(entry: KnowledgeEntry): number {
  const tag = entry.tags.find((t) => t.startsWith('importance:'));
  if (!tag) return 3;
  const n = parseInt(tag.split(':')[1], 10);
  return Number.isFinite(n) ? clampImportance(n) : 3;
}

/** Read `accessCount:N` tag (default 0). */
export function getAccessCount(entry: KnowledgeEntry): number {
  const tag = entry.tags.find((t) => t.startsWith('accessCount:'));
  if (!tag) return 0;
  const n = parseInt(tag.split(':')[1], 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Increment the `accessCount:N` tag and persist. */
export function incrementAccessCount(knowledgeDir: string, entryId: string): void {
  let entry: KnowledgeEntry;
  try {
    entry = getEntry(knowledgeDir, entryId);
  } catch {
    return;
  }
  const count = getAccessCount(entry);
  const newTags = entry.tags
    .filter((t) => !t.startsWith('accessCount:'))
    .concat(`accessCount:${count + 1}`);
  saveEntry(knowledgeDir, { ...entry, tags: newTags });
}

/** Keep only the most recent `maxEntries` auto-memory entries. Ephemeral
 *  memories with low access count and low importance are pruned first;
 *  stable memories (user profile) are retained longer. */
function pruneAutoMemories(knowledgeDir: string, maxEntries: number): void {
  const entries = listEntries(knowledgeDir).filter((e) => e.category === MEMORY_CATEGORY);
  if (entries.length <= maxEntries) return;

  const ephemeral = entries.filter((e) => !e.tags.includes('stability:stable')).sort(pruneOrder);
  const stable = entries.filter((e) => e.tags.includes('stability:stable')).sort(pruneOrder);

  const toDelete: KnowledgeEntry[] = [];
  const combined = [...ephemeral, ...stable];
  for (const entry of combined.slice(maxEntries)) {
    toDelete.push(entry);
  }

  for (const entry of toDelete) {
    try {
      deleteEntry(knowledgeDir, entry.id);
    } catch {
      // Best-effort pruning
    }
  }
}

/** Sort entries for pruning: lowest priority first.
 *  Priority = accessCount * 2 + importance (higher = keep longer). */
function pruneOrder(a: KnowledgeEntry, b: KnowledgeEntry): number {
  const aPri = getAccessCount(a) * 2 + getImportance(a);
  const bPri = getAccessCount(b) * 2 + getImportance(b);
  if (aPri !== bPri) return aPri - bPri;
  return a.updated.localeCompare(b.updated);
}

// ---- Recall ----

export interface RecallResult {
  /** Recalled memories (top matches). */
  recalled: KnowledgeEntry[];
  /** Number of related but unrecalled entries (potential knowledge gaps). */
  unrecalledCount: number;
  /** Sample of unrecalled entries (up to 5). */
  unrecalledSamples: KnowledgeEntry[];
}

/** Recall relevant memories for a given query using keyword matching. */
export function recallMemories(
  knowledgeDir: string,
  query: string,
  limit?: number,
): KnowledgeEntry[] {
  const result = recallMemoriesWithGaps(knowledgeDir, query, limit);
  return result.recalled;
}

/** Enhanced recall that also returns information about unrecalled related entries. */
export function recallMemoriesWithGaps(
  knowledgeDir: string,
  query: string,
  limit?: number,
): RecallResult {
  const config = getAutoMemoryConfig();
  if (!config.enabled) {
    return { recalled: [], unrecalledCount: 0, unrecalledSamples: [] };
  }

  const maxRecall = limit ?? config.recallLimit;
  const allMemories = listEntries(knowledgeDir).filter((e) => e.category === MEMORY_CATEGORY);
  if (allMemories.length === 0) {
    return { recalled: [], unrecalledCount: 0, unrecalledSamples: [] };
  }

  const queryKeywords = tokenize(query);
  if (queryKeywords.length === 0) {
    const recalled = allMemories
      .sort((a, b) => {
        const aStable = isStable(a) ? 1 : 0;
        const bStable = isStable(b) ? 1 : 0;
        if (bStable !== aStable) return bStable - aStable;
        return b.updated.localeCompare(a.updated);
      })
      .slice(0, maxRecall);
    return {
      recalled,
      unrecalledCount: allMemories.length - recalled.length,
      unrecalledSamples: allMemories.slice(maxRecall, maxRecall + 5),
    };
  }

  const now = Date.now();
  const scored = allMemories.map((entry) => {
    const entryText = `${entry.title} ${entry.summary} ${entry.tags.join(' ')}`.toLowerCase();
    const keywordScore = queryKeywords.filter((k) => entryText.includes(k)).length;
    if (keywordScore === 0) return { entry, score: 0 };

    // Importance weight: importance 1→0.4, 3→0.8, 5→1.2
    const importanceWeight = 0.2 + (getImportance(entry) / 5) * 0.8;
    const baseScore = keywordScore * importanceWeight;

    // Stability boost
    const stabilityBoost = isStable(entry) ? 0.5 : 0;

    // Time decay for ephemeral memories: lose up to 50% score over 14 days
    let decayFactor = 0;
    if (!isStable(entry)) {
      const ageMs = now - new Date(entry.updated).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      decayFactor = Math.min(0.5, ageDays / 28);
    }

    const score = Math.max(
      0,
      baseScore + stabilityBoost - (baseScore + stabilityBoost) * decayFactor,
    );
    return { entry, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.updated.localeCompare(a.entry.updated);
  });

  const recalled = scored
    .filter((s) => s.score > 0)
    .slice(0, maxRecall)
    .map((s) => s.entry);

  // Find unrecalled but potentially related entries (score > 0 but not in top N)
  const unrecalled = scored
    .filter((s) => s.score > 0)
    .slice(maxRecall, maxRecall + 5)
    .map((s) => s.entry);

  const unrecalledCount = scored.filter((s) => s.score > 0).length - recalled.length;

  // Increment access count for each recalled memory (fire-and-forget)
  for (const entry of recalled) {
    try {
      incrementAccessCount(knowledgeDir, entry.id);
    } catch {
      // Best-effort
    }
  }

  // Fire proactive event if there are unrecalled related entries
  if (unrecalledCount >= 3) {
    try {
      const { fireEvent } = require('./proactive');
      fireEvent('knowledge.gap', {
        type: 'info',
        title: '知识库提示',
        message: `知识库中还有 ${unrecalledCount} 条可能相关的内容，要查看吗？`,
        unrecalledCount,
      });
    } catch {
      // Proactive integration is optional
    }
  }

  return { recalled, unrecalledCount, unrecalledSamples: unrecalled };
}

/** Check if a memory is tagged as stable (user profile). */
function isStable(entry: KnowledgeEntry): boolean {
  return entry.tags.includes('stability:stable');
}

/** Format recalled memories into a context string for injection. */
export function buildMemoryContext(memories: KnowledgeEntry[]): string {
  if (memories.length === 0) return '';

  const lines = ['# 长期记忆', '', '以下是从过往对话中提取的、与当前任务相关的记忆：', ''];

  for (const m of memories) {
    lines.push(`## ${m.title}`);
    lines.push(
      `- 类型: ${m.tags.includes('preference') ? '偏好' : m.tags.includes('decision') ? '决策' : '事实'}`,
    );
    lines.push(`- 摘要: ${m.summary}`);
    lines.push(`- 详情: ${m.content}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---- High-level API ----

/**
 * Process a completed session: extract memories and save to knowledge base.
 * Called when a user session goes idle. Tracks processed sessions to avoid
 * redundant extraction; only processes new messages since last extraction.
 */
export async function processSessionForMemory(
  client: AgentRuntime,
  knowledgeDir: string,
  sessionId: string,
): Promise<void> {
  const log = getLogger();
  const config = getAutoMemoryConfig();
  if (!config.enabled) return;

  // Check if we've already processed this session with no new messages
  const messages = await client.getMessages(sessionId);
  const currentIndex = messages.length;
  const lastIndex = lastProcessedIndex.get(sessionId) ?? 0;

  if (processedSessions.has(sessionId) && currentIndex <= lastIndex) {
    log.info(`[auto-memory] session ${sessionId} already processed, skipping`);
    return;
  }

  // Only extract if there's meaningful content (not just short commands)
  if (!hasMeaningfulContent(messages)) {
    log.info(`[auto-memory] skipping session ${sessionId}: no meaningful content`);
    return;
  }

  log.info(`[auto-memory] processing session ${sessionId} for memory extraction`);

  try {
    if (countTurns(messages) < config.minTurns) {
      log.info(
        `[auto-memory] skipping extraction: only ${countTurns(messages)} turns (min ${config.minTurns})`,
      );
      return;
    }

    // For incremental extraction: only process messages since last extraction
    const messagesToProcess = lastIndex > 0 ? messages.slice(lastIndex) : messages;
    if (messagesToProcess.length === 0) {
      log.info(`[auto-memory] no new messages in session ${sessionId}`);
      return;
    }

    const memories = await extractMemories(client, messagesToProcess);

    if (memories.length === 0) {
      log.info(`[auto-memory] no memories extracted from session ${sessionId}`);
      processedSessions.add(sessionId);
      lastProcessedIndex.set(sessionId, currentIndex);
      return;
    }

    const saved = saveAutoMemories(knowledgeDir, memories);
    log.info(`[auto-memory] extracted ${memories.length} memories, saved ${saved} new entries`);

    processedSessions.add(sessionId);
    lastProcessedIndex.set(sessionId, currentIndex);
  } catch (err) {
    log.error(
      `[auto-memory] processSession failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---- Auto-tagging ----

const TAG_KEYWORDS: Record<string, string[]> = {
  代码: ['代码', 'code', 'function', '函数', 'bug', '修复', 'fix', '重构', 'refactor'],
  文档: ['文档', 'document', 'README', '说明', 'doc', 'markdown'],
  测试: ['测试', 'test', '单元测试', 'unit test', 'vitest', 'jest'],
  配置: ['配置', 'config', 'setup', '设置', '环境', 'environment'],
  调试: ['调试', 'debug', '排查', 'troubleshoot', '错误', 'error'],
  部署: ['部署', 'deploy', '发布', 'release', '打包', 'build', 'package'],
  数据库: ['数据库', 'database', 'SQL', '查询', 'query', 'table'],
  API: ['API', '接口', 'endpoint', 'REST', 'HTTP', 'fetch'],
  UI: ['UI', '界面', '组件', 'component', 'React', '样式', 'style'],
  安全: ['安全', 'security', '权限', 'permission', '认证', 'auth'],
};

const TAG_STORE_SCOPE = 'workbench.sessionTags';

/**
 * Extract tags from session messages based on keyword matching.
 * Returns an array of tag strings (max 5 tags).
 */
export function extractSessionTags(messages: AgentHistoryMessage[]): string[] {
  const text = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) =>
      m.parts
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text!)
        .join(' '),
    )
    .join('\n')
    .toLowerCase();

  const tagScores: Record<string, number> = {};
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      const matches = text.match(new RegExp(keyword.toLowerCase(), 'g'));
      if (matches) score += matches.length;
    }
    if (score > 0) tagScores[tag] = score;
  }

  // Sort by score descending, take top 5
  return Object.entries(tagScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);
}

/**
 * Save session tags to the store.
 */
export function saveSessionTags(sessionId: string, tags: string[]): void {
  const store = getStore(TAG_STORE_SCOPE);
  store.set(sessionId, tags);
}

/**
 * Get session tags from the store.
 */
export function getSessionTags(sessionId: string): string[] {
  const store = getStore(TAG_STORE_SCOPE);
  return (store.get(sessionId) as string[]) ?? [];
}

// ---- Memory consolidation ----

/**
 * Consolidate auto-memory entries by removing duplicates and merging similar ones.
 * Returns the number of entries removed.
 */
export function consolidateMemories(knowledgeDir: string): { removed: number; remaining: number } {
  const log = getLogger();
  const entries = listEntries(knowledgeDir).filter((e) => e.category === MEMORY_CATEGORY);

  if (entries.length === 0) {
    return { removed: 0, remaining: 0 };
  }

  const toRemove: string[] = [];
  const seen = new Map<string, KnowledgeEntry>();

  // Group by similar title (simple string similarity)
  for (const entry of entries) {
    const normalizedTitle = entry.title.toLowerCase().trim();
    let isDuplicate = false;

    for (const [seenTitle, seenEntry] of seen.entries()) {
      const similarity = computeStringSimilarity(normalizedTitle, seenTitle);
      if (similarity > 0.8) {
        // Keep the more recent one
        if (entry.updatedAt > seenEntry.updatedAt) {
          toRemove.push(seenEntry.id);
          seen.delete(seenTitle);
          seen.set(normalizedTitle, entry);
        } else {
          toRemove.push(entry.id);
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(normalizedTitle, entry);
    }
  }

  // Remove duplicates
  for (const id of toRemove) {
    try {
      deleteEntry(knowledgeDir, id);
    } catch (err) {
      log.warn(`[auto-memory] failed to delete duplicate entry ${id}: ${err}`);
    }
  }

  const remaining = entries.length - toRemove.length;
  log.info(
    `[auto-memory] consolidation: removed ${toRemove.length} duplicates, ${remaining} remaining`,
  );

  return { removed: toRemove.length, remaining };
}

/**
 * Compute simple string similarity (0-1) based on character overlap.
 */
function computeStringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }

  // Simple Jaccard similarity on character bigrams
  const getBigrams = (s: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2));
    }
    return bigrams;
  };

  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);

  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
