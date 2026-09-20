// Sandbox runtime status — the main-process DTO shared with the renderer.
// The main process owns the enforcement backends (src/main/sandbox/); the
// renderer only consumes this status shape for the runtime status bar.

/** Filesystem restriction level (semantics mirror Codex's sandbox presets). */
export type SandboxMode = 'read-only' | 'workspace-write' | 'full-access';

/** Network restriction level. */
export type SandboxNetwork = 'open' | 'loopback-only';

/** OS enforcement backend selected for the current platform. */
export type SandboxPlatform = 'seatbelt' | 'bwrap' | 'unsupported';

export interface SandboxConfig {
  mode: SandboxMode;
  network: SandboxNetwork;
  /** When true, an unavailable sandbox blocks the runtime instead of falling
   *  back to an unsandboxed spawn. */
  required: boolean;
}

/** Runtime status surfaced to the renderer via IPC. */
export interface SandboxStatus {
  platform: SandboxPlatform;
  config: SandboxConfig;
  /** Whether the sandbox is actually enforced (false for full-access too). */
  effective: boolean;
  /** Human-readable explanation for the status bar tooltip. */
  detail: string;
}
