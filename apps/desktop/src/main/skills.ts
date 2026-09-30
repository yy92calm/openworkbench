// External skill sources: aggregate skills from folders outside the bundled
// profile, enable them one by one, and switch between saved groups ("schemes").
//
// Why a registry instead of linking straight into the profile: the deployed
// profile is a *mirror* of app-config that gets pruned on every sidecar start
// (syncDir + prune, then the user overlay). A link written there would vanish on
// restart, and in a packaged build the app-config source is read-only anyway.
// So the source of truth is a small JSON file under userData and the links are
// materialised onto the deployed skills dir after each deploy — the same shape
// as the existing user patch overlay (profilePatch.applyUserOverlay).
//
// Ported from OC Manager's config/skill (scanner + linker + scheme), with the
// registry moved into userData and the depth/conflict rules kept as they were.

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AggregatedSkill, SkillsConfig, SkillsLinkResult } from '@workbench/shared';

import { atomicWriteFile, readJsonFile } from './atomicWrite';
import { linkDirectory, removeLink } from './symlink';

const CONFIG_FILE = 'config.json';
const SCHEMES_DIR = 'schemes';
const SKILL_FILE = 'SKILL.md';
/** A source root's direct children are level 1; level 3+ is not scanned, which
 *  matches how the runtime lays out `group/skill/SKILL.md`. */
const MAX_DEPTH = 2;

export type { AggregatedSkill, SkillsConfig, SkillsLinkResult };

export const EMPTY_CONFIG: SkillsConfig = { sources: [], enabled: [] };

// ---- registry ----

export function readConfig(dir: string): SkillsConfig {
  const raw = readJsonFile<Partial<SkillsConfig>>(join(dir, CONFIG_FILE), {});
  return {
    sources: asStringList(raw.sources),
    enabled: asStringList(raw.enabled),
  };
}

export function writeConfig(dir: string, config: SkillsConfig): SkillsConfig {
  const clean: SkillsConfig = {
    sources: [...new Set(config.sources.map((s) => s.trim()).filter(Boolean))],
    enabled: [...new Set(config.enabled.map((s) => s.trim()).filter(Boolean))],
  };
  mkdirSync(dir, { recursive: true });
  atomicWriteFile(join(dir, CONFIG_FILE), JSON.stringify(clean, null, 2));
  return clean;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// ---- schemes (a saved group of skill names) ----

const SCHEME_NAME = /^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/;

function schemesDir(dir: string): string {
  return join(dir, SCHEMES_DIR);
}

function schemeFile(dir: string, name: string): string {
  return join(schemesDir(dir), `${name}.json`);
}

export function listSchemes(dir: string): string[] {
  const root = schemesDir(dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

export function readScheme(dir: string, name: string): string[] | null {
  if (!SCHEME_NAME.test(name)) return null;
  const file = schemeFile(dir, name);
  if (!existsSync(file)) return null;
  return asStringList(readJsonFile<unknown>(file, []));
}

export function writeScheme(dir: string, name: string, names: string[]): void {
  if (!SCHEME_NAME.test(name)) throw new Error(`非法的方案名: ${name}`);
  if (names.length === 0) throw new Error('方案不能为空');
  mkdirSync(schemesDir(dir), { recursive: true });
  atomicWriteFile(schemeFile(dir, name), JSON.stringify([...new Set(names)].sort(), null, 2));
}

export function deleteScheme(dir: string, name: string): void {
  if (!SCHEME_NAME.test(name)) throw new Error(`非法的方案名: ${name}`);
  removeLink(schemeFile(dir, name));
}

// ---- scanning ----

function hasSkillFile(dir: string): boolean {
  try {
    return existsSync(join(dir, SKILL_FILE));
  } catch {
    return false;
  }
}

/** First `description:` line of the SKILL.md frontmatter ('' when absent). */
function describeSkill(skillDir: string): string {
  try {
    const raw = readFileSync(join(skillDir, SKILL_FILE), 'utf-8');
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? raw;
    const line = block.split('\n').find((l) => l.trimStart().startsWith('description:'));
    if (!line) return '';
    const value = line.slice(line.indexOf(':') + 1).trim();
    return value.replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

interface FoundSkill {
  name: string;
  path: string;
  description: string;
}

/** Walk one source root: level 1 and 2 directories that contain SKILL.md. A
 *  skill directory's own subdirectories are not skills. */
function scanSource(root: string): FoundSkill[] {
  const found: FoundSkill[] = [];
  const walk = (abs: string, name: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    if (name && hasSkillFile(abs)) {
      found.push({ name, path: abs, description: describeSkill(abs) });
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      walk(join(abs, entry.name), name ? `${name}/${entry.name}` : entry.name, depth + 1);
    }
  };
  walk(root, '', 0);
  return found;
}

/** Every skill across the configured sources, marked with its enable state.
 *  A name provided by more than one source is a conflict and cannot be linked. */
export function scanSkills(config: SkillsConfig): AggregatedSkill[] {
  const byName = new Map<string, AggregatedSkill>();
  for (const source of config.sources) {
    for (const found of scanSource(source)) {
      const existing = byName.get(found.name);
      if (existing) {
        existing.sources.push(source);
        existing.conflict = true;
        continue;
      }
      byName.set(found.name, {
        name: found.name,
        description: found.description,
        path: found.path,
        sources: [source],
        conflict: false,
        enabled: false,
      });
    }
  }
  const enabled = new Set(config.enabled);
  return [...byName.values()]
    .map((skill) => ({ ...skill, enabled: enabled.has(skill.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- linking ----

/** Nested skills link at their top level: `group/review` links `group`, not
 *  `review`, so the runtime still sees the group directory. */
export function topLevelLink(skillName: string): string {
  return skillName.split('/')[0];
}

/** Skill names that can be linked: resolvable, unique, not conflicting. */
function linkable(skills: AggregatedSkill[]): AggregatedSkill[] {
  return skills.filter((s) => !s.conflict);
}

/** (Re)create the link for one skill. Returns false when it cannot be linked
 *  (missing from the sources, or ambiguous). */
export function linkSkill(skillsDir: string, skills: AggregatedSkill[], name: string): boolean {
  const skill = skills.find((s) => s.name === name);
  if (!skill || skill.conflict) return false;
  linkDirectory(skill.path, join(skillsDir, topLevelLink(name)));
  return true;
}

export function unlinkSkill(skillsDir: string, name: string): void {
  removeLink(join(skillsDir, topLevelLink(name)));
}

/** Materialise the enabled set onto the deployed skills dir. Called after every
 *  profile deploy, because the mirror wipes whatever was there. Names whose
 *  source disappeared (or that now conflict) are reported, not silently kept. */
export function materializeSkills(skillsDir: string, config: SkillsConfig): SkillsLinkResult {
  const skills = linkable(scanSkills(config));
  const linked: string[] = [];
  const skipped: string[] = [];
  for (const name of config.enabled) {
    if (linkSkill(skillsDir, skills, name)) linked.push(name);
    else skipped.push(name);
  }
  return { linked, skipped };
}
