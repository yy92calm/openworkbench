// Where the bundled OpenCode sidecar binary lives.
//
// In its own module so consumers that need only the path (the version probe)
// do not pull in server.ts and, transitively, scheduler.ts → logging.ts —
// which electron-log cannot initialize outside the real app.

import { join } from 'node:path';

import { app } from 'electron';

export function sidecarBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  if (app.isPackaged) {
    return join(process.resourcesPath, 'binaries', binaryName);
  }
  return join(app.getAppPath(), 'binaries', binaryName);
}
