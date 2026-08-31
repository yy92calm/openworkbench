/**
 * @fafawork/terminal - Electron embedded terminal plugin.
 *
 * Provides xterm.js-based terminal panels with PTY management (node-pty).
 * Zero internal dependencies - fully self-contained.
 *
 * Usage:
 *   import { createTerminal } from "@fafawork/terminal";
 *   const terminal = createTerminal();
 *   terminal.start();  // register IPC handlers
 *   terminal.stop();   // kill all sessions
 */

import { createRequire } from 'node:module';
import { platform } from 'node:os';

import { BrowserWindow, ipcMain } from 'electron';

const require = createRequire(import.meta.url);
const pty = require('node-pty');

// ── Types ────────────────────────────────────────────────────────────────

export interface TerminalPlugin {
  start(): void;
  stop(): void;
}

// ── State ────────────────────────────────────────────────────────────────

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
  if (platform() === 'win32') return process.env.COMSPEC || 'cmd.exe';
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

// ── IPC handlers ─────────────────────────────────────────────────────────

function registerIpc() {
  ipcMain.handle(
    'terminal:create',
    (_e, id: string, _type: 'local' | 'ssh', shellName?: string) => {
      const shell = shellName ? resolveShell(shellName) : defaultShell();
      const ptyProc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
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

      ptyProc.onData((data: string) => send(getWin(), `terminal:data:${id}`, data));
      ptyProc.onExit(({ exitCode }: { exitCode: number }) => {
        send(getWin(), `terminal:exit:${id}`, exitCode);
        sessions.delete(id);
      });
      return true;
    },
  );

  ipcMain.handle('terminal:write', (_e, id: string, data: string) => {
    sessions.get(id)?.pty?.write(data);
  });

  ipcMain.handle('terminal:resize', (_e, id: string, cols: number, rows: number) => {
    try {
      sessions.get(id)?.pty?.resize(Math.max(1, cols), Math.max(1, rows));
    } catch {
      /* */
    }
  });

  ipcMain.handle('terminal:close', (_e, id: string) => {
    try {
      sessions.get(id)?.pty?.kill();
    } catch {
      /* */
    }
    sessions.delete(id);
  });
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createTerminal(): TerminalPlugin {
  let started = false;
  return {
    start() {
      if (started) return;
      started = true;
      registerIpc();
    },
    stop() {
      for (const [, session] of sessions) {
        try {
          session.pty?.kill();
        } catch {
          /* */
        }
      }
      sessions.clear();
      started = false;
    },
  };
}
