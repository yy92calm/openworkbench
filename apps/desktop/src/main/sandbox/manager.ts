// Central sandbox dispatch: selects the platform backend, wraps spawn
// requests, and reports status. Mirrors Codex's SandboxManager shape in
// miniature: policy in, wrapped command out, pass-through only for
// full-access or an explicitly-tolerated unavailable backend.
import { buildBwrapArgs, detectBwrap, isWsl1 } from './bwrap';
import { wrapWithSeatbelt } from './seatbelt';
import {
  type SandboxConfig,
  type SandboxPaths,
  type SandboxPlatform,
  type SandboxSpawnRequest,
  type SandboxStatus,
  SandboxUnavailableError,
} from './types';

/** Platform backend for the current process. */
export function getPlatformSandbox(): SandboxPlatform {
  if (process.platform === 'darwin') return 'seatbelt';
  if (process.platform === 'linux') return 'bwrap';
  return 'unsupported';
}

export interface WrapContext {
  config: SandboxConfig;
  paths: SandboxPaths;
}

function unavailable(
  config: SandboxConfig,
  req: SandboxSpawnRequest,
  detail: string,
): { file: string; args: string[]; wrapped: false; detail: string } {
  if (config.required) {
    throw new SandboxUnavailableError(`${detail} (sandbox.required = true)`);
  }
  return { file: req.file, args: req.args, wrapped: false, detail };
}

/** Wrap a spawn request under the platform sandbox.
 *
 *  - full-access: pass-through, no wrapping.
 *  - backend unavailable (no bwrap / WSL1 / Windows): throws
 *    SandboxUnavailableError when config.required, otherwise resolves with
 *    `wrapped: false` so the caller can log the fallback.
 *  - seatbelt / bwrap: returns the wrapped command. */
export async function wrapSpawn(
  req: SandboxSpawnRequest,
  ctx: WrapContext,
): Promise<{ file: string; args: string[]; wrapped: boolean; detail: string }> {
  const { config, paths } = ctx;
  if (config.mode === 'full-access') {
    return { file: req.file, args: req.args, wrapped: false, detail: 'full-access mode' };
  }

  const platform = getPlatformSandbox();
  if (platform === 'seatbelt') {
    const cmd = wrapWithSeatbelt(req, config, paths);
    return { ...cmd, wrapped: true, detail: 'Seatbelt sandbox active' };
  }

  if (platform === 'bwrap') {
    if (isWsl1()) {
      return unavailable(
        config,
        req,
        'bubblewrap is not supported on WSL1 (no user namespaces); use WSL2',
      );
    }
    const probe = await detectBwrap();
    if (!probe.ok) return unavailable(config, req, `Linux sandbox unavailable: ${probe.detail}`);
    const args = buildBwrapArgs(config, paths, req.file, req.args);
    return { file: 'bwrap', args, wrapped: true, detail: 'bubblewrap sandbox active' };
  }

  // Windows (phase one): no OS-level sandbox yet — approval-only, per
  // plans/沙盒机制实现方案.md. Caller falls back to the raw spawn.
  return unavailable(config, req, `OS-level sandbox is not supported on ${process.platform}`);
}

/** Status for the renderer / logs. `config` comes from readSandboxConfig or
 *  DEFAULT_SANDBOX_CONFIG at the call site. */
export async function getSandboxStatus(config: SandboxConfig): Promise<SandboxStatus> {
  const platform = getPlatformSandbox();
  if (config.mode === 'full-access') {
    return { platform, config, effective: false, detail: 'full-access mode, sandbox disabled' };
  }
  if (platform === 'seatbelt') {
    return { platform, config, effective: true, detail: 'Seatbelt sandbox active' };
  }
  if (platform === 'bwrap') {
    const probe = await detectBwrap();
    return {
      platform,
      config,
      effective: probe.ok && !isWsl1(),
      detail: probe.ok ? 'bubblewrap sandbox available' : probe.detail,
    };
  }
  return {
    platform,
    config,
    effective: false,
    detail: `OS-level sandbox is not supported on ${process.platform}`,
  };
}
