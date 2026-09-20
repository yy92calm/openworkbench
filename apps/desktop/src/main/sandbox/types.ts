// Sandbox policy model shared by the seatbelt / bwrap wrappers and the
// spawn-time integration points (sidecar + kernel). Pure types and defaults.
//
// The renderer-facing DTOs (config / platform / status) live in
// @workbench/shared — one source of truth for the main process, the preload
// bridge and the renderer status bar — and are re-exported here so sandbox
// modules import everything from './types'.

export type {
  SandboxConfig,
  SandboxMode,
  SandboxNetwork,
  SandboxPlatform,
  SandboxStatus,
} from '@workbench/shared';

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode: 'workspace-write',
  network: 'open',
  required: false,
};

/** A spawn request the caller wants executed under the platform sandbox. */
export interface SandboxSpawnRequest {
  file: string;
  args: string[];
  cwd: string;
}

/** Filesystem inputs the sandbox policy is rendered from. */
export interface SandboxPaths {
  /** The active agent workspace (policy target of the mode levels). */
  workspace: string;
  /** Application dirs the sandboxed process must be able to write
   *  (XDG redirects, session storage, etc). Temp dirs are added implicitly. */
  writableRoots: string[];
  /** Temp dir for profile files and process scratch space. */
  tmpDir: string;
}

/** The spawn command after sandbox wrapping (or pass-through). */
export interface SandboxedCommand {
  file: string;
  args: string[];
  /** false = the sandbox could not be applied and the command runs direct. */
  wrapped: boolean;
  /** Human-readable explanation for logs / UI status. */
  detail: string;
}

/** Thrown when the sandbox is required but cannot be applied. */
export class SandboxUnavailableError extends Error {}
