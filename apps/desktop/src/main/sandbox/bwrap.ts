// Linux bubblewrap backend: probes system bwrap (user/net namespace support)
// and builds the bwrap argv that mirrors the Seatbelt semantics — filesystem
// read-only by default, writable roots layered on top, protected workspace
// subpaths re-applied as read-only binds.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SandboxConfig, SandboxPaths } from './types';

const PROBE_TIMEOUT_MS = 3000;

/** Workspace subpaths that stay read-only even when the workspace is a
 *  writable root (workspace-write mode). */
const PROTECTED_WORKSPACE_NAMES = ['.git', '.workbench'] as const;

export interface BwrapProbe {
  ok: boolean;
  detail: string;
}

/** Probe that bwrap exists and can create user + network namespaces (same
 *  probe shape as Codex's system bwrap detection). */
export function detectBwrap(timeoutMs: number = PROBE_TIMEOUT_MS): Promise<BwrapProbe> {
  return new Promise((resolve) => {
    execFile(
      'bwrap',
      ['--unshare-user', '--unshare-net', '--ro-bind', '/', '/', '/bin/true'],
      { timeout: timeoutMs },
      (err) => {
        if (!err) {
          resolve({ ok: true, detail: 'system bubblewrap available' });
          return;
        }
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          resolve({
            ok: false,
            detail: 'bubblewrap not found on PATH (install with your OS package manager)',
          });
          return;
        }
        resolve({ ok: false, detail: `bubblewrap probe failed: ${err.message}` });
      },
    );
  });
}

/** WSL1 cannot create the user namespaces bubblewrap needs; WSL2 works. */
export function isWsl1(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const version = readFileSync('/proc/version', 'utf-8');
    return /microsoft/i.test(version) && !/WSL2|microsoft-standard/i.test(version);
  } catch {
    return false;
  }
}

/** Build the bwrap argv prefix for the spawn request. Order matters:
 *  `--ro-bind / /` first (default read-only view), then writable/proc/dev
 *  overlays which shadow it. Protected subpaths come last so their read-only
 *  binds win over the writable workspace root. */
export function buildBwrapArgs(
  config: SandboxConfig,
  paths: SandboxPaths,
  file: string,
  args: string[],
): string[] {
  const argv: string[] = ['--unshare-pid', '--ro-bind', '/', '/'];

  for (const root of [...paths.writableRoots, paths.tmpDir]) {
    argv.push('--bind', root, root);
  }
  if (config.mode === 'workspace-write') {
    argv.push('--bind', paths.workspace, paths.workspace);
    for (const name of PROTECTED_WORKSPACE_NAMES) {
      const p = join(paths.workspace, name);
      // Only bind when present — bwrap errors on missing sources.
      if (existsSync(p)) argv.push('--ro-bind', p, p);
    }
  }
  // Fresh /proc and /dev on top of the read-only root view.
  argv.push('--dev', '/dev');
  argv.push('--proc', '/proc');

  if (config.network === 'loopback-only') {
    // Phase one: loopback-only equals full network isolation on Linux (no
    // proxy bridge yet) — documented in plans/沙盒机制实现方案.md.
    argv.push('--unshare-net');
  }

  argv.push('--');
  argv.push(file);
  argv.push(...args);
  return argv;
}
