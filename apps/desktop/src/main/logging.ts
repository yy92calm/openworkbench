import { app } from 'electron';
import log from 'electron-log';

log.initialize();

log.transports.file.resolvePath = () => `${app.getPath('userData')}/logs/workbench.log`;

export function getLogger() {
  return log;
}

export async function exportDebugLogs(): Promise<string> {
  const fs = await import('node:fs');
  const path = log.transports.file.getFile().path;
  return fs.readFileSync(path, 'utf-8');
}
