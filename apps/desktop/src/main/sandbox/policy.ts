// Sandbox config loading and tightness rules.
// Config lives in the deployed profile dir as `sandbox.json` (bundled from
// app-config/.opencode/, overridable via the user overlay which may only
// tighten it — see profilePatch.ts). Pure node, no electron imports.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_SANDBOX_CONFIG,
  type SandboxConfig,
  type SandboxMode,
  type SandboxNetwork,
} from './types';

export const SANDBOX_CONFIG_FILE = 'sandbox.json';

const MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'full-access'];
const NETWORKS: readonly SandboxNetwork[] = ['open', 'loopback-only'];

/** Parse and validate a raw sandbox config object. Invalid fields fall back
 *  to the defaults individually; only non-object input yields null. */
export function parseSandboxConfig(raw: unknown): SandboxConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  return {
    mode: MODES.includes(obj.mode as SandboxMode)
      ? (obj.mode as SandboxMode)
      : DEFAULT_SANDBOX_CONFIG.mode,
    network: NETWORKS.includes(obj.network as SandboxNetwork)
      ? (obj.network as SandboxNetwork)
      : DEFAULT_SANDBOX_CONFIG.network,
    required: typeof obj.required === 'boolean' ? obj.required : DEFAULT_SANDBOX_CONFIG.required,
  };
}

/** Read `sandbox.json` from a profile dir. Null when absent or invalid —
 *  callers fall back to DEFAULT_SANDBOX_CONFIG. */
export function readSandboxConfig(profileDir: string): SandboxConfig | null {
  const file = join(profileDir, SANDBOX_CONFIG_FILE);
  if (!existsSync(file)) return null;
  try {
    return parseSandboxConfig(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return null;
  }
}

const MODE_RANK: Record<SandboxMode, number> = {
  // Larger = looser. Overlays may only move down or stay.
  'full-access': 3,
  'workspace-write': 2,
  'read-only': 1,
};

const NETWORK_RANK: Record<SandboxNetwork, number> = {
  open: 2,
  'loopback-only': 1,
};

export interface SandboxTightnessCheck {
  ok: boolean;
  reason?: string;
}

/** A user overlay for the sandbox config must never be looser than the base:
 *  mode/network may only tighten, and an enabled `required` cannot be turned
 *  off. */
export function checkSandboxTightness(
  base: SandboxConfig,
  overlay: SandboxConfig,
): SandboxTightnessCheck {
  if (MODE_RANK[overlay.mode] > MODE_RANK[base.mode]) {
    return {
      ok: false,
      reason: `sandbox.mode would widen from "${base.mode}" to "${overlay.mode}"`,
    };
  }
  if (NETWORK_RANK[overlay.network] > NETWORK_RANK[base.network]) {
    return {
      ok: false,
      reason: `sandbox.network would widen from "${base.network}" to "${overlay.network}"`,
    };
  }
  if (base.required && !overlay.required) {
    return { ok: false, reason: 'sandbox.required cannot be disabled once enabled' };
  }
  return { ok: true };
}
