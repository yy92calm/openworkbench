/**
 * Browser MCP plugin — main process module.
 *
 * Provides a self-contained browser automation service for Electron apps:
 * - HTTP API on localhost for the MCP server to call
 * - Direct webContents control of the embedded <webview>
 * - Recording / replay state
 * - Download interception
 * - MCP server config deployment
 *
 * Usage:
 *   import { createBrowserMcp } from "@workbench/browser-mcp";
 *   const browser = createBrowserMcp({ workspaceDir: "/path/to/ws" });
 *   browser.start();           // start HTTP API + IPC + download handler
 *   browser.deploy(xdgConfig); // write MCP config into opencode.json
 *   browser.stop();
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';

import { BrowserWindow, ipcMain, session, webContents } from 'electron';

// ── Types ────────────────────────────────────────────────────────────────

export interface BrowserMcpOptions {
  /** Workspace root for saving recordings / downloads */
  workspaceDir: () => string;
  /** HTTP API port (default 43921) */
  port?: number;
  /** Logger with .info / .warn / .error */
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
}

export interface BrowserMcpPlugin {
  start(): void;
  stop(): void;
  deploy(xdgConfig: string): void;
  /** Called from renderer when <webview> attaches — stores webContents ID */
  registerWebview(wcId: number): void;
}

// ── State ────────────────────────────────────────────────────────────────

interface RecordStep {
  method: string;
  path: string;
  body: unknown;
  ts: number;
}

let webviewWcId: number | null = null;
let isRecording = false;
let recordedSteps: RecordStep[] = [];
let lastRecording: RecordStep[] = [];
let lastDownload: { ok: true; path: string; size: number; filename: string } | null = null;

// ── sendBrowserCommand: direct webContents control ───────────────────────

function sendBrowserCommand(
  cmd: string,
  payload: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Browser command "${cmd}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const wc = webviewWcId !== null ? webContents.fromId(webviewWcId) : null;
    if (!wc || wc.isDestroyed()) {
      clearTimeout(timer);
      reject(new Error('Browser webview not attached'));
      return;
    }

    (async () => {
      try {
        let result: unknown;
        switch (cmd) {
          case 'navigate':
            await wc.loadURL(payload.url as string);
            result = { ok: true };
            break;
          case 'back':
            wc.goBack();
            result = { ok: true };
            break;
          case 'forward':
            wc.goForward();
            result = { ok: true };
            break;
          case 'refresh':
            wc.reload();
            result = { ok: true };
            break;
          case 'execute-js':
            result = await wc.executeJavaScript(payload.code as string);
            break;
          case 'get-content': {
            const text = await wc.executeJavaScript("document.body?.innerText ?? ''");
            const title = await wc.executeJavaScript("document.title ?? ''");
            result = title ? `标题: ${title}\n\n${text}` : text;
            break;
          }
          case 'get-html':
            result = await wc.executeJavaScript("document.documentElement?.outerHTML ?? ''");
            break;
          case 'get-url':
            result = wc.getURL();
            break;
          case 'get-title':
            result = wc.getTitle();
            break;
          case 'click':
            result = await wc.executeJavaScript(`
              (() => {
                const el = document.querySelector(${JSON.stringify(payload.selector)});
                if (!el) return { error: "Element not found" };
                if (el instanceof HTMLElement) el.click();
                return { ok: true };
              })()`);
            break;
          case 'click-at':
            result = await wc.executeJavaScript(`
              (() => {
                const el = document.elementFromPoint(${payload.x}, ${payload.y});
                if (el && el instanceof HTMLElement) { el.click(); return { ok: true, tag: el.tagName }; }
                return { error: "No element" };
              })()`);
            break;
          case 'type-selector':
            result = await wc.executeJavaScript(`
              (() => {
                const el = document.querySelector(${JSON.stringify(payload.selector)});
                if (!el) return { error: "Element not found" };
                if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                  el.value = ${JSON.stringify(payload.text)};
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return { ok: true };
                }
                return { error: "Not an input" };
              })()`);
            break;
          case 'select':
            result = await wc.executeJavaScript(`
              (() => {
                const el = document.querySelector(${JSON.stringify(payload.selector)});
                if (!el || !(el instanceof HTMLSelectElement)) return { error: "Not a select" };
                el.value = ${JSON.stringify(payload.value)};
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true };
              })()`);
            break;
          case 'hover':
            result = await wc.executeJavaScript(`
              (() => {
                const el = document.querySelector(${JSON.stringify(payload.selector)});
                if (!el || !(el instanceof HTMLElement)) return { error: "Element not found" };
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                return { ok: true };
              })()`);
            break;
          case 'scroll':
            await wc.executeJavaScript(
              `window.scrollBy({ top: ${payload.y ?? 0}, left: ${payload.x ?? 0}, behavior: 'smooth' });`,
            );
            result = { ok: true };
            break;
          case 'screenshot': {
            const image = await wc.capturePage();
            result = image.toDataURL();
            break;
          }
          default:
            throw new Error(`Unknown command: ${cmd}`);
        }
        clearTimeout(timer);
        resolve(result);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })();
  });
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createBrowserMcp(opts: BrowserMcpOptions): BrowserMcpPlugin {
  const port = opts.port ?? 43921;
  const log = opts.logger ?? console;
  let server: import('node:http').Server | null = null;

  // ── Panel IPC (renderer listens for open/close) ────────────────────────

  function sendToPanel(action: 'open' | 'close', url?: string) {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('browser:panel', { action, url });
  }

  // ── IPC handlers ───────────────────────────────────────────────────────

  function registerIpc() {
    // Webview registration (called from renderer when <webview> attaches)
    ipcMain.handle('browser:setup-webview', (_e, wcId: number) => {
      webviewWcId = wcId;
      const wc = webContents.fromId(wcId);
      if (!wc || wc.isDestroyed()) return;
      wc.setWindowOpenHandler(({ url }) => {
        wc.loadURL(url);
        return { action: 'deny' as const };
      });
    });

    // Recording control
    ipcMain.handle('browser:record-start', () => {
      isRecording = true;
      recordedSteps = [];
      return { ok: true };
    });
    ipcMain.handle('browser:record-stop', () => {
      isRecording = false;
      lastRecording = [...recordedSteps];
      return { ok: true, count: recordedSteps.length };
    });
    ipcMain.handle('browser:record-state', () => ({
      isRecording,
      count: recordedSteps.length,
    }));

    // Save last recording to workspace
    ipcMain.handle('browser:record-save', (_e, name: string, description?: string) => {
      if (lastRecording.length === 0) return { ok: false, error: '没有可保存的录制' };
      const dir = join(opts.workspaceDir(), 'browser-recordings');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${name}.json`),
        JSON.stringify(
          {
            name,
            description: description ?? '',
            steps: lastRecording,
            created: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      return { ok: true, count: lastRecording.length };
    });

    // List saved recordings
    ipcMain.handle('browser:record-list', () => {
      const dir = join(opts.workspaceDir(), 'browser-recordings');
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            const d = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
            return {
              name: d.name,
              steps: d.steps?.length ?? 0,
              created: d.created ?? '',
              description: d.description ?? '',
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    });

    // Replay a named recording
    ipcMain.handle('browser:record-replay', async (_e, name: string, delay = 500) => {
      const dir = join(opts.workspaceDir(), 'browser-recordings');
      const filePath = join(dir, `${name}.json`);
      if (!existsSync(filePath)) return { ok: false, error: `录制 "${name}" 不存在` };
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      const steps: RecordStep[] = data.steps ?? [];
      const results: string[] = [];
      const cmdMap: Record<string, string> = {
        navigate: 'navigate',
        click: 'click',
        'click-at': 'click-at',
        type: 'type-selector',
        select: 'select',
        hover: 'hover',
        scroll: 'scroll',
        'execute-js': 'execute-js',
        screenshot: 'screenshot',
        'get-content': 'get-content',
        'get-html': 'get-html',
        back: 'back',
        forward: 'forward',
        refresh: 'refresh',
      };
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        try {
          const cmd = step.path.replace('/browser/', '');
          await sendBrowserCommand(
            cmdMap[cmd] ?? cmd,
            (step.body as Record<string, unknown>) ?? {},
          );
          results.push(`${i + 1}. ${step.path} — 成功`);
        } catch (err) {
          results.push(
            `${i + 1}. ${step.path} — 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (i < steps.length - 1 && delay > 0) await new Promise((r) => setTimeout(r, delay));
      }
      return { ok: true, count: steps.length, results };
    });
  }

  // ── HTTP API ───────────────────────────────────────────────────────────

  function startHttpApi() {
    server = http.createServer(async (req: any, res: any) => {
      const sendJson = (data: unknown, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const readBody = (): Promise<unknown> =>
        new Promise((resolve) => {
          let body = '';
          req.on('data', (c: string) => (body += c));
          req.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve({});
            }
          });
        });

      const parsedBody = req.method === 'POST' ? await readBody() : {};

      // Prepare recording step (only added to list on success)
      const shouldRecord =
        isRecording &&
        req.url?.startsWith('/browser/') &&
        !req.url.startsWith('/browser/record') &&
        !req.url.startsWith('/browser/panel');
      const pendingStep: RecordStep | null = shouldRecord
        ? { method: req.method, path: req.url!, body: parsedBody, ts: Date.now() }
        : null;

      try {
        // Panel control
        if (req.method === 'POST' && req.url === '/browser/panel') {
          const { action, url } = parsedBody as { action: 'open' | 'close'; url?: string };
          sendToPanel(action, url);
          sendJson({ ok: true });
          return;
        }
        // Record endpoints
        if (req.method === 'POST' && req.url === '/browser/record/start') {
          isRecording = true;
          recordedSteps = [];
          sendJson({ ok: true });
          return;
        }
        if (req.method === 'POST' && req.url === '/browser/record/stop') {
          isRecording = false;
          lastRecording = [...recordedSteps];
          sendJson({ ok: true, count: recordedSteps.length });
          return;
        }
        if (req.method === 'GET' && req.url === '/browser/record/state') {
          sendJson({ isRecording, count: recordedSteps.length });
          return;
        }
        if (req.method === 'GET' && req.url === '/browser/record/steps') {
          sendJson(lastRecording);
          return;
        }
        // Download
        if (req.method === 'POST' && req.url === '/browser/download') {
          const { url } = parsedBody as { url?: string };
          if (url) {
            const dir = join(opts.workspaceDir(), 'downloads');
            mkdirSync(dir, { recursive: true });
            const filename = url.split('/').pop()?.split('?')[0] || `download-${Date.now()}`;
            const savePath = join(dir, filename);
            // 延迟加载：fetch 模块较重，仅在首次下载请求时加载（启动路径保持轻量）。
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { fetchPageContent } = require('./fetch');
            const html = await fetchPageContent(url);
            writeFileSync(savePath, html, 'utf-8');
            const stat = statSync(savePath);
            sendJson({ ok: true, path: `downloads/${filename}`, size: stat.size });
          } else {
            sendJson(lastDownload ?? { error: '暂无下载' });
          }
          return;
        }
        // All other commands → sendBrowserCommand
        const cmd = req.url?.replace('/browser/', '').replace(/-/g, '-') ?? '';
        const cmdMap: Record<string, string> = {
          navigate: 'navigate',
          'execute-js': 'execute-js',
          content: 'get-content',
          html: 'get-html',
          url: 'get-url',
          title: 'get-title',
          click: 'click',
          'click-at': 'click-at',
          type: 'type-selector',
          select: 'select',
          hover: 'hover',
          scroll: 'scroll',
          screenshot: 'screenshot',
          back: 'back',
          forward: 'forward',
          refresh: 'refresh',
        };
        const mapped = cmdMap[cmd];
        if (mapped) {
          const result = await sendBrowserCommand(mapped, parsedBody as Record<string, unknown>);
          if (pendingStep) recordedSteps.push(pendingStep);
          sendJson(result);
        } else {
          sendJson({ error: 'not found' }, 404);
        }
      } catch (err) {
        sendJson({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      log.info(`[browser-mcp] HTTP API listening on 127.0.0.1:${port}`);
    });
  }

  // ── Download interception ──────────────────────────────────────────────

  function setupDownloadHandler() {
    session.defaultSession.on('will-download', (_event, item) => {
      const dir = join(opts.workspaceDir(), 'downloads');
      mkdirSync(dir, { recursive: true });
      const filename = item.getFilename() || `download-${Date.now()}`;
      const savePath = join(dir, filename);
      item.setSavePath(savePath);
      item.once('done', () => {
        try {
          const stat = statSync(savePath);
          lastDownload = { ok: true, path: `downloads/${filename}`, size: stat.size, filename };
        } catch {
          /* ignore */
        }
      });
    });
  }

  // ── Deploy MCP config ──────────────────────────────────────────────────

  function deploy(xdgConfig: string) {
    const opencodeDir = join(xdgConfig, 'opencode');
    const configPath = join(opencodeDir, 'opencode.json');
    mkdirSync(opencodeDir, { recursive: true });
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      /* fresh */
    }

    // __dirname is inside app.asar when packaged; the MCP server is deployed
    // as an extraResource outside asar — strip the asar path segment.
    let scriptPath = join(__dirname, 'browser-mcp-server.mjs');
    if (scriptPath.includes('app.asar')) {
      scriptPath = scriptPath.replace(/app\.asar\/?/, '');
    }

    const mcp = (config.mcp ?? {}) as Record<string, unknown>;
    mcp['browser'] = { type: 'local', command: ['node', scriptPath], enabled: true };
    config.mcp = mcp;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  let started = false;

  return {
    start() {
      if (started) return;
      started = true;
      registerIpc();
      setupDownloadHandler();
      startHttpApi();
    },
    stop() {
      server?.close();
      started = false;
    },
    deploy,
    registerWebview(wcId: number) {
      webviewWcId = wcId;
    },
  };
}
