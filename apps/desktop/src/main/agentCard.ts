// Parse agent definitions from `.opencode/agents/*.md` into AgentCard structures.
// Extracts YAML frontmatter (name, description, model, tools, mcp) and skills
// from the markdown body ("## 使用的技能" section).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentCard } from '@workbench/shared';

import { getLogger } from './logging';

const log = getLogger('agentCard');

/** Scan `profileDir/agents/*.md` and return parsed AgentCards. */
export function scanAgents(profileDir: string): AgentCard[] {
  const agentsDir = join(profileDir, 'agents');
  if (!existsSync(agentsDir)) {
    log.warn('agents directory not found', agentsDir);
    return [];
  }

  const files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const cards: AgentCard[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(agentsDir, file), 'utf-8');
      const card = parseAgentFile(content);
      if (card) cards.push(card);
    } catch (err) {
      log.error('failed to parse agent file', file, err);
    }
  }

  return cards;
}

/** Parse a single agent markdown file. Returns null if frontmatter is missing. */
export function parseAgentFile(content: string): AgentCard | null {
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) return null;

  const name = frontmatter.name;
  if (!name || typeof name !== 'string') {
    log.warn('agent missing name', frontmatter);
    return null;
  }

  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const model = typeof frontmatter.model === 'string' ? frontmatter.model : undefined;
  const tools = extractTools(frontmatter.tools);
  const mcp = extractStringList(frontmatter.mcp);
  const skills = extractSkillsFromBody(content);
  const tags = extractStringList(frontmatter.tags);
  const instructions = extractInstructions(frontmatter, content);
  const enabled = typeof frontmatter.enabled === 'boolean' ? frontmatter.enabled : undefined;
  const priority = typeof frontmatter.priority === 'number' ? frontmatter.priority : undefined;

  return { name, description, model, tools, mcp, skills, tags, instructions, enabled, priority };
}

/** Extract YAML frontmatter between `---` delimiters. */
function extractFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  // Simple YAML parser for the fields we care about (name, description, model,
  // tools, mcp). Handles scalar values and simple lists/maps.
  const lines = yaml.split('\n');
  let currentKey = '';
  let currentValue: unknown = null;
  let inList = false;
  let inMap = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check if this is a new top-level key
    const keyMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (keyMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Save previous key
      if (currentKey) {
        result[currentKey] = currentValue;
      }

      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();

      if (value) {
        // Scalar value (possibly quoted)
        currentValue = value.replace(/^["']|["']$/g, '');
        inList = false;
        inMap = false;
      } else {
        // Start of list or map
        currentValue = null;
        inList = false;
        inMap = false;
      }
    } else if (currentKey && (line.startsWith('  ') || line.startsWith('\t'))) {
      // Indented line — part of list or map
      const listMatch = trimmed.match(/^-\s+(.+)$/);
      const mapMatch = trimmed.match(/^(\w+):\s*(.+)$/);

      if (listMatch) {
        if (!inList) {
          currentValue = [];
          inList = true;
          inMap = false;
        }
        (currentValue as string[]).push(listMatch[1].replace(/^["']|["']$/g, ''));
      } else if (mapMatch) {
        if (!inMap) {
          currentValue = {};
          inMap = true;
          inList = false;
        }
        (currentValue as Record<string, unknown>)[mapMatch[1]] = mapMatch[2] === 'true';
      }
    }
  }

  // Save last key
  if (currentKey) {
    result[currentKey] = currentValue;
  }

  return result;
}

/** Extract tool names from frontmatter tools map (e.g. `{write: true, edit: true}`). */
function extractTools(tools: unknown): string[] {
  if (!tools || typeof tools !== 'object') return [];
  return Object.entries(tools as Record<string, unknown>)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

/** Extract string list from frontmatter (e.g. mcp: [wind, juyuan]). */
function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** Extract skills from markdown body ("## 使用的技能" section). */
function extractSkillsFromBody(content: string): string[] {
  const match = content.match(/##\s*使用的技能\s*\n([\s\S]*?)(?=\n##|\n$)/);
  if (!match) return [];

  const section = match[1];
  // Skills are backtick-separated: `skill-a` · `skill-b` · `skill-c`
  const skills = section.match(/`([^`]+)`/g);
  if (!skills) return [];

  return skills.map((s) => s.replace(/`/g, '').trim()).filter(Boolean);
}

/** Extract instructions from frontmatter or body ("## 指令" or "## Instructions" section). */
function extractInstructions(
  frontmatter: Record<string, unknown>,
  content: string,
): string | undefined {
  // Try frontmatter first
  if (typeof frontmatter.instructions === 'string') {
    return frontmatter.instructions;
  }

  // Try body sections
  const patterns = [
    /##\s*指令\s*\n([\s\S]*?)(?=\n##|\n$)/,
    /##\s*Instructions?\s*\n([\s\S]*?)(?=\n##|\n$)/,
    /##\s*系统提示\s*\n([\s\S]*?)(?=\n##|\n$)/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return undefined;
}
