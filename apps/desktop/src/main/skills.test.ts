import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteScheme,
  linkSkill,
  listSchemes,
  materializeSkills,
  readConfig,
  readScheme,
  scanSkills,
  topLevelLink,
  unlinkSkill,
  writeConfig,
  writeScheme,
} from './skills';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skills-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create `<root>/<source>/<relPath>/SKILL.md`. */
function makeSkill(source: string, relPath: string, description = 'a skill'): string {
  const dir = join(root, source, relPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${relPath.split('/').pop()}\ndescription: ${description}\n---\n\nbody\n`,
  );
  return dir;
}

const src = (...names: string[]) => names.map((n) => join(root, n));

describe('scanSkills', () => {
  it('finds level-1 and level-2 skills with their description', () => {
    makeSkill('src', 'alpha', '第一个技能');
    makeSkill('src', 'group/beta', '嵌套技能');
    const skills = scanSkills({ sources: src('src'), enabled: [] });
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'group/beta']);
    expect(skills.find((s) => s.name === 'group/beta')?.description).toBe('嵌套技能');
  });

  it('ignores level 3 and deeper', () => {
    makeSkill('src', 'a/b/c');
    expect(scanSkills({ sources: src('src'), enabled: [] })).toEqual([]);
  });

  it('does not descend into a skill directory', () => {
    makeSkill('src', 'alpha');
    makeSkill('src', 'alpha/nested');
    expect(scanSkills({ sources: src('src'), enabled: [] }).map((s) => s.name)).toEqual(['alpha']);
  });

  it('flags a name provided by two sources as a conflict', () => {
    makeSkill('one', 'dup');
    makeSkill('two', 'dup');
    makeSkill('two', 'only-two');
    const skills = scanSkills({ sources: src('one', 'two'), enabled: [] });
    const dup = skills.find((s) => s.name === 'dup');
    expect(dup?.conflict).toBe(true);
    expect(dup?.sources).toEqual([join(root, 'one'), join(root, 'two')]);
    expect(skills.find((s) => s.name === 'only-two')?.conflict).toBe(false);
  });

  it('marks the enabled names from the config', () => {
    makeSkill('src', 'alpha');
    makeSkill('src', 'beta');
    const skills = scanSkills({ sources: src('src'), enabled: ['beta'] });
    expect(skills.map((s) => [s.name, s.enabled])).toEqual([
      ['alpha', false],
      ['beta', true],
    ]);
  });

  it('ignores a source directory that does not exist', () => {
    expect(scanSkills({ sources: src('nope'), enabled: [] })).toEqual([]);
  });
});

describe('topLevelLink', () => {
  it('links a nested skill at its top level', () => {
    expect(topLevelLink('alpha')).toBe('alpha');
    expect(topLevelLink('group/review')).toBe('group');
  });
});

describe('materializeSkills', () => {
  it('links the enabled, unique skills and reports the rest as skipped', () => {
    makeSkill('src', 'alpha');
    makeSkill('one', 'dup');
    makeSkill('two', 'dup');
    const skillsDir = join(root, 'deployed');

    const result = materializeSkills(skillsDir, {
      sources: src('src', 'one', 'two'),
      enabled: ['alpha', 'dup', 'gone'],
    });

    expect(result.linked).toEqual(['alpha']);
    expect(result.skipped).toEqual(['dup', 'gone']);
    expect(lstatSync(join(skillsDir, 'alpha')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(skillsDir, 'dup'))).toBe(false);
    expect(existsSync(join(skillsDir, 'gone'))).toBe(false);
  });

  it('links a nested skill at its group level, pointing at the group dir', () => {
    const groupDir = makeSkill('src', 'group/beta');
    const skillsDir = join(root, 'deployed');
    materializeSkills(skillsDir, { sources: src('src'), enabled: ['group/beta'] });

    const link = join(skillsDir, 'group');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(link).not.toBe(groupDir);
  });
});

describe('linkSkill / unlinkSkill', () => {
  it('refuses a conflicting skill and removes links idempotently', () => {
    makeSkill('one', 'dup');
    makeSkill('two', 'dup');
    const skills = scanSkills({ sources: src('one', 'two'), enabled: [] });
    const skillsDir = join(root, 'deployed');

    expect(linkSkill(skillsDir, skills, 'dup')).toBe(false);
    expect(existsSync(join(skillsDir, 'dup'))).toBe(false);
    expect(linkSkill(skillsDir, skills, 'nope')).toBe(false);

    unlinkSkill(skillsDir, 'dup'); // nothing there — still a no-op
  });

  it('replaces an existing link rather than nesting it', () => {
    makeSkill('src', 'alpha');
    const skills = scanSkills({ sources: src('src'), enabled: [] });
    const skillsDir = join(root, 'deployed');

    expect(linkSkill(skillsDir, skills, 'alpha')).toBe(true);
    expect(linkSkill(skillsDir, skills, 'alpha')).toBe(true); // idempotent
    unlinkSkill(skillsDir, 'alpha');
    expect(existsSync(join(skillsDir, 'alpha'))).toBe(false);
  });
});

describe('registry', () => {
  it('round-trips sources and enabled, de-duplicated and trimmed', () => {
    const dir = join(root, 'cfg');
    expect(readConfig(dir)).toEqual({ sources: [], enabled: [] });

    writeConfig(dir, { sources: [' /a ', '/a', '/b'], enabled: ['x', 'x'] });
    expect(readConfig(dir)).toEqual({ sources: ['/a', '/b'], enabled: ['x'] });
  });

  it('quarantines a corrupt config file instead of silently rebuilding it', () => {
    const dir = join(root, 'cfg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), '{ broken');

    expect(readConfig(dir)).toEqual({ sources: [], enabled: [] });
    expect(readdirSync(dir).some((f) => f.startsWith('config.json.corrupt-'))).toBe(true);
  });
});

describe('schemes', () => {
  it('round-trips, lists and deletes a saved group', () => {
    const dir = join(root, 'cfg');
    writeScheme(dir, '日常', ['beta', 'alpha', 'alpha']);
    writeScheme(dir, '复盘', ['alpha']);

    expect(listSchemes(dir)).toEqual(['复盘', '日常']);
    expect(readScheme(dir, '日常')).toEqual(['alpha', 'beta']);
    expect(readScheme(dir, 'missing')).toBeNull();

    deleteScheme(dir, '复盘');
    expect(listSchemes(dir)).toEqual(['日常']);
  });

  it('rejects an empty group and a name that cannot be a file name', () => {
    const dir = join(root, 'cfg');
    expect(() => writeScheme(dir, '空', [])).toThrow('方案不能为空');
    expect(() => writeScheme(dir, 'a/b', ['x'])).toThrow('非法的方案名');
    expect(readScheme(dir, '../etc')).toBeNull();
  });
});
