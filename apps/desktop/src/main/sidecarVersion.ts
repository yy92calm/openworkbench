// OpenCode engine version check: the bundled sidecar's version against the
// latest upstream GitHub release.
//
// Deliberately separate from updater.ts, which updates the Workbench app
// itself — "app update" and "engine update" are different things and must not
// be presented as one.

import { execFileSync } from 'node:child_process';

import { sidecarBinaryPath } from './sidecarPaths';

const RELEASES_URL = 'https://api.github.com/repos/anomalyco/opencode/releases/latest';
const PROBE_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface SidecarVersionStatus {
  /** Bundled engine version; null when the binary could not be probed. */
  current: string | null;
  /** Latest upstream release; null when the check failed. */
  latest: string | null;
  /** True/false once both sides are known, null otherwise. */
  isLatest: boolean | null;
  /** Why the check failed (offline, rate-limited, …). Surfaced as a status
   *  line rather than an error dialog — a failed version check is not an app
   *  error. */
  error: string | null;
}

/** `v1.2.3` and `1.2.3` are the same version. */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '');
}

/** Read the bundled engine's version by asking the binary itself. */
export function probeCurrentVersion(): string | null {
  try {
    const out = execFileSync(sidecarBinaryPath(), ['--version'], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
    }).trim();
    return out ? normalizeVersion(out) : null;
  } catch {
    return null;
  }
}

/** Latest release tag from GitHub; throws on network or API failure. */
async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(RELEASES_URL, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const body = (await res.json()) as { tag_name?: unknown };
  if (typeof body.tag_name !== 'string' || !body.tag_name) {
    throw new Error('release payload has no tag_name');
  }
  return normalizeVersion(body.tag_name);
}

/** Never throws: an unreachable network is a normal outcome reported in
 *  `error`, not an exception the caller has to catch. */
export async function checkSidecarVersion(): Promise<SidecarVersionStatus> {
  const current = probeCurrentVersion();
  try {
    const latest = await fetchLatestVersion();
    return { current, latest, isLatest: current ? current === latest : null, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { current, latest: null, isLatest: null, error: message };
  }
}
