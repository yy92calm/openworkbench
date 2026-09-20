// macOS Seatbelt backend: renders an SBPL profile and wraps the spawn request
// with /usr/bin/sandbox-exec. The executable path is hardcoded (never resolved
// via PATH) to defend against a malicious binary being injected — same
// reasoning as Codex's seatbelt integration.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SandboxConfig, SandboxPaths, SandboxSpawnRequest } from './types';

/** Only consider sandbox-exec in /usr/bin. If it has been tampered with, the
 *  attacker already has root access. */
export const SEATBELT_EXECUTABLE = '/usr/bin/sandbox-exec';

/** Workspace subpaths that stay write-protected even when the workspace itself
 *  is writable (workspace-write mode). */
const PROTECTED_WORKSPACE_NAMES = ['.git', '.workbench'] as const;

function sbplRegexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quoted(p: string): string {
  return `"${p}"`;
}

/** Seatbelt matches the *real* path, and macOS resolves /tmp and /var to
 *  /private/tmp and /private/var without normalizing the strings given in the
 *  profile. Any writable root under those symlinks needs an explicit
 *  /private-prefixed variant or the allow rule never fires. */
function withPrivateVariants(roots: string[]): string[] {
  const out = new Set(roots);
  for (const p of roots) {
    if (p.startsWith('/tmp/') || p === '/tmp' || p.startsWith('/var/') || p === '/var') {
      out.add(`/private${p}`);
    }
  }
  return [...out];
}

/** Render the SBPL profile for one spawn.
 *
 *  Semantics (phase one): deny default; file reads are open (deny-read is a
 *  later phase); writes restricted to the mode's writable roots plus temp;
 *  network open or loopback-only. System compatibility allowances (sysctl,
 *  mach-lookup, IOKit) mirror the common subset of Codex's base policy. */
export function buildSeatbeltProfile(config: SandboxConfig, paths: SandboxPaths): string {
  const lines: string[] = [];

  lines.push('(version 1)');
  lines.push('(deny default)');

  // Process + system compatibility.
  lines.push('(allow process-exec*)');
  lines.push('(allow process-fork)');
  lines.push('(allow signal (target self))');
  lines.push('(allow sysctl-read)');
  lines.push('(allow mach-lookup)');
  lines.push('(allow iokit-open)');
  lines.push('(allow system-socket)');

  // Reads are open in phase one.
  lines.push('(allow file-read*)');
  lines.push('(allow file-test-existence)');

  // Writes: mode roots + temp dirs. Temp is always available so the sidecar
  // and interpreters can create scratch files. /private variants cover the
  // /tmp and /var symlink resolution (see withPrivateVariants).
  const writeRoots = [...paths.writableRoots];
  if (config.mode === 'workspace-write') writeRoots.push(paths.workspace);
  writeRoots.push(paths.tmpDir, '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp');
  const uniqueRoots = withPrivateVariants(writeRoots);
  lines.push(`(allow file-write* ${uniqueRoots.map((p) => `(subpath ${quoted(p)})`).join(' ')})`);

  // Protected subpaths inside a writable workspace (workspace-write only; in
  // read-only mode the workspace is not writable at all). The optional
  // /private prefix keeps the deny effective when the workspace path itself
  // sits under a /tmp or /var symlink.
  if (config.mode === 'workspace-write') {
    for (const name of PROTECTED_WORKSPACE_NAMES) {
      const p = join(paths.workspace, name);
      const esc = sbplRegexEscape(p);
      lines.push(`(deny file-write* (regex #"^(/private)?${esc}(/|$)"))`);
    }
  }

  // Network.
  if (config.network === 'loopback-only') {
    lines.push('(deny network-outbound (remote ip "*:*"))');
    lines.push('(allow network-outbound (remote ip "127.0.0.1:*") (remote ip "::1:*"))');
    lines.push('(allow network-bind (local ip "127.0.0.1:*") (local ip "::1:*"))');
    lines.push('(allow network-inbound (local ip "127.0.0.1:*") (local ip "::1:*"))');
  } else {
    lines.push('(allow network-outbound)');
    lines.push('(allow network-bind)');
    lines.push('(allow network-inbound)');
  }

  return `${lines.join('\n')}\n`;
}

/** Write the profile to a temp file and return the wrapped spawn command. */
export function wrapWithSeatbelt(
  req: SandboxSpawnRequest,
  config: SandboxConfig,
  paths: SandboxPaths,
): { file: string; args: string[] } {
  const profilePath = join(paths.tmpDir, 'workbench-sandbox.sb');
  writeFileSync(profilePath, buildSeatbeltProfile(config, paths));
  return {
    file: SEATBELT_EXECUTABLE,
    args: ['-f', profilePath, req.file, ...req.args],
  };
}
