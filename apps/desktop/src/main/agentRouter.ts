// Agent routing: automatically select the best agent for a task based on
// message analysis, or recommend alternative agents when the current one
// is not optimal.

import type { AgentCard } from '@workbench/shared';

import { getLogger } from './logging';
import { listAgents } from './agentRegistry';

const log = getLogger('agentRouter');

export interface RoutingResult {
  /** Recommended agent name. */
  agent: string;
  /** Confidence score (0-100). */
  confidence: number;
  /** Why this agent was chosen. */
  reason: string;
  /** Other agents that could also handle this task. */
  alternatives: Array<{ agent: string; confidence: number; reason: string }>;
}

/** Intent categories for routing. */
type Intent =
  | 'code'
  | 'review'
  | 'test'
  | 'doc'
  | 'debug'
  | 'deploy'
  | 'database'
  | 'api'
  | 'ui'
  | 'security'
  | 'general';

/** Keywords mapped to intents. */
const INTENT_KEYWORDS: Record<Intent, string[]> = {
  code: ['写代码', '实现', '编码', '函数', '类', '组件', 'code', 'implement', 'function', 'class'],
  review: ['审查', 'review', '代码审查', 'code review', '检查代码'],
  test: ['测试', 'test', '单元测试', 'unit test', '写测试', '测试用例'],
  doc: ['文档', 'documentation', 'README', '说明', '注释'],
  debug: ['调试', 'debug', 'bug', '错误', '报错', '修复', 'fix'],
  deploy: ['部署', 'deploy', '发布', '上线', '打包', 'build'],
  database: ['数据库', 'database', 'SQL', '查询', 'query', '表', 'table'],
  api: ['API', '接口', 'endpoint', 'REST', 'GraphQL'],
  ui: ['UI', '界面', '前端', 'frontend', '样式', 'CSS', '组件'],
  security: ['安全', 'security', '漏洞', 'vulnerability', '权限', 'permission'],
  general: [],
};

/** Analyze message to determine intent. */
function analyzeIntent(message: string): Intent {
  const lower = message.toLowerCase();
  const scores: Record<Intent, number> = {} as Record<Intent, number>;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        score += 1;
      }
    }
    scores[intent as Intent] = score;
  }

  // Find the intent with the highest score
  let bestIntent: Intent = 'general';
  let bestScore = 0;
  for (const [intent, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent as Intent;
    }
  }

  return bestIntent;
}

/** Score an agent for a given intent. */
function scoreAgentForIntent(agent: AgentCard, intent: Intent): number {
  let score = 0;

  // Base priority
  score += (agent.priority ?? 0) * 10;

  // Tag match
  const tags = agent.tags ?? [];
  if (tags.includes(intent)) {
    score += 50;
  }

  // Description match
  const desc = agent.description.toLowerCase();
  if (desc.includes(intent)) {
    score += 30;
  }

  // Tool match for specific intents
  const tools = agent.tools ?? [];
  if (intent === 'code' && (tools.includes('edit') || tools.includes('write'))) {
    score += 20;
  }
  if (intent === 'test' && tools.includes('bash')) {
    score += 15;
  }
  if (intent === 'debug' && tools.includes('bash')) {
    score += 15;
  }

  // Skill match
  const skills = agent.skills ?? [];
  if (intent === 'database' && skills.some((s) => s.includes('sql') || s.includes('database'))) {
    score += 25;
  }
  if (intent === 'deploy' && skills.some((s) => s.includes('deploy') || s.includes('build'))) {
    score += 25;
  }

  return score;
}

/** Route a message to the best agent. */
export function routeMessage(message: string, currentAgent?: string): RoutingResult {
  const intent = analyzeIntent(message);
  const agents = listAgents().filter((a) => a.enabled !== false);

  if (agents.length === 0) {
    return {
      agent: currentAgent ?? 'default',
      confidence: 0,
      reason: 'No agents available',
      alternatives: [],
    };
  }

  // Score all agents
  const scored = agents.map((agent) => ({
    agent,
    score: scoreAgentForIntent(agent, intent),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const bestScore = best.score;
  const maxScore = Math.max(...scored.map((s) => s.score), 1);
  const confidence = Math.round((bestScore / maxScore) * 100);

  // Build reason
  let reason = `Intent: ${intent}`;
  if (best.agent.tags?.includes(intent)) {
    reason += `, tag match`;
  }
  if (best.agent.description.toLowerCase().includes(intent)) {
    reason += `, description match`;
  }

  // Alternatives: other agents with score >= 50% of best
  const alternatives = scored
    .slice(1)
    .filter((s) => s.score >= bestScore * 0.5)
    .slice(0, 3)
    .map((s) => ({
      agent: s.agent.name,
      confidence: Math.round((s.score / maxScore) * 100),
      reason: `Alternative for ${intent}`,
    }));

  log.debug('routed message', {
    intent,
    best: best.agent.name,
    confidence,
    currentAgent,
  });

  return {
    agent: best.agent.name,
    confidence,
    reason,
    alternatives,
  };
}

/** Check if the current agent is optimal for a message. Returns null if yes,
 *  or a recommendation to switch if not. */
export function shouldSwitchAgent(
  message: string,
  currentAgent: string,
): { shouldSwitch: boolean; recommended: string; reason: string } | null {
  const routing = routeMessage(message, currentAgent);

  // If the recommended agent is the current one, no switch needed
  if (routing.agent === currentAgent) {
    return null;
  }

  // Only suggest switching if confidence is high enough
  if (routing.confidence < 70) {
    return null;
  }

  return {
    shouldSwitch: true,
    recommended: routing.agent,
    reason: routing.reason,
  };
}
