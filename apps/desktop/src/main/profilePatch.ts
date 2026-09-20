// User-level patch overlay for the OpenCode profile (deploy side).
// Lives entirely outside the mirrored target dir, so a base re-deploy
// (which prunes the target) never touches user customizations.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  applyProfilePatch,
  contentHash,
  type DeployedManifest,
  humanizePatchError,
  type InteractionConfig,
  parseRenderersJson,
  parseUiDefaultsJson,
  type PatchOp,
  PatchPolicyError,
  type PatchRejection,
  type ProfileRequirements,
  validateProfilePatch,
} from '@workbench/shared';
import { app } from 'electron';

import {
  checkSandboxTightness,
  parseSandboxConfig,
  readSandboxConfig,
  SANDBOX_CONFIG_FILE,
} from './sandbox/policy';
import { DEFAULT_SANDBOX_CONFIG } from './sandbox/types';

const PATCH_FILE = 'patch.json';
const MANIFEST_FILE = 'deployed-manifest.json';
const REQUIREMENTS_FILE = 'requirements.json';
/** Files that belong to overlay bookkeeping, never mirrored as overrides. */
const RESERVED = new Set([PATCH_FILE, MANIFEST_FILE, REQUIREMENTS_FILE]);

function logWarn(message: string): void {
  try {
    import('./logging').then(({ getLogger }) => getLogger().warn(`[profile] [patch] ${message}`));
  } catch {
    /* ignore logging failures */
  }
}

/** The app-private dir holding the user overlay. Never inside the target. */
export function userPatchDir(): string {
  return join(app.getPath('userData'), 'opencode-user');
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** Admin red lines for the patch overlay. A malformed requirements.json only
 *  warns — a broken admin file must not lock the app out of its own config. */
export function readRequirements(): { requirements: ProfileRequirements; warning?: string } {
  const raw = readJson<ProfileRequirements>(join(userPatchDir(), REQUIREMENTS_FILE));
  if (raw === null) return { requirements: {} };
  const requirements: ProfileRequirements = {};
  if (Array.isArray(raw.forbiddenPaths)) {
    requirements.forbiddenPaths = raw.forbiddenPaths.filter(
      (p): p is string => typeof p === 'string',
    );
  }
  if (raw.permissionCeiling && typeof raw.permissionCeiling === 'object') {
    const ceiling: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.permissionCeiling)) {
      if (typeof v === 'string') ceiling[k] = v;
    }
    requirements.permissionCeiling = ceiling;
  }
  return { requirements };
}

/** Apply one deploy:
 *  1. mirror user file overrides (patch.json and the manifest are reserved,
 *     so they never overwrite a base file of the same name)
 *  2. apply patch.json to the deployed opencode.json (permission-tightening enforced)
 *  3. write deployed-manifest.json
 * The caller runs this AFTER the base syncDir mirror. */
export function applyUserOverlay(target: string): DeployedManifest {
  const dir = userPatchDir();
  const overrides: string[] = [];
  if (existsSync(dir)) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(dir)) {
      if (RESERVED.has(entry)) continue;
      const from = join(dir, entry);
      if (!statSync(from).isFile()) continue;
      if (entry === SANDBOX_CONFIG_FILE) assertSandboxOverlayTightens(target, from);
      cpSync(from, join(target, entry));
      overrides.push(entry);
    }
  }

  const patchPath = join(dir, PATCH_FILE);
  const opencodePath = join(target, 'opencode.json');
  const base = existsSync(opencodePath) ? readFileSync(opencodePath, 'utf-8') : '{}';
  const baseFingerprint = contentHash(base);

  // Detect a modified bundled profile source (the previous manifest keeps the
  // last deployed base fingerprint). Source-side edits are not persisted by
  // the mirror, but they deserve a visible warning for human review.
  const previous = readDeployedManifest();
  const sourceChanged = previous !== null && previous.base !== baseFingerprint;

  let patchHash = 'none';
  if (existsSync(patchPath)) {
    const raw = readFileSync(patchPath, 'utf-8');
    patchHash = contentHash(raw);
    const { requirements } = readRequirements();
    const spec = validateProfilePatch(base, raw, requirements); // dry-run: throws on invalid / unsafe
    const merged = applyProfilePatch(base, { target: 'opencode.json', patch: spec }, requirements);
    writeFileSync(opencodePath, merged);
  }

  const merged = existsSync(opencodePath) ? readFileSync(opencodePath, 'utf-8') : '{}';
  const manifest: DeployedManifest = {
    base: baseFingerprint,
    merged: contentHash(merged),
    patch: patchHash,
    appliedAt: new Date().toISOString(),
    fileOverrides: overrides,
    sourceChanged,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  if (sourceChanged) {
    logWarn(
      `bundled profile base changed since last deploy (base=${previous?.base} -> ${baseFingerprint})`,
    );
  }
  return manifest;
}

/** Expose the last deploy manifest (null when never deployed). */
export function readDeployedManifest(): DeployedManifest | null {
  return readJson<DeployedManifest>(join(userPatchDir(), MANIFEST_FILE));
}

/** A user overlay of sandbox.json may only tighten the bundled policy.
 *  Throws PatchPolicyError when the overlay widens mode/network or disables
 *  a required sandbox (same one-way rule as permission patches). */
function assertSandboxOverlayTightens(target: string, overlayFile: string): void {
  const base = readSandboxConfig(target) ?? DEFAULT_SANDBOX_CONFIG;
  let overlay = null;
  try {
    overlay = parseSandboxConfig(JSON.parse(readFileSync(overlayFile, 'utf-8')));
  } catch {
    overlay = null;
  }
  if (!overlay) {
    throw new PatchPolicyError('sandbox.json overlay is not a valid sandbox config');
  }
  const check = checkSandboxTightness(base, overlay);
  if (!check.ok)
    throw new PatchPolicyError(check.reason ?? 'sandbox overlay would loosen the sandbox');
}

/** Validate and persist a user patch.json. Only structural checks run here —
 *  the live base comes from the deployed target, so the real dry-run happens
 *  at the next `applyUserOverlay`. Throws PatchPolicyError on invalid input. */
export function writeUserPatch(raw: string): void {
  const spec = JSON.parse(raw) as { target?: string; patch?: unknown };
  if (typeof spec.target !== 'string') throw new PatchPolicyError('target is required');
  if (!Array.isArray(spec.patch)) throw new PatchPolicyError('patch array is required');

  const dir = userPatchDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PATCH_FILE), raw);
}

export type WritePatchResult =
  { ok: true; manifest: DeployedManifest | null } | { ok: false; error: string; stale?: boolean };

/** CAS-checked variant used by the settings UI: re-reads the deployed base,
 *  verifies `expectedBaseHash` still matches, then persists. The next deploy
 *  re-validates the patch against the base regardless. */
export function writeUserPatchChecked(
  target: string,
  raw: string,
  expectedBaseHash?: string,
): WritePatchResult {
  const opencodePath = join(target, 'opencode.json');
  const base = existsSync(opencodePath) ? readFileSync(opencodePath, 'utf-8') : '{}';
  if (expectedBaseHash && contentHash(base) !== expectedBaseHash) {
    return { ok: false, error: 'stale', stale: true };
  }
  try {
    const { requirements } = readRequirements();
    validateProfilePatch(base, raw, requirements); // early rejection with the live base
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    writeUserPatch(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, manifest: readDeployedManifest() };
}

/** Read the deployed interaction config (renderers + UI defaults) from the
 *  OpenCode config dir. Missing/invalid files degrade to empty defaults. */
export function readInteractionConfig(target: string): InteractionConfig {
  const read = (name: string): string | undefined => {
    const file = join(target, 'interaction', name);
    return existsSync(file) ? readFileSync(file, 'utf-8') : undefined;
  };
  return {
    renderers: parseRenderersJson(read('renderers.json')),
    ui: parseUiDefaultsJson(read('ui.json')),
  };
}

export type ValidateResult =
  { ok: true; ops: number; baseHash: string } | { ok: false; rejection: PatchRejection };

/** Dry-run a patch against the deployed opencode.json. Never writes; returns
 *  the operation count and the base content hash (for CAS at write time), or
 *  a user-facing rejection on failure. */
export function validateUserPatch(base: string, raw: string): ValidateResult {
  const { requirements } = readRequirements();
  try {
    const ops = validateProfilePatch(base, raw, requirements);
    return { ok: true, ops: ops.length, baseHash: contentHash(base) };
  } catch (err) {
    return { ok: false, rejection: humanizePatchError(err) };
  }
}

export interface ConfigExplanation {
  merged: unknown;
  /** Per top-level key, which layer last set it: "base" or "patch". */
  origins: Record<string, 'base' | 'patch'>;
  patchApplied: boolean;
}

/** Replay the user patch over the deployed opencode.json and attribute every
 *  top-level key to its winning layer ("who said this value"). Read-only. */
export function explainConfig(target: string): ConfigExplanation {
  const opencodePath = join(target, 'opencode.json');
  const base = existsSync(opencodePath) ? readFileSync(opencodePath, 'utf-8') : '{}';
  const baseObj = JSON.parse(base) as Record<string, unknown>;
  const origins: Record<string, 'base' | 'patch'> = {};
  for (const key of Object.keys(baseObj)) origins[key] = 'base';

  const raw = readJson<UserPatchSpecLike>(join(userPatchDir(), PATCH_FILE));
  let merged = baseObj;
  let patchApplied = false;
  if (raw && Array.isArray(raw.patch)) {
    try {
      const { requirements } = readRequirements();
      const spec = { target: 'opencode.json', patch: raw.patch } as {
        target: string;
        patch: PatchOp[];
      };
      const mergedStr = applyProfilePatch(base, spec, requirements);
      merged = JSON.parse(mergedStr) as Record<string, unknown>;
      patchApplied = true;
      for (const op of raw.patch as Array<{ path?: string }>) {
        if (typeof op.path !== 'string') continue;
        const top = op.path.split('/')[1];
        if (top) origins[top] = 'patch';
      }
    } catch {
      // Patch invalid against the current base (e.g. written then base changed):
      // report base-only truth instead of pretending the patch applies.
      patchApplied = false;
      for (const key of Object.keys(baseObj)) origins[key] = 'base';
    }
  }
  return { merged, origins, patchApplied };
}

interface UserPatchSpecLike {
  target?: unknown;
  patch?: unknown;
}
