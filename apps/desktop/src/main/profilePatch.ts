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
  PatchPolicyError,
  type PatchRejection,
  validateProfilePatch,
} from '@workbench/shared';
import { app } from 'electron';

const PATCH_FILE = 'patch.json';
const MANIFEST_FILE = 'deployed-manifest.json';
/** Files that belong to overlay bookkeeping, never mirrored as overrides. */
const RESERVED = new Set([PATCH_FILE, MANIFEST_FILE]);

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
      cpSync(from, join(target, entry));
      overrides.push(entry);
    }
  }

  const patchPath = join(dir, PATCH_FILE);
  const opencodePath = join(target, 'opencode.json');
  const base = existsSync(opencodePath) ? readFileSync(opencodePath, 'utf-8') : '{}';
  const baseFingerprint = contentHash(base);

  let patchHash = 'none';
  if (existsSync(patchPath)) {
    const raw = readFileSync(patchPath, 'utf-8');
    patchHash = contentHash(raw);
    const spec = validateProfilePatch(base, raw); // dry-run: throws on invalid / unsafe
    const merged = applyProfilePatch(base, { target: 'opencode.json', patch: spec });
    writeFileSync(opencodePath, merged);
  }

  const merged = existsSync(opencodePath) ? readFileSync(opencodePath, 'utf-8') : '{}';
  const manifest: DeployedManifest = {
    base: baseFingerprint,
    merged: contentHash(merged),
    patch: patchHash,
    appliedAt: new Date().toISOString(),
    fileOverrides: overrides,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Expose the last deploy manifest (null when never deployed). */
export function readDeployedManifest(): DeployedManifest | null {
  return readJson<DeployedManifest>(join(userPatchDir(), MANIFEST_FILE));
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

export type ValidateResult = { ok: true; ops: number } | { ok: false; rejection: PatchRejection };

/** Dry-run a patch against the deployed opencode.json. Never writes; returns
 *  the operation count on success, or a user-facing rejection on failure. */
export function validateUserPatch(base: string, raw: string): ValidateResult {
  try {
    const ops = validateProfilePatch(base, raw);
    return { ok: true, ops: ops.length };
  } catch (err) {
    return { ok: false, rejection: humanizePatchError(err) };
  }
}
