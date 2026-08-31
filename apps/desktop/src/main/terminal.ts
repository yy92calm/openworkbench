import { createRequire } from 'node:module';
import { platform } from 'node:os';

import { BrowserWindow, ipcMain } from 'electron';

const require = createRequire(import.meta.url);
const pty = require('node-pty');

interface TerminalSession {
  pty: import('node-pty').IPty | null;
}

const sessions = new Map<string, TerminalSession>();

function getWin(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function send(win: BrowserWindow | null, channel: string, data: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function defaultShell(): string {
  if (platform() === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

function resolveShell(name: string): string {
  if (platform() !== 'win32') {
    switch (name) {
      case 'bash':
        return '/bin/bash';
      case 'zsh':
        return '/bin/zsh';
      default:
        return name;
    }
  }
  switch (name) {
    case 'pwsh':
    case 'powershell':
      return 'powershell.exe';
    case 'pwsh7':
      return 'pwsh.exe';
    default:
      return process.env.COMSPEC || 'cmd.exe';
  }
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(
    'terminal:create',
    (_e, id: string, _type: 'local' | 'ssh', shellName?: string) => {
      const shell = shellName ? resolveShell(shellName) : defaultShell();
      const cols = 80;
      const rows = 24;

      const ptyProc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.HOME || process.cwd(),
        env: Object.entries(process.env).reduce(
          (acc, [k, v]) => {
            if (v !== undefined) acc[k] = v;
            return acc;
          },
          { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } as Record<string, string>,
        ),
      });

      sessions.set(id, { pty: ptyProc });

      ptyProc.onData((data: string) => {
        send(getWin(), `terminal:data:${id}`, data);
      });

      ptyProc.onExit(({ exitCode }: { exitCode: number }) => {
        send(getWin(), `terminal:exit:${id}`, exitCode);
        sessions.delete(id);
      });

      return true;
    },
  );

  ipcMain.handle('terminal:write', (_e, id: string, data: string) => {
    const session = sessions.get(id);
    session?.pty?.write(data);
  });

  ipcMain.handle('terminal:resize', (_e, id: string, cols: number, rows: number) => {
    const session = sessions.get(id);
    try {
      session?.pty?.resize(Math.max(1, cols), Math.max(1, rows));
    } catch {
      /* ignore resize errors */
    }
  });

  ipcMain.handle('terminal:close', (_e, id: string) => {
    const session = sessions.get(id);
    if (session?.pty) {
      try {
        session.pty.kill();
      } catch {
        /* ignore */
      }
    }
    sessions.delete(id);
  });
}
