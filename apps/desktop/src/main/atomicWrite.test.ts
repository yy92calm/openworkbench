import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWriteFile, quarantineFile, readJsonFile } from './atomicWrite';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'atomic-write-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('atomicWriteFile', () => {
  it('writes the file and leaves no temp file behind', () => {
    const file = join(root, 'state.json');
    atomicWriteFile(file, '{"a":1}');
    expect(readFileSync(file, 'utf-8')).toBe('{"a":1}');
    expect(readdirSync(root)).toEqual(['state.json']);
  });

  it('overwrites an existing file in place', () => {
    const file = join(root, 'state.json');
    writeFileSync(file, 'old');
    atomicWriteFile(file, 'new');
    expect(readFileSync(file, 'utf-8')).toBe('new');
  });

  it('fails without leaving anything behind when the directory is missing', () => {
    const file = join(root, 'missing', 'state.json');
    expect(() => atomicWriteFile(file, 'x')).toThrow();
    expect(existsSync(join(root, 'missing'))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('readJsonFile', () => {
  it('returns the fallback for a missing file (normal first run)', () => {
    expect(readJsonFile(join(root, 'nope.json'), { days: {} })).toEqual({ days: {} });
  });

  it('parses a valid file', () => {
    const file = join(root, 'ok.json');
    writeFileSync(file, '{"n":2}');
    expect(readJsonFile<unknown>(file, null)).toEqual({ n: 2 });
  });

  it('quarantines a corrupt file instead of silently rebuilding it', () => {
    const file = join(root, 'broken.json');
    writeFileSync(file, '{ broken');
    expect(readJsonFile(file, [])).toEqual([]);
    expect(existsSync(file)).toBe(false);
    const aside = readdirSync(root).filter((f) => f.startsWith('broken.json.corrupt-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(root, aside[0]), 'utf-8')).toBe('{ broken');
  });
});

describe('quarantineFile', () => {
  it('returns null when there is nothing to move', () => {
    expect(quarantineFile(join(root, 'absent.json'))).toBeNull();
  });
});
