// User-level patch overlay for the deployed OpenCode profile.
// Pure, browser-safe logic shared by the Electron main process (deploy) and the
// settings UI (manifest display / patch validation). No Node imports.

/** RFC 6902 JSON Patch operation. */
export type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

/** A declarative overlay applied to one file of the deployed profile. */
export interface UserPatchSpec {
  /** Target file under the deployed .opencode dir, e.g. "opencode.json". */
  target: string;
  patch?: PatchOp[];
}

export interface DeployedManifest {
  /** Content hash of the base opencode.json before overlay. */
  base: string;
  /** Content hash of the merged result. */
  merged: string;
  /** Content hash of user/patch.json, or "none" when absent. */
  patch: string;
  /** ISO timestamp of the applying deploy. */
  appliedAt: string;
  /** File-path overrides laid over the base before the JSON patch. */
  fileOverrides: string[];
}

/** Deterministic short content hash without Node crypto (FNV-1a 32, hex). */
export function contentHash(value: unknown): string {
  const data = typeof value === 'string' ? value : JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Decode a JSON Pointer reference token ("~1" → "/", "~0" → "~"). */
function decodeToken(tok: string): string {
  return tok.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve a JSON Pointer to the parent node and final key/index. */
function resolvePointer(
  doc: unknown,
  pointer: string,
): { parent: unknown; key: string; exists: boolean } {
  if (!pointer.startsWith('/')) throw new Error(`invalid pointer: ${pointer}`);
  const tokens = pointer.split('/').slice(1).map(decodeToken);
  let node: unknown = doc;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (node === null || typeof node !== 'object') throw new Error(`pointer ${pointer} not found`);
    node = (node as Record<string, unknown>)[tokens[i]];
  }
  const key = tokens[tokens.length - 1] ?? '';
  const parent = node;
  const exists =
    parent !== null && typeof parent === 'object' && key in (parent as Record<string, unknown>);
  return { parent, key, exists };
}

function hasOwn(obj: unknown, key: string): boolean {
  return obj !== null && typeof obj === 'object' && key in (obj as Record<string, unknown>);
}

/** Apply one RFC 6902 operation. Mutates `doc` in place like the spec. */
function applyOp(doc: unknown, op: PatchOp): never | void {
  switch (op.op) {
    case 'add': {
      const { parent, key, exists } = resolvePointer(doc, op.path);
      if (exists && Array.isArray(parent)) {
        if (key === '-') (parent as unknown[]).push(op.value);
        else (parent as unknown[])[Number(key)] = op.value;
      } else {
        (parent as Record<string, unknown>)[key] = op.value;
      }
      return;
    }
    case 'remove': {
      const { parent, key, exists } = resolvePointer(doc, op.path);
      if (!exists) throw new Error(`remove: ${op.path} does not exist`);
      if (Array.isArray(parent)) (parent as unknown[]).splice(Number(key), 1);
      else delete (parent as Record<string, unknown>)[key];
      return;
    }
    case 'replace': {
      const { parent, key, exists } = resolvePointer(doc, op.path);
      if (!exists) throw new Error(`replace: ${op.path} does not exist`);
      (parent as Record<string, unknown>)[key] = op.value;
      return;
    }
    case 'test': {
      const { parent, key, exists } = resolvePointer(doc, op.path);
      if (!exists) throw new Error(`test: ${op.path} does not exist`);
      if (JSON.stringify((parent as Record<string, unknown>)[key]) !== JSON.stringify(op.value))
        throw new Error(`test: ${op.path} mismatched`);
      return;
    }
    case 'move': {
      const { parent: fromParent, key: fromKey, exists } = resolvePointer(doc, op.from);
      if (!exists) throw new Error(`move: source ${op.from} does not exist`);
      const value = (fromParent as Record<string, unknown>)[fromKey];
      if (Array.isArray(fromParent)) (fromParent as unknown[]).splice(Number(fromKey), 1);
      else delete (fromParent as Record<string, unknown>)[fromKey];
      applyOp(doc, { op: 'add', path: op.path, value });
      return;
    }
    case 'copy': {
      const { parent, key } = resolvePointer(doc, op.from);
      const value = (parent as Record<string, unknown>)[key];
      applyOp(doc, { op: 'add', path: op.path, value });
      return;
    }
  }
}

const PERMISSION_LEVELS: Record<string, number> = { allow: 3, ask: 2, deny: 1 };

function permissionLevel(v: unknown): number {
  if (v === true) return 3;
  if (v === false) return 1;
  if (typeof v === 'string') return PERMISSION_LEVELS[v] ?? 2;
  return 2;
}

/** Keys on opencode.json that must never be touched by a user overlay. */
const FORBIDDEN_ROOTS = new Set(['/instructions']);

export class PatchPolicyError extends Error {}

/**
 * Apply a user overlay to the base opencode.content, enforcing safety:
 * - `/instructions` is never patchable.
 * - `permission` may only tighten (never widen to a more permissive level);
 *   an absent base key defaults to "ask".
 * Returns a deep copy; the input is never mutated.
 */
export function applyProfilePatch(base: string, spec: UserPatchSpec): string {
  const baseDoc: unknown = JSON.parse(base);
  if (spec.target !== 'opencode.json') {
    throw new PatchPolicyError(`target ${spec.target} is not patchable`);
  }
  const ops = spec.patch ?? [];
  for (const op of ops) {
    if (FORBIDDEN_ROOTS.has(op.path))
      throw new PatchPolicyError(`path ${op.path} is not patchable`);
    if ((op.op === 'move' || op.op === 'copy') && FORBIDDEN_ROOTS.has(op.from))
      throw new PatchPolicyError(`path ${op.from} is not patchable`);
  }
  const doc: unknown = JSON.parse(JSON.stringify(baseDoc));
  for (const op of ops) applyOp(doc, op);

  const baseObj = baseDoc as Record<string, unknown>;
  const docObj = doc as Record<string, unknown>;
  const basePerm = (baseObj.permission ?? {}) as Record<string, unknown>;
  const mergedPerm = (docObj.permission ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(mergedPerm)) {
    const baseLevel = hasOwn(basePerm, k) ? permissionLevel(basePerm[k]) : PERMISSION_LEVELS.ask;
    if (permissionLevel(v) > baseLevel) {
      throw new PatchPolicyError(
        `permission "${k}" would widen from ${JSON.stringify(basePerm[k] ?? 'ask')} to ${JSON.stringify(v)}`,
      );
    }
  }
  return JSON.stringify(doc, null, 2);
}

/** Validate a patch file (parse + dry-run against a base content string). */
export function validateProfilePatch(base: string, rawPatch: string): PatchOp[] {
  let spec: UserPatchSpec;
  try {
    spec = JSON.parse(rawPatch) as UserPatchSpec;
  } catch {
    throw new PatchPolicyError('patch.json is not valid JSON');
  }
  if (!Array.isArray(spec.patch)) throw new PatchPolicyError('patch.json has no patch array');
  applyProfilePatch(base, spec);
  return spec.patch ?? [];
}

/** Error bucket for a rejected patch, used to show the user a plain-language
 *  reason (and to never silently swallow a policy violation). */
export type PatchRejection =
  | { kind: 'permission'; detail: string }
  | { kind: 'forbidden-path'; detail: string }
  | { kind: 'syntax'; detail: string }
  | { kind: 'target'; detail: string }
  | { kind: 'unknown'; detail: string };

/** Map an error thrown by the patch pipeline to a user-facing rejection. */
export function humanizePatchError(err: unknown): PatchRejection {
  if (err instanceof PatchPolicyError) {
    const msg = err.message;
    if (msg.includes('would widen')) return { kind: 'permission', detail: msg };
    if (msg.includes('not patchable')) return { kind: 'forbidden-path', detail: msg };
    if (msg.includes('not valid JSON') || msg.includes('no patch array'))
      return { kind: 'syntax', detail: msg };
    if (msg.includes('target')) return { kind: 'target', detail: msg };
    return { kind: 'unknown', detail: msg };
  }
  if (err instanceof Error) return { kind: 'unknown', detail: err.message };
  return { kind: 'unknown', detail: String(err) };
}
