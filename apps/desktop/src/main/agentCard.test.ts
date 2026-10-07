// @vitest-environment node

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

import { parseAgentFile, scanAgents } from './agentCard';

const SAMPLE_AGENT = `---
name: test-agent
description: "A test agent for unit testing"
model: test/model-1
tools:
  write: true
  edit: true
  bash: false
mcp:
  - server-a
  - server-b
---

# Test Agent

This is a test agent.

## 使用的技能

\`skill-a\` · \`skill-b\` · \`skill-c\`

## Other section

More content here.
`;

describe('parseAgentFile', () => {
  it('parses frontmatter fields correctly', () => {
    const card = parseAgentFile(SAMPLE_AGENT);
    expect(card).not.toBeNull();
    expect(card!.name).toBe('test-agent');
    expect(card!.description).toBe('A test agent for unit testing');
    expect(card!.model).toBe('test/model-1');
  });

  it('extracts tools with true values', () => {
    const card = parseAgentFile(SAMPLE_AGENT);
    expect(card).not.toBeNull();
    expect(card!.tools).toEqual(['write', 'edit']);
    expect(card!.tools).not.toContain('bash');
  });

  it('extracts MCP server list', () => {
    const card = parseAgentFile(SAMPLE_AGENT);
    expect(card).not.toBeNull();
    expect(card!.mcp).toEqual(['server-a', 'server-b']);
  });

  it('extracts skills from body', () => {
    const card = parseAgentFile(SAMPLE_AGENT);
    expect(card).not.toBeNull();
    expect(card!.skills).toEqual(['skill-a', 'skill-b', 'skill-c']);
  });

  it('returns null for content without frontmatter', () => {
    const card = parseAgentFile('# No frontmatter here\nJust markdown.');
    expect(card).toBeNull();
  });

  it('returns null for frontmatter without name', () => {
    const content = `---
description: "Missing name field"
---
# Agent
`;
    const card = parseAgentFile(content);
    expect(card).toBeNull();
  });

  it('handles missing optional fields', () => {
    const content = `---
name: minimal-agent
description: "Minimal agent"
---
# Minimal
`;
    const card = parseAgentFile(content);
    expect(card).not.toBeNull();
    expect(card!.name).toBe('minimal-agent');
    expect(card!.model).toBeUndefined();
    expect(card!.tools).toEqual([]);
    expect(card!.mcp).toEqual([]);
    expect(card!.skills).toEqual([]);
  });

  it('handles unquoted description', () => {
    const content = `---
name: unquoted-agent
description: Unquoted description text
---
# Agent
`;
    const card = parseAgentFile(content);
    expect(card).not.toBeNull();
    expect(card!.description).toBe('Unquoted description text');
  });
});

describe('scanAgents', () => {
  it('scans agents directory and returns parsed cards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-card-test-'));
    const agentsDir = join(dir, 'agents');
    mkdirSync(agentsDir);

    writeFileSync(join(agentsDir, 'agent1.md'), SAMPLE_AGENT);
    writeFileSync(
      join(agentsDir, 'agent2.md'),
      `---
name: second-agent
description: "Second test agent"
---
# Second
`,
    );

    const cards = scanAgents(dir);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.name).sort()).toEqual(['second-agent', 'test-agent']);
  });

  it('returns empty array for missing agents directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-card-test-'));
    const cards = scanAgents(dir);
    expect(cards).toEqual([]);
  });

  it('skips files without .md extension', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-card-test-'));
    const agentsDir = join(dir, 'agents');
    mkdirSync(agentsDir);

    writeFileSync(join(agentsDir, 'agent.md'), SAMPLE_AGENT);
    writeFileSync(join(agentsDir, 'readme.txt'), 'Not an agent');

    const cards = scanAgents(dir);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('test-agent');
  });

  it('handles parse errors gracefully', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-card-test-'));
    const agentsDir = join(dir, 'agents');
    mkdirSync(agentsDir);

    writeFileSync(join(agentsDir, 'good.md'), SAMPLE_AGENT);
    writeFileSync(join(agentsDir, 'bad.md'), '---\ninvalid yaml\n---\n# Bad');

    const cards = scanAgents(dir);
    // Should return the good agent and skip the bad one
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards.some((c) => c.name === 'test-agent')).toBe(true);
  });
});
