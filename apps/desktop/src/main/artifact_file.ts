import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import { shell } from 'electron';

import { baseWorkspaceDir, workspaceDir } from './server';

const PREVIEW_CAP = 25 * 1024 * 1024;

export interface DirEntry {
  name: string;
  is_dir: boolean;
  is_file: boolean;
  size: number;
}

export interface NotebookEntry {
  name: string;
  path: string;
  modified: string;
}

function rootDir(root?: string): string {
  if (root === 'base') return baseWorkspaceDir();
  return workspaceDir();
}

function resolveUnderRoot(rel: string, root?: string, allowCreate = false): string | null {
  const base = rootDir(root);
  const abs = resolve(base, rel);
  if (!abs.startsWith(base)) return null;
  if (!allowCreate && !existsSync(abs)) return null;
  return abs;
}

export function readArtifact(
  rel: string,
  root?: string,
): { content: string; binary: boolean } | null {
  const file = resolveUnderRoot(rel, root);
  if (!file || !existsSync(file)) return null;
  const stat = statSync(file);
  if (stat.size > PREVIEW_CAP) return null;
  const buf = readFileSync(file);
  const binary = buf.includes(0);
  return { content: binary ? buf.toString('base64') : buf.toString('utf-8'), binary };
}

export function resolveArtifact(rel: string, root?: string): string | null {
  const base = rootDir(root);
  const file = resolveUnderRoot(rel, root);
  return file && existsSync(file) ? relative(base, file) : null;
}

export function openPath(rel: string, root?: string): void {
  const file = resolveUnderRoot(rel, root);
  if (file) shell.openPath(file);
}

export function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  shell.openExternal(url);
}

export function saveTextFile(filename: string, content: string): string | null {
  const dir = workspaceDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, filename);
  if (existsSync(file)) {
    const ext = extname(filename);
    const base = basename(filename, ext);
    for (let i = 1; i < 1000; i++) {
      const alt = join(dir, `${base} (${i})${ext}`);
      if (!existsSync(alt)) {
        writeFileSync(alt, content, 'utf-8');
        return alt;
      }
    }
  }
  writeFileSync(file, content, 'utf-8');
  return file;
}

export function addTextToWorkspace(filename: string, content: string): string {
  const dir = workspaceDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, filename);
  writeFileSync(file, content, 'utf-8');
  return filename;
}

export function listDir(rel: string, root?: string): DirEntry[] {
  const dir = resolveUnderRoot(rel, root);
  if (!dir || !existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const result: DirEntry[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      result.push({
        name: e.name,
        is_dir: e.isDirectory(),
        is_file: e.isFile(),
        size: e.isFile() ? statSync(join(dir, e.name)).size : 0,
      });
    }
    result.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  } catch {
    return [];
  }
}

export function listNotebooks(root?: string): NotebookEntry[] {
  const base = rootDir(root);
  if (!existsSync(base)) return [];
  const notebooks: NotebookEntry[] = [];
  try {
    const walk = (dir: string, depth: number) => {
      if (depth > 3) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.name.endsWith('.ipynb')) {
          notebooks.push({
            name: entry.name,
            path: relative(base, full),
            modified: statSync(full).mtime.toISOString(),
          });
        }
      }
    };
    if (root === 'base') {
      // Base mode: each subdirectory is a session folder, notebooks are inside
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        walk(join(base, entry.name), 1);
      }
    } else {
      walk(base, 0);
    }
  } catch {
    /* skip */
  }
  notebooks.sort((a, b) => b.modified.localeCompare(a.modified));
  return notebooks;
}

export function writeWorkspaceFile(rel: string, content: string, root?: string): void {
  const file = resolveUnderRoot(rel, root, true);
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf-8');
}
