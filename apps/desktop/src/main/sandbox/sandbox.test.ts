// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildBwrapArgs, isWsl1 } from './bwrap';
import { wrapSpawn } from './manager';
import { checkSandboxTightness, parseSandboxConfig, readSandboxConfig } from './policy';
import { buildSeatbeltProfile } from './seatbelt';
import { DEFAULT_SANDBOX_CONFIG, type SandboxPaths } from './types';

function makePaths(mode: 'with-git' | 'plain' = 'plain'): { paths: SandboxPaths; root: string } {
  const root = mkdtempSync(join(tmpdir(), `wb-sandbox-test-`));
  if (mode === 'with-git') {
    mkdirSync(join(root, 'ws', '.git'), { recursive: true });
    mkdirSync(join(root, 'xdg'), { recursive: true });
  }
  return {
    root,
    paths: {
      workspace: join(root, 'ws'),
      writableRoots: [join(root, 'xdg')],
      tmpDir: join(root, 'tmp'),
    },
  };
}

describe('parseSandboxConfig', () => {
  it('accepts a full valid config', () => {
    expect(
      parseSandboxConfig({ mode: 'read-only', network: 'loopback-only', required: true }),
    ).toEqual({
      mode: 'read-only',
      network: 'loopback-only',
      required: true,
    });
  });

  it('falls back per-field and rejects non-objects', () => {
    expect(parseSandboxConfig({ mode: 'bogus' })).toEqual(DEFAULT_SANDBOX_CONFIG);
    expect(parseSandboxConfig('nope')).toBeNull();
    expect(parseSandboxConfig(null)).toBeNull();
    expect(parseSandboxConfig(['workspace-write'])).toBeNull();
  });
});

describe('readSandboxConfig', () => {
  it('returns null when the file is absent and parses when present', () => {
    const { root } = makePaths();
    expect(readSandboxConfig(root)).toBeNull();
    writeFileSync(join(root, 'sandbox.json'), JSON.stringify({ mode: 'read-only' }));
    expect(readSandboxConfig(root)).toEqual({ ...DEFAULT_SANDBOX_CONFIG, mode: 'read-only' });
    writeFileSync(join(root, 'sandbox.json'), '{ broken');
    expect(readSandboxConfig(root)).toBeNull();
  });
});

describe('checkSandboxTightness', () => {
  const base = DEFAULT_SANDBOX_CONFIG;
  it('allows equal or tighter overlays', () => {
    expect(checkSandboxTightness(base, { ...base, mode: 'read-only' }).ok).toBe(true);
    expect(checkSandboxTightness(base, { ...base, network: 'loopback-only' }).ok).toBe(true);
    expect(checkSandboxTightness(base, { ...base, required: true }).ok).toBe(true);
  });
  it('rejects widening overlays', () => {
    expect(checkSandboxTightness(base, { ...base, mode: 'full-access' }).ok).toBe(false);
    expect(checkSandboxTightness({ ...base, network: 'loopback-only' }, { ...base }).ok).toBe(
      false,
    );
    expect(
      checkSandboxTightness({ ...base, required: true }, { ...base, required: false }).ok,
    ).toBe(false);
  });
});

describe('buildSeatbeltProfile', () => {
  it('denies by default and allows workspace writes in workspace-write mode', () => {
    const { paths } = makePaths();
    const profile = buildSeatbeltProfile(DEFAULT_SANDBOX_CONFIG, paths);
    expect(profile).toContain('(deny default)');
    expect(profile).toContain(`(subpath "${paths.workspace}")`);
    expect(profile).toContain(`(subpath "${paths.tmpDir}")`);
    expect(profile).toContain('(deny file-write* (regex');
    expect(profile).toContain('.git');
  });

  it('omits workspace writes in read-only mode', () => {
    const { paths } = makePaths();
    const profile = buildSeatbeltProfile({ ...DEFAULT_SANDBOX_CONFIG, mode: 'read-only' }, paths);
    expect(profile).not.toContain(`(subpath "${paths.workspace}")`);
    // XDG runtime roots stay writable so the sidecar can boot.
    expect(profile).toContain(`(subpath "${paths.writableRoots[0]}")`);
  });

  it('restricts outbound network in loopback-only mode', () => {
    const { paths } = makePaths();
    const profile = buildSeatbeltProfile(
      { ...DEFAULT_SANDBOX_CONFIG, network: 'loopback-only' },
      paths,
    );
    expect(profile).toContain('(deny network-outbound (remote ip "*:*"))');
    expect(profile).toContain('"127.0.0.1:*"');
  });
});

describe('buildBwrapArgs', () => {
  it('starts read-only and layers writable roots + protected binds', () => {
    const { paths } = makePaths('with-git');
    const argv = buildBwrapArgs(DEFAULT_SANDBOX_CONFIG, paths, '/bin/true', []);
    expect(argv.slice(0, 4)).toEqual(['--unshare-pid', '--ro-bind', '/', '/']);
    expect(argv).toContain('--bind');
    expect(argv).toContain(paths.workspace);
    // Protected subpath ro-bind present and after the workspace bind.
    const wsIdx = argv.indexOf(paths.workspace);
    const gitIdx = argv.indexOf(join(paths.workspace, '.git'));
    expect(gitIdx).toBeGreaterThan(wsIdx);
    expect(argv[argv.length - 1]).toBe('/bin/true');
    expect(argv[argv.indexOf('--') + 1]).toBe('/bin/true');
  });

  it('skips missing protected paths and unshares net in loopback-only mode', () => {
    const { paths } = makePaths('plain');
    const argv = buildBwrapArgs(
      { ...DEFAULT_SANDBOX_CONFIG, network: 'loopback-only' },
      paths,
      'python3',
      ['-c', '1'],
    );
    expect(argv).not.toContain(join(paths.workspace, '.git'));
    expect(argv).toContain('--unshare-net');
    expect(argv.indexOf('--proc')).toBeGreaterThan(argv.indexOf('--ro-bind'));
  });
});

describe('isWsl1', () => {
  it('is false off linux', () => {
    if (process.platform !== 'linux') expect(isWsl1()).toBe(false);
  });
});

describe('wrapSpawn (platform dispatch)', () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const r of tmpRoots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  it('passes through in full-access mode', async () => {
    const { paths } = makePaths();
    tmpRoots.push(paths.workspace, paths.tmpDir);
    const res = await wrapSpawn(
      { file: '/usr/bin/true', args: [], cwd: paths.workspace },
      { config: { ...DEFAULT_SANDBOX_CONFIG, mode: 'full-access' }, paths },
    );
    expect(res).toEqual({
      file: '/usr/bin/true',
      args: [],
      wrapped: false,
      detail: 'full-access mode',
    });
  });

  it('wraps with seatbelt on darwin', async () => {
    if (process.platform !== 'darwin') return; // platform dispatch is OS-bound
    const { paths } = makePaths();
    tmpRoots.push(paths.workspace, paths.tmpDir);
    mkdirSync(paths.tmpDir, { recursive: true });
    const res = await wrapSpawn(
      { file: '/usr/bin/true', args: ['--version'], cwd: paths.workspace },
      { config: DEFAULT_SANDBOX_CONFIG, paths },
    );
    expect(res.file).toBe('/usr/bin/sandbox-exec');
    expect(res.wrapped).toBe(true);
    const profileFile = res.args[1];
    expect(existsSync(profileFile)).toBe(true);
    expect(readFileSync(profileFile, 'utf-8')).toContain('(deny default)');
  });

  it('falls back direct when not required and the backend is unsupported', async () => {
    const { paths } = makePaths();
    tmpRoots.push(paths.workspace, paths.tmpDir);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const res = await wrapSpawn(
        { file: 'opencode.exe', args: ['serve'], cwd: paths.workspace },
        { config: DEFAULT_SANDBOX_CONFIG, paths },
      );
      expect(res.wrapped).toBe(false);
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });

  it('throws when required and the backend is unsupported', async () => {
    const { paths } = makePaths();
    tmpRoots.push(paths.workspace, paths.tmpDir);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await expect(
        wrapSpawn(
          { file: 'opencode.exe', args: ['serve'], cwd: paths.workspace },
          { config: { ...DEFAULT_SANDBOX_CONFIG, required: true }, paths },
        ),
      ).rejects.toThrow(/sandbox\.required = true/);
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });
});
