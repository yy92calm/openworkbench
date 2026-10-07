// Local agent registry: maintains a cached list of available agents, provides
// lookup and search APIs. Scans the deployed profile on first access and can
// be refreshed when the profile changes.

import type { AgentCard } from '@workbench/shared';

import { scanAgents } from './agentCard';
import { getLogger } from './logging';

const log = getLogger('agentRegistry');

let cachedAgents: AgentCard[] | null = null;
let profileDir: string | null = null;

/** Initialize the registry with the profile directory. Call once at startup. */
export function initRegistry(dir: string): void {
  profileDir = dir;
  cachedAgents = null;
}

/** Refresh the agent cache by re-scanning the profile. */
export function refreshAgents(): AgentCard[] {
  if (!profileDir) {
    log.warn('registry not initialized');
    return [];
  }
  cachedAgents = scanAgents(profileDir);
  log.info('refreshed agent list', { count: cachedAgents.length });
  return cachedAgents;
}

/** Get all available agents. Scans on first access. */
export function listAgents(): AgentCard[] {
  if (!cachedAgents) {
    return refreshAgents();
  }
  return cachedAgents;
}

/** Get a specific agent by name. Returns null if not found. */
export function getAgent(name: string): AgentCard | null {
  const agents = listAgents();
  return agents.find((a) => a.name === name) ?? null;
}

export interface AgentSearchOptions {
  /** Filter by tags (agent must have all specified tags). */
  tags?: string[];
  /** Filter by tools (agent must have all specified tools). */
  tools?: string[];
  /** Filter by MCP servers (agent must have all specified servers). */
  mcp?: string[];
  /** Filter by skills (agent must have all specified skills). */
  skills?: string[];
  /** Only include enabled agents (default: false, include all). */
  enabledOnly?: boolean;
}

/** Search agents by name or description with optional filters. */
export function searchAgents(query: string, options: AgentSearchOptions = {}): AgentCard[] {
  const q = query.toLowerCase().trim();
  let agents = listAgents();

  // Filter by enabled status
  if (options.enabledOnly) {
    agents = agents.filter((a) => a.enabled !== false);
  }

  // Filter by tags (agent must have all specified tags)
  if (options.tags?.length) {
    const requiredTags = options.tags.map((t) => t.toLowerCase());
    agents = agents.filter(
      (a) => a.tags && requiredTags.every((tag) => a.tags.some((t) => t.toLowerCase() === tag)),
    );
  }

  // Filter by tools (agent must have all specified tools)
  if (options.tools?.length) {
    const requiredTools = options.tools.map((t) => t.toLowerCase());
    agents = agents.filter((a) =>
      requiredTools.every((tool) => a.tools.some((t) => t.toLowerCase() === tool)),
    );
  }

  // Filter by MCP servers (agent must have all specified servers)
  if (options.mcp?.length) {
    const requiredMcp = options.mcp.map((m) => m.toLowerCase());
    agents = agents.filter((a) =>
      requiredMcp.every((m) => a.mcp.some((s) => s.toLowerCase() === m)),
    );
  }

  // Filter by skills (agent must have all specified skills)
  if (options.skills?.length) {
    const requiredSkills = options.skills.map((s) => s.toLowerCase());
    agents = agents.filter((a) =>
      requiredSkills.every((s) => a.skills.some((sk) => sk.toLowerCase() === s)),
    );
  }

  // Text search with fuzzy matching
  if (!q) return sortByPriority(agents);

  return sortByPriority(
    agents.filter((a) => {
      // Exact match in name or description
      if (a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)) {
        return true;
      }
      // Fuzzy match: check if all query words appear somewhere
      const queryWords = q.split(/\s+/);
      const searchText = [
        a.name,
        a.description,
        ...(a.tags ?? []),
        ...a.tools,
        ...a.mcp,
        ...a.skills,
      ]
        .join(' ')
        .toLowerCase();
      return queryWords.every((word) => searchText.includes(word));
    }),
  );
}

/** Sort agents by priority (descending), then by name. */
function sortByPriority(agents: AgentCard[]): AgentCard[] {
  return [...agents].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Suggest the most suitable agent for a given query.
 * Scores agents based on how well their capabilities match the query.
 * Returns the top match or null if no agents are available.
 */
export function suggestAgent(query: string): AgentCard | null {
  const agents = listAgents().filter((a) => a.enabled !== false);
  if (agents.length === 0) return null;

  const q = query.toLowerCase();
  const queryWords = q.split(/\s+/).filter((w) => w.length > 1);

  // Score each agent based on relevance
  const scored = agents.map((agent) => {
    let score = 0;

    // Base score from priority
    score += (agent.priority ?? 0) * 10;

    // Check if query matches agent capabilities
    const searchableText = [
      agent.name,
      agent.description,
      ...(agent.tags ?? []),
      ...agent.tools,
      ...agent.mcp,
      ...agent.skills,
      agent.instructions ?? '',
    ]
      .join(' ')
      .toLowerCase();

    // Exact phrase match
    if (searchableText.includes(q)) {
      score += 50;
    }

    // Word matches
    for (const word of queryWords) {
      if (searchableText.includes(word)) {
        score += 10;
      }
    }

    // Tag matches get extra weight
    if (agent.tags) {
      for (const tag of agent.tags) {
        if (q.includes(tag.toLowerCase())) {
          score += 20;
        }
      }
    }

    // Tool matches
    for (const tool of agent.tools) {
      if (q.includes(tool.toLowerCase())) {
        score += 15;
      }
    }

    // Skill matches
    for (const skill of agent.skills) {
      if (q.includes(skill.toLowerCase())) {
        score += 15;
      }
    }

    return { agent, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return the top match if it has a positive score
  return scored[0]?.score > 0 ? scored[0].agent : scored[0].agent;
}
