import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { linkDirectory, removeLink } from './symlink';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'symlink-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A target directory with one file in it. */
function makeTarget(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), 'body');
  return dir;
}

describe('linkDirectory', () => {
  it('reads through the link', () => {
    const target = makeTarget('target');
    const link = join(root, 'links', 'alias');
    linkDirectory(target, link);

    expect(readdirSync(link)).toEqual(['SKILL.md']);
    expect(readFileSync(join(link, 'SKILL.md'), 'utf-8')).toBe('body');
  });

  it('creates the parent directory and replaces an existing link', () => {
    const first = makeTarget('one');
    const second = makeTarget('two');
    const link = join(root, 'links', 'alias');

    linkDirectory(first, link);
    linkDirectory(second, link); // must not nest as alias/alias
    expect(readdirSync(link)).toEqual(['SKILL.md']);
    expect(readdirSync(join(root, 'links'))).toEqual(['alias']);
  });
});

describe('removeLink', () => {
  it('removes the link and leaves the target intact', () => {
    const target = makeTarget('target');
    const link = join(root, 'links', 'alias');
    linkDirectory(target, link);

    removeLink(link);

    // The whole point: dropping the pointer must not eat the real directory.
    expect(readdirSync(target)).toEqual(['SKILL.md']);
    expect(readdirSync(join(root, 'links'))).toEqual([]);
  });

  it('is idempotent', () => {
    const link = join(root, 'links', 'missing');
    removeLink(link);
    removeLink(link);
  });

  it('refuses to delete a real directory at the link path, and keeps its contents', () => {
    const real = join(root, 'links', 'alias');
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, 'keep.md'), 'mine');

    expect(() => removeLink(real)).toThrow();
    expect(readdirSync(real)).toEqual(['keep.md']);
  });
});
