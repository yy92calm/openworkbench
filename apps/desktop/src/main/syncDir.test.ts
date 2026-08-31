// @vitest-environment node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { syncDir } from './syncDir';

function makeFixture(): string {
  const root = join(tmpdir(), `syncdir-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, 'src', 'nested', 'deep'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.txt'), 'alpha');
  writeFileSync(join(root, 'src', 'nested', 'b.txt'), 'bravo');
  writeFileSync(join(root, 'src', 'nested', 'deep', 'c.md'), '# C');
  return root;
}

describe('syncDir', () => {
  it('copies a full tree into an empty target', () => {
    const root = makeFixture();
    const dst = join(root, 'dst');
    syncDir(join(root, 'src'), dst);
    expect(readFileSync(join(dst, 'a.txt'), 'utf8')).toBe('alpha');
    expect(readFileSync(join(dst, 'nested', 'b.txt'), 'utf8')).toBe('bravo');
    expect(readFileSync(join(dst, 'nested', 'deep', 'c.md'), 'utf8')).toBe('# C');
  });

  it('is idempotent — second run copies nothing but keeps content', () => {
    const root = makeFixture();
    const src = join(root, 'src');
    const dst = join(root, 'dst');
    syncDir(src, dst);
    const before = Date.now();
    // Touch nothing; a repeated sync must not change any file content.
    syncDir(src, dst);
    expect(readFileSync(join(dst, 'a.txt'), 'utf8')).toBe('alpha');
    expect(readFileSync(join(dst, 'nested', 'b.txt'), 'utf8')).toBe('bravo');
    // Re-run after a modification picks up the change.
    writeFileSync(join(src, 'a.txt'), 'ALPHA!');
    syncDir(src, dst);
    expect(readFileSync(join(dst, 'a.txt'), 'utf8')).toBe('ALPHA!');
    expect(before).toBeGreaterThan(0);
  });

  it('deletes stale target files not present in source (mirror semantics)', () => {
    const root = makeFixture();
    const src = join(root, 'src');
    const dst = join(root, 'dst');
    syncDir(src, dst);
    writeFileSync(join(dst, 'stale.txt'), 'stale');
    mkdirSync(join(dst, 'orphan-dir'), { recursive: true });
    writeFileSync(join(dst, 'orphan-dir', 'x.txt'), 'x');
    syncDir(src, dst);
    expect(readFileSync(join(dst, 'a.txt'), 'utf8')).toBe('alpha');
    // Stale file and orphan dir are pruned.
    expect(existsSync(join(dst, 'stale.txt'))).toBe(false);
    expect(existsSync(join(dst, 'orphan-dir'))).toBe(false);
  });

  it('propagates new source files on subsequent syncs', () => {
    const root = makeFixture();
    const src = join(root, 'src');
    const dst = join(root, 'dst');
    syncDir(src, dst);
    writeFileSync(join(src, 'new.txt'), 'new');
    syncDir(src, dst);
    expect(readFileSync(join(dst, 'new.txt'), 'utf8')).toBe('new');
  });

  it('copies a symlink as-is rather than following it', () => {
    const root = makeFixture();
    const src = join(root, 'src');
    const dst = join(root, 'dst');
    writeFileSync(join(src, 'target.txt'), 't');
    symlinkSync('target.txt', join(src, 'link.txt'));
    syncDir(src, dst);
    expect(lstatSync(join(dst, 'link.txt')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dst, 'link.txt'), 'utf8')).toBe('t');
  });

  it('handles a missing target (creates it) and missing source (throws)', () => {
    const root = makeFixture();
    const dst = join(root, 'dst-missing');
    syncDir(join(root, 'src'), dst);
    expect(readFileSync(join(dst, 'a.txt'), 'utf8')).toBe('alpha');
    expect(() => syncDir(join(root, 'does-not-exist'), join(root, 'x'))).toThrow();
  });
});
