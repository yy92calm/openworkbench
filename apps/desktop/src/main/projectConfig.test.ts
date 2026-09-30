import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readProjectConfigFile, scanProjectConfig } from './projectConfig';

let profile: string;

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'profile-'));
});

afterEach(() => {
  rmSync(profile, { recursive: true, force: true });
});

function write(rel: string, content = 'x'): void {
  const abs = join(profile, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('scanProjectConfig', () => {
  it('lists loose root files for the core and instructions categories', () => {
    write('opencode.json');
    write('sandbox.json');
    write('AGENTS.md');
    const categories = scanProjectConfig(profile);
    const rels = (id: string) => categories.find((c) => c.id === id)?.files.map((f) => f.rel) ?? [];

    expect(rels('coreConfig')).toEqual(['opencode.json', 'sandbox.json']);
    expect(rels('agentsMd')).toEqual(['AGENTS.md']);
  });

  it('skips a root file that is not present', () => {
    const core = scanProjectConfig(profile).find((c) => c.id === 'coreConfig');
    expect(core?.files).toEqual([]);
  });

  it('lists commands and rules markdown files', () => {
    write('commands/init.md');
    write('commands/review.md');
    write('commands/notes.txt'); // not markdown
    write('rules/style.md');
    const categories = scanProjectConfig(profile);
    const rels = (id: string) => categories.find((c) => c.id === id)?.files.map((f) => f.rel) ?? [];

    expect(rels('commands')).toEqual(['commands/init.md', 'commands/review.md']);
    expect(rels('rules')).toEqual(['rules/style.md']);
  });

  it('lists skills one level deep, and only their SKILL.md', () => {
    write('skills/alpha/SKILL.md');
    write('skills/alpha/reference.md'); // a support file, not a skill
    write('skills/group/beta/SKILL.md');
    write('skills/group/beta/deep/gamma/SKILL.md'); // too deep
    const skills = scanProjectConfig(profile).find((c) => c.id === 'skills');

    expect(skills?.files.map((f) => f.rel)).toEqual([
      'skills/alpha/SKILL.md',
      'skills/group/beta/SKILL.md',
    ]);
  });
});

describe('readProjectConfigFile', () => {
  it('reads a file inside the profile', () => {
    write('AGENTS.md', '# Rules\n');
    expect(readProjectConfigFile(profile, 'AGENTS.md')).toBe('# Rules\n');
  });

  it('refuses to escape the profile', () => {
    expect(() => readProjectConfigFile(profile, '../secrets.txt')).toThrow('路径越界');
    expect(() => readProjectConfigFile(profile, '/etc/hosts')).toThrow('路径越界');
    // The boundary is on separators, so a sibling prefix is not inside.
    expect(() => readProjectConfigFile(`${profile}-evil`, '../x.txt')).toThrow('路径越界');
  });

  it('refuses a missing file and a directory', () => {
    expect(() => readProjectConfigFile(profile, 'nope.md')).toThrow('文件不存在');
    mkdirSync(join(profile, 'commands'));
    expect(() => readProjectConfigFile(profile, 'commands')).toThrow();
  });
});
