// Read-only overview of the packaged `.opencode` profile: the five categories a
// reader cares about, plus confined file reads for preview.
//
// Ported from OC Manager's service/projectconfig, minus the write half: writing
// into the profile at runtime fights the mirror semantics (a deploy prunes the
// deployed copy) and belongs to the file-editing workstream, which is out of
// scope. Note the target's path confinement was a plain string-prefix check, so
// `/base-evil` passed `/base`; this uses a relative-path check with a separator
// boundary instead.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  ProjectConfigCategory,
  ProjectConfigCategoryId,
  ProjectConfigFile,
} from '@workbench/shared';

export type { ProjectConfigCategory, ProjectConfigCategoryId, ProjectConfigFile };

const CATEGORY_LABELS: Record<ProjectConfigCategoryId, string> = {
  coreConfig: '核心配置',
  agentsMd: '规则与说明',
  commands: '命令',
  rules: '规则',
  skills: '技能',
};

/** Loose files that belong to a category by name, not by folder. */
const ROOT_FILES: Partial<Record<ProjectConfigCategoryId, string[]>> = {
  coreConfig: ['opencode.json', 'opencode.jsonc', 'sandbox.json'],
  agentsMd: ['AGENTS.md', 'README.md'],
};

const MAX_READ_BYTES = 512 * 1024;

/** Collect files under `startRel`, returning paths relative to `rootDir`. The
 *  depth budget counts from `startRel` (0), so `skills` + 2 reaches
 *  `skills/<group>/<name>/SKILL.md`. */
function walk(
  rootDir: string,
  startRel: string,
  maxDepth: number,
  match: (name: string) => boolean,
): string[] {
  const found: string[] = [];
  const visit = (rel: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(rel ? join(rootDir, rel) : rootDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(childRel, depth + 1);
        continue;
      }
      if (match(entry.name)) found.push(childRel);
    }
  };
  visit(startRel, 0);
  return found.sort();
}

function fileMeta(profileDir: string, rel: string): ProjectConfigFile | null {
  try {
    const stat = statSync(join(profileDir, rel));
    if (!stat.isFile()) return null;
    return { rel, name: rel.split('/').pop() ?? rel, size: stat.size };
  } catch {
    return null;
  }
}

function listCategory(profileDir: string, id: ProjectConfigCategoryId): ProjectConfigFile[] {
  const rootFiles = ROOT_FILES[id];
  const rels = rootFiles
    ? rootFiles.filter((rel) => existsSync(join(profileDir, rel)))
    : id === 'skills'
      ? walk(profileDir, 'skills', 2, (name) => name === 'SKILL.md')
      : walk(profileDir, id, 0, (name) => name.endsWith('.md'));

  return rels
    .map((rel) => fileMeta(profileDir, rel))
    .filter((file): file is ProjectConfigFile => file !== null);
}

/** The five categories with the files each one currently holds. */
export function scanProjectConfig(profileDir: string): ProjectConfigCategory[] {
  return (Object.keys(CATEGORY_LABELS) as ProjectConfigCategoryId[]).map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
    files: listCategory(profileDir, id),
  }));
}

/** Resolve `rel` inside `profileDir`, refusing anything that escapes it. */
function resolveInside(profileDir: string, rel: string): string {
  const base = resolve(profileDir);
  const abs = resolve(base, rel);
  const inside = relative(base, abs);
  if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw new Error(`路径越界: ${rel}`);
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`文件不存在: ${rel}`);
  return abs;
}

/** Read one profile file for preview; throws when the path escapes the profile
 *  or the file is missing. */
export function readProjectConfigFile(profileDir: string, rel: string): string {
  const abs = resolveInside(profileDir, rel);
  const stat = statSync(abs);
  if (stat.size > MAX_READ_BYTES) throw new Error('文件过大，无法预览');
  return readFileSync(abs, 'utf-8');
}
