// Session insights: cross-session knowledge aggregation. Detects recurring
// themes across multiple sessions and generates topic summaries.

import type { KnowledgeEntryMeta } from '@workbench/shared';

import { listEntries } from './knowledge';
import { getLogger } from './logging';
import { fireEvent } from './proactive';
import { getStore } from './store';

const log = getLogger('sessionInsights');

const STORE_SCOPE = 'workbench.sessionInsights';
const MEMORY_CATEGORY = 'auto-memory';

export interface InsightConfig {
  /** Enable cross-session insights. */
  enabled: boolean;
  /** Minimum sessions with same tag to trigger insight (default: 3). */
  minSessionsForInsight: number;
  /** Maximum insights to generate per day (default: 5). */
  maxInsightsPerDay: number;
}

export interface TopicInsight {
  /** Topic tag (e.g., 'code', 'database'). */
  tag: string;
  /** Number of sessions with this tag. */
  sessionCount: number;
  /** Related memory entries. */
  relatedMemories: KnowledgeEntryMeta[];
  /** Generated summary. */
  summary: string;
  /** When the insight was generated. */
  generatedAt: string;
}

function getConfig(): InsightConfig {
  const store = getStore(STORE_SCOPE);
  const defaults: InsightConfig = {
    enabled: true,
    minSessionsForInsight: 3,
    maxInsightsPerDay: 5,
  };
  return { ...defaults, ...store.get('config') };
}

export function setInsightConfig(patch: Partial<InsightConfig>): void {
  const store = getStore(STORE_SCOPE);
  const current = getConfig();
  store.set('config', { ...current, ...patch });
}

/** Track which insights have been generated (to avoid duplicates). */
const generatedInsights = new Map<string, TopicInsight>();

/** Analyze session tags and memories to detect cross-session patterns. */
export function analyzeSessionPatterns(knowledgeDir: string): TopicInsight[] {
  const config = getConfig();
  if (!config.enabled) {
    log.debug('session insights disabled');
    return [];
  }

  const entries = listEntries(knowledgeDir).filter((e) => e.category === MEMORY_CATEGORY);
  if (entries.length === 0) return [];

  // Group entries by tags
  const tagCounts = new Map<string, KnowledgeEntryMeta[]>();
  for (const entry of entries) {
    const tags = extractTags(entry);
    for (const tag of tags) {
      const existing = tagCounts.get(tag) ?? [];
      existing.push(entry);
      tagCounts.set(tag, existing);
    }
  }

  // Generate insights for tags with enough sessions
  const insights: TopicInsight[] = [];
  for (const [tag, relatedEntries] of tagCounts.entries()) {
    if (relatedEntries.length < config.minSessionsForInsight) continue;
    if (generatedInsights.has(tag)) continue;

    const summary = generateTopicSummary(tag, relatedEntries);
    const insight: TopicInsight = {
      tag,
      sessionCount: relatedEntries.length,
      relatedMemories: relatedEntries.slice(0, 10),
      summary,
      generatedAt: new Date().toISOString(),
    };

    insights.push(insight);
    generatedInsights.set(tag, insight);

    try {
      fireEvent('insight.generated', {
        type: 'info',
        title: `主题洞察: ${tag}`,
        message: summary,
        tag,
        sessionCount: relatedEntries.length,
      });
      log.info('generated topic insight', {
        tag,
        sessionCount: relatedEntries.length,
      });
    } catch (err) {
      log.error('failed to fire insight event', err);
    }

    if (insights.length >= config.maxInsightsPerDay) {
      break;
    }
  }

  return insights;
}

/** Extract tags from a knowledge entry's existing tags + title/summary keywords. */
function extractTags(entry: KnowledgeEntryMeta): string[] {
  const tags: string[] = [...entry.tags];

  const text = `${entry.title} ${entry.summary}`.toLowerCase();
  const keywordTags = [
    'code',
    'database',
    'api',
    'test',
    'debug',
    'deploy',
    'config',
    'doc',
    'ui',
    'security',
  ];
  for (const kw of keywordTags) {
    if (text.includes(kw)) {
      tags.push(kw);
    }
  }

  return [...new Set(tags)];
}

/** Generate a summary for a topic based on related memories. */
function generateTopicSummary(tag: string, entries: KnowledgeEntryMeta[]): string {
  const count = entries.length;
  const recentTitles = entries
    .slice(0, 3)
    .map((e) => e.title)
    .join('、');

  return `您在 ${count} 个会话中涉及「${tag}」相关内容${recentTitles ? `，包括：${recentTitles}` : ''}。`;
}

/** Get all generated insights. */
export function getGeneratedInsights(): TopicInsight[] {
  return Array.from(generatedInsights.values());
}

/** Get insights for a specific tag. */
export function getInsightByTag(tag: string): TopicInsight | null {
  return generatedInsights.get(tag) ?? null;
}

/** Clear generated insights (e.g., on app restart). */
export function clearInsights(): void {
  generatedInsights.clear();
  log.info('cleared session insights');
}
