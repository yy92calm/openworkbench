import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  type AgentHistoryMessage,
  type AgentRuntime,
  type AgentRuntimeEvent,
  createAgentRuntime,
} from '@workbench/sdk/agent-runtime';
import {
  buildMacroPrompt,
  type MacroBoard,
  type MacroReportMeta,
  macroTheme,
  type MacroThemeId,
  type ResearchOutcome,
  type ResearchStance,
} from '@workbench/shared';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import * as artifactFile from './artifact_file';
import { extractText, fetchPageContent } from './browser';
import { APP_IDS, CHANNEL } from './constants';
import * as kernel from './kernel';
import { exportDebugLogs, getLogger } from './logging';
import { macroStore } from './macro';
import { listNotifications, markRead, pushBriefing } from './macroNotify';
import { previewUrl } from './preview_server';
import {
  explainConfig,
  readDeployedManifest,
  readInteractionConfig,
  validateUserPatch,
  writeUserPatchChecked,
} from './profilePatch';
import * as provenance from './provenance';
import { RelayHost, type RelayHostConfig } from './relayHost';
import {
  addDecision,
  attributeDecision,
  deleteDecision,
  exportDecisionsCsv,
  exportMacroReport,
  getResearchContext,
  listDecisions,
  listMacroReports,
  readKnowledgeDigest,
  readMacroReport,
  saveMacroReport,
  updateDecision,
} from './research';
import { roomPeer } from './roomPeer';
import { getSandboxStatus } from './sandbox/manager';
import {
  type CreateTaskInput,
  cronEngine,
  defaultMacroTask,
  type UpdateTaskInput,
} from './scheduler';
import {
  type AgentRuntimeKind,
  baseWorkspaceDir,
  deployedProfileDir,
  effectiveSandboxConfig,
  getServerPassword,
  getServerUrl,
  setActiveWorkspace,
  setBaseWorkspace,
  startAgentRuntime,
  stopSidecar,
  workspaceDir,
} from './server';
import { detectShells, detectTools, enrichedPath } from './shell_env';
import * as snapshot from './snapshot';
import { getStore } from './store';
import { registerTerminalHandlers } from './terminal';
import { checkForUpdates } from './updater';
import { isWhisperAvailable, transcribeWav } from './whisper';
import { getMainWindow } from './windows';

/** Host-side relay instance (shared by IPC handlers). */
export const relayHost = new RelayHost();

/** Push a payload to every renderer window (macro snapshot / notifications). */
function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

/**
 * One message's own text (runtime-generated markers like the "tool executed"
 * note are not part of the answer).
 */
function messageText(message: AgentHistoryMessage): string {
  return message.parts
    .filter((p) => p.type === 'text' && !p.synthetic)
    .map((p) => (p.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Save the finished macro session's final answer as a workspace report and
 * tell the renderers. Runs in the background task path, so failures only log —
 * the briefing notification still goes out either way.
 */
async function captureMacroReport(
  client: AgentRuntime,
  themeId: MacroThemeId,
  sessionId: string,
): Promise<MacroReportMeta | null> {
  try {
    const messages = await client.getMessages(sessionId);
    const answers = messages
      .filter((m) => m.role === 'assistant')
      .map(messageText)
      .filter(Boolean);
    const markdown = answers[answers.length - 1];
    if (!markdown) return null;
    const meta = saveMacroReport({ themeId, sessionId, markdown });
    if (meta) broadcast('macro-reports-updated');
    return meta;
  } catch (err) {
    getLogger().warn(
      `[macro] report capture failed for ${themeId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export function registerIpcHandlers(): void {
  const log = getLogger();

  // ---- Channel ----
  ipcMain.handle('channel-name', () => CHANNEL);
  ipcMain.handle('app-identifier', () => APP_IDS[CHANNEL]);
  ipcMain.handle('app-version', () => app.getVersion());

  // ---- Runtime (sidecar) ----
  // `kind` selects the engine: "opencode" (default) spawns the opencode serve
  // sidecar; "claude-code" deploys the .claude profile and runs the Agent SDK
  // in-process (no sidecar URL). The renderer reads the user's choice from the
  // UI store and passes it here.
  ipcMain.handle('start-runtime', async (_e, kind?: AgentRuntimeKind) => {
    const runtimeKind: AgentRuntimeKind = kind === 'claude-code' ? 'claude-code' : 'opencode';
    try {
      const result = await startAgentRuntime(runtimeKind);
      log.info(`[server] agent runtime started: ${result.kind} url=${result.url ?? 'null'}`);

      // For opencode: the cron engine needs a client connected to the sidecar.
      // For claude-code: cron is opencode-only for now (no long-running sidecar
      // to attach to); a future claude-code cron path would use a
      // ClaudeCodeAdapter in the main process.
      if (result.kind === 'opencode' && result.url) {
        const password = getServerPassword();
        const directory = workspaceDir();
        const client: AgentRuntime = await createAgentRuntime({
          kind: 'opencode',
          baseUrl: result.url,
          password: password,
          directory: directory ?? undefined,
        });
        // The sidecar may need a moment to finish internal initialization
        // (e.g. models.dev fetch). Retry the event-stream connection a few
        // times before giving up.
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await client.connect();
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            log.warn(
              `[server] client.connect attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            if (attempt < 4) await new Promise((r) => setTimeout(r, 1000));
          }
        }
        if (lastErr) throw lastErr;
        cronEngine.setFireCallback(async (task) => {
          // Macro insight tasks rebuild their prompt from the live snapshot so
          // each run analyses today's data, not the data from creation time.
          // The refresh falls back to the last known snapshot on network failure.
          let prompt = task.prompt;
          if (task.macroTheme) {
            const snapshot = await macroStore.refreshAndWait();
            const built = buildMacroPrompt(task.macroTheme, snapshot, getResearchContext());
            if (built) prompt = built;
          }
          const sessionId = await client.createSession();
          const idlePromise = new Promise<void>((resolve) => {
            const unsubscribe = client.onEvent((event: AgentRuntimeEvent) => {
              if (event.type === 'session.idle' && event.sessionId === sessionId) {
                unsubscribe();
                resolve();
              }
            });
            setTimeout(
              () => {
                unsubscribe();
                resolve();
              },
              10 * 60 * 1000,
            );
          });
          await client.sendPrompt(sessionId, prompt);
          await idlePromise;
          if (task.macroTheme) {
            // Persist the report first: the page lists it and the briefing
            // notification points back at the session it was generated in.
            const saved = await captureMacroReport(client, task.macroTheme, sessionId);
            const theme = macroTheme(task.macroTheme);
            const notification = pushBriefing({
              themeId: task.macroTheme,
              sessionId,
              title: `${theme?.title ?? '宏观洞察'} · ${saved ? '报告已生成' : '简报已生成'}`,
            });
            broadcast('macro-notification', notification);
          }
          return sessionId;
        });
        cronEngine.start();
      }
      return result.url;
    } catch (err) {
      log.error(
        `[server] start-runtime failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  });
  ipcMain.handle('runtime-password', () => getServerPassword());
  ipcMain.handle('stop-runtime', () => stopSidecar());
  ipcMain.handle('server-url', () => getServerUrl());

  // ---- Remote relay (host side) ----
  // Config is persisted in the electron-store under "relay". deviceId and token
  // are generated once on first use; the token never leaves the main process
  // in status responses.
  ipcMain.handle('relay-status', () => {
    const store = getStore();
    const cfg = store.get('relay') as Partial<RelayHostConfig> | undefined;
    return {
      status: relayHost.getStatus(),
      config: {
        enabled: !!cfg?.enabled,
        relayUrl: cfg?.relayUrl ?? 'ws://43.133.82.137:8080',
        deviceId: cfg?.deviceId ?? '',
        tokenSet: !!cfg?.token,
        keepAwake: !!cfg?.keepAwake,
      },
    };
  });
  ipcMain.handle('relay-start', (_e, input: RelayHostConfig) => {
    const store = getStore();
    const existing = store.get('relay') as Partial<RelayHostConfig> | undefined;
    const cfg: RelayHostConfig = {
      enabled: true,
      relayUrl: input.relayUrl?.trim() || existing?.relayUrl || 'ws://43.133.82.137:8080',
      deviceId: input.deviceId?.trim() || existing?.deviceId || randomUUID(),
      token: input.token?.trim() || existing?.token || randomUUID(),
      keepAwake: !!input.keepAwake,
    };
    store.set('relay', cfg);
    return relayHost.start(cfg);
  });
  ipcMain.handle('relay-set-keep-awake', (_e, on: boolean) => {
    const store = getStore();
    const cfg = store.get('relay') as Partial<RelayHostConfig> | undefined;
    if (cfg) store.set('relay', { ...cfg, keepAwake: !!on });
    relayHost.setKeepAwake(!!on);
  });
  ipcMain.handle('relay-stop', () => {
    const store = getStore();
    const cfg = store.get('relay') as Partial<RelayHostConfig> | undefined;
    if (cfg) store.set('relay', { ...cfg, enabled: false });
    relayHost.stop();
    return 'off';
  });
  relayHost.onStatusChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('relay-status-changed', status);
    }
  });
  ipcMain.handle('relay-remote-sessions', () => relayHost.getRemoteSessionIds());
  relayHost.onRemoteSessionsChange(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('relay-remote-sessions-changed');
    }
  });

  // ---- Room (peer chat) ----
  ipcMain.handle('room-create', async () => {
    return { inviteCode: await roomPeer.createRoom() };
  });
  ipcMain.handle('room-validate', async (_e, code: string) => {
    return roomPeer.validateInvite(code);
  });
  ipcMain.handle(
    'room-join',
    (_e, inviteCode: string, nickname: string, opts?: { enforceViewOnce?: boolean }) => {
      roomPeer.join(inviteCode, nickname, opts);
      return true;
    },
  );
  ipcMain.handle('room-leave', () => {
    roomPeer.stop();
    return true;
  });
  ipcMain.handle('room-send', (_e, text: string, viewOnce: boolean) => {
    return roomPeer.sendMessage(text, { viewOnce });
  });
  ipcMain.handle(
    'room-send-file',
    (
      _e,
      fileId: string,
      kind: 'audio' | 'file',
      meta: {
        filename?: string;
        size?: number;
        mime?: string;
        duration?: number;
      },
      viewOnce: boolean,
    ) => {
      return roomPeer.sendFileMessage(fileId, kind, meta, { viewOnce });
    },
  );
  ipcMain.handle(
    'room-upload-file',
    async (
      _e,
      filePath: string,
      meta: {
        filename?: string;
        mime?: string;
        duration?: number;
      },
    ) => {
      return { fileId: await roomPeer.uploadFile(filePath, meta) };
    },
  );
  ipcMain.handle(
    'room-upload-blob',
    async (
      _e,
      base64Data: string,
      meta: {
        filename?: string;
        mime?: string;
        duration?: number;
      },
    ) => {
      return { fileId: await roomPeer.uploadBlob(base64Data, meta) };
    },
  );
  ipcMain.handle('room-download-file', async (_e, fileId: string, filename?: string) => {
    const tempPath = await roomPeer.downloadFile(fileId, filename);
    // Offer a save dialog so the user picks the final location.
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return { path: tempPath, saved: false };
    const defaultName = filename ?? fileId;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      title: '保存文件',
    });
    if (result.canceled || !result.filePath) {
      return { path: tempPath, saved: false };
    }
    const { copyFile, rm } = await import('node:fs/promises');
    await copyFile(tempPath, result.filePath);
    // Clean up the temp copy.
    await rm(tempPath, { force: true });
    return { path: result.filePath, saved: true };
  });
  // Pick a file to send via OS dialog. Returns basic metadata.
  ipcMain.handle('room-pick-file', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: '选择要发送的文件',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const { stat } = await import('node:fs/promises');
    const s = await stat(filePath);
    const name = filePath.split(/[/\\]/).pop() ?? filePath;
    // crude mime guess by extension
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      zip: 'application/zip',
      txt: 'text/plain',
      md: 'text/markdown',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      mp4: 'video/mp4',
      webm: 'video/webm',
    };
    return {
      path: filePath,
      name,
      size: s.size,
      mime: mimeMap[ext] ?? 'application/octet-stream',
    };
  });
  // Open a save dialog for a downloaded room file.
  ipcMain.handle('room-save-dialog', async (_e, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      title: '保存文件',
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('room-viewed', (_e, messageId: string) => {
    roomPeer.replyViewed(messageId);
    return true;
  });
  ipcMain.handle('room-set-view-once', (_e, enforce: boolean) => {
    roomPeer.roomSetViewOnce(enforce);
    return true;
  });
  ipcMain.handle(
    'room-send-session-share',
    (_e, payload: { title: string; sessionId: string; summary: string }, viewOnce?: boolean) => {
      return roomPeer.sendSessionShare(payload, { viewOnce });
    },
  );
  ipcMain.handle('room-status', () => {
    return {
      status: roomPeer.getStatus(),
      inviteCode: roomPeer.getInviteCode(),
      myMemberId: roomPeer.getMyMemberId(),
      members: roomPeer.getMembers(),
    };
  });
  // Forward room events to all renderer windows.
  roomPeer.onEvent((e) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('room-event', e);
    }
  });

  // Restart: stop the sidecar then start it again (picks up new provider config).
  ipcMain.handle('restart-runtime', async (_e, kind?: AgentRuntimeKind) => {
    stopSidecar();
    const runtimeKind: AgentRuntimeKind = kind === 'claude-code' ? 'claude-code' : 'opencode';
    const result = await startAgentRuntime(runtimeKind);
    return result.url;
  });

  // Sandbox status for the runtime UI (platform, effective mode/detail).
  ipcMain.handle('sandbox-status', async () => {
    return getSandboxStatus(effectiveSandboxConfig());
  });

  // ---- Workspace ----
  ipcMain.handle('workspace-path', () => workspaceDir());
  ipcMain.handle('workspace-base', () => baseWorkspaceDir());
  ipcMain.handle('set-workspace-base', (_e, path: string) => {
    setBaseWorkspace(path);
    return baseWorkspaceDir();
  });
  ipcMain.handle('set-workspace', (_e, path: string) => {
    setActiveWorkspace(path);
    return workspaceDir();
  });
  ipcMain.handle('new-dated-workspace', (_e, name: string) => {
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error('invalid folder name');
    }
    const dir = join(baseWorkspaceDir(), name);
    setActiveWorkspace(dir);
    return dir;
  });
  ipcMain.handle('open-workspace-base', () => {
    shell.openPath(baseWorkspaceDir());
  });
  ipcMain.handle('pick-folder', async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ---- Artifact / File ----
  ipcMain.handle('read-artifact', (_e, path: string, root?: string) =>
    artifactFile.readArtifact(path, root),
  );
  ipcMain.handle('open-path', (_e, rel: string, root?: string) => artifactFile.openPath(rel, root));
  ipcMain.handle('resolve-artifact', (_e, rel: string, root?: string) =>
    artifactFile.resolveArtifact(rel, root),
  );
  ipcMain.handle('save-text-file', (_e, filename: string, content: string) =>
    artifactFile.saveTextFile(filename, content),
  );
  ipcMain.handle('open-url', (_e, url: string) => artifactFile.openUrl(url));
  ipcMain.handle('add-files-to-workspace', async () => {
    const win = getMainWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const names: string[] = [];
    for (const fp of result.filePaths) {
      const fs = await import('node:fs');
      const content = fs.readFileSync(fp, 'utf-8');
      const name = basename(fp);
      artifactFile.addTextToWorkspace(name, content);
      names.push(name);
    }
    return names;
  });
  ipcMain.handle('add-text-to-workspace', (_e, filename: string, content: string) =>
    artifactFile.addTextToWorkspace(filename, content),
  );
  ipcMain.handle('list-notebooks', (_e, root?: string) => artifactFile.listNotebooks(root));
  ipcMain.handle('list-dir', (_e, rel: string, root?: string) => artifactFile.listDir(rel, root));
  ipcMain.handle('write-workspace-file', (_e, rel: string, content: string, root?: string) =>
    artifactFile.writeWorkspaceFile(rel, content, root),
  );

  // ---- Kernel ----
  ipcMain.handle('kernel-execute', (_e, code: string, language: string, notebook?: string) =>
    kernel.kernelExecute(code, language, notebook),
  );
  ipcMain.handle('kernel-reset', (_e, language: string, notebook?: string) =>
    kernel.kernelReset(language, notebook),
  );

  // ---- Provenance ----
  ipcMain.handle(
    'record-provenance',
    (
      _e,
      sessionId: string,
      callId: string,
      tool: string,
      input: unknown,
      output: unknown,
      model: string | null,
    ) => provenance.recordProvenance(sessionId, callId, tool, input, output, model),
  );
  ipcMain.handle('list-provenance', (_e, path: string) => provenance.listProvenance(path));
  ipcMain.handle('read-env-lockfile', (_e, hash: string) => provenance.readEnvLockfile(hash));

  // ---- Compaction audit snapshots ----
  ipcMain.handle('write-compaction-snapshot', (_e, payload: snapshot.CompactionSnapshot) =>
    snapshot.writeCompactionSnapshot(workspaceDir(), payload),
  );

  // ---- Preview ----
  ipcMain.handle('preview-url', (_e, rel: string, root?: string) => previewUrl(rel, root));

  // ---- Tools ----
  ipcMain.handle('detect-tools', async () => {
    const tools = await detectTools();
    return tools.map((t) => ({
      name: t.name,
      found: t.path !== null,
      version: t.version,
    }));
  });

  // ---- Shell ----
  ipcMain.handle('shell-path', () => enrichedPath());
  ipcMain.handle('shell-info', () => detectShells());

  // ---- Store ----
  ipcMain.handle('store-get', (_e, key: string, scope?: string) => {
    const store = getStore(scope);
    return store.get(key);
  });
  ipcMain.handle('store-set', (_e, key: string, value: unknown, scope?: string) => {
    const store = getStore(scope);
    store.set(key, value);
  });
  ipcMain.handle('store-delete', (_e, key: string, scope?: string) => {
    const store = getStore(scope);
    store.delete(key);
  });
  ipcMain.handle('store-clear', (_e, scope?: string) => {
    const store = getStore(scope);
    store.clear();
  });
  ipcMain.handle('store-keys', (_e, scope?: string) => {
    const store = getStore(scope);
    return Object.keys(store.store);
  });
  ipcMain.handle('store-length', (_e, scope?: string) => {
    const store = getStore(scope);
    return Object.keys(store.store).length;
  });

  // ---- Profile patch overlay ----
  ipcMain.handle('profile-manifest', () => readDeployedManifest());
  ipcMain.handle('profile-interaction', () => readInteractionConfig(deployedProfileDir()));
  ipcMain.handle('profile-explain-config', () => explainConfig(deployedProfileDir()));
  ipcMain.handle('profile-validate-patch', (_e, raw: string) => {
    const file = join(deployedProfileDir(), 'opencode.json');
    const base = existsSync(file) ? readFileSync(file, 'utf-8') : '{}';
    return validateUserPatch(base, raw);
  });
  ipcMain.handle('profile-write-patch', (_e, raw: string, expectedBaseHash?: string) =>
    writeUserPatchChecked(deployedProfileDir(), raw, expectedBaseHash),
  );

  // ---- Logging ----
  ipcMain.handle('log-debug', (_e, message: string) => {
    log.info(`[renderer] ${message}`);
  });
  ipcMain.handle(
    'log-event',
    (_e, level: string, module: string, message: string, data?: unknown) => {
      const lvl =
        level.toLowerCase() === 'warn'
          ? 'warn'
          : level.toLowerCase() === 'error'
            ? 'error'
            : level.toLowerCase() === 'debug'
              ? 'debug'
              : 'info';
      const meta = data ? ` ${JSON.stringify(data)}` : '';
      log[lvl](`[${module}] ${message}${meta}`);
    },
  );
  ipcMain.handle('export-logs', async () => exportDebugLogs());

  // ---- Updater ----
  ipcMain.handle('check-for-updates', async (_e, alertOnUpToDate: boolean) => {
    await checkForUpdates(alertOnUpToDate);
  });

  // ---- Scheduler ----
  ipcMain.handle('scheduler:list', () => cronEngine.listTasks());
  ipcMain.handle('scheduler:create', (_e, task: CreateTaskInput) => cronEngine.addTask(task));
  ipcMain.handle('scheduler:update', (_e, id: string, patch: UpdateTaskInput) =>
    cronEngine.updateTask(id, patch),
  );
  ipcMain.handle('scheduler:delete', (_e, id: string) => cronEngine.removeTask(id));
  ipcMain.handle('scheduler:toggle', (_e, id: string, enabled: boolean) =>
    cronEngine.toggleTask(id, enabled),
  );
  ipcMain.handle('scheduler:fire-now', (_e, id: string) => cronEngine.fireNow(id));
  ipcMain.handle('scheduler:history', (_e, taskId?: string, limit?: number) =>
    cronEngine.getHistory(taskId, limit),
  );
  ipcMain.handle('scheduler:delete-execution', (_e, id: string) => cronEngine.deleteExecution(id));
  ipcMain.handle('scheduler:clear-history', (_e, taskId?: string) =>
    cronEngine.clearHistory(taskId),
  );

  // ---- Macro insights (宏观洞察) ----
  // The renderer reads the cached snapshot (microseconds) and never waits on
  // the network; refreshes run in the background and push updates below.
  ipcMain.handle('macro-dashboard', (_e, opts?: { force?: boolean }) => {
    if (opts?.force) void macroStore.refresh(true);
    else macroStore.refreshIfStale();
    return macroStore.getSnapshot();
  });
  ipcMain.handle('macro-series', (_e, secid: string, days?: number) =>
    macroStore.getSeries(secid, days),
  );
  ipcMain.handle('macro-notifications', () => listNotifications());
  ipcMain.handle('macro-notifications-read', (_e, id?: string) => markRead(id));
  // Industry model: on-demand board detail (constituent valuation + history).
  ipcMain.handle('macro-industry', (_e, board: MacroBoard) => macroStore.getIndustry(board));
  // Research loop: decision ledger + knowledge asset digest.
  ipcMain.handle('research-decisions', () => listDecisions());
  ipcMain.handle(
    'research-add-decision',
    (
      _e,
      input: {
        model: 'rotation' | 'industry';
        target: string;
        stance: 'overweight' | 'neutral' | 'underweight' | 'watch';
        thesis: string;
        sessionId?: string;
      },
    ) => addDecision(input),
  );
  ipcMain.handle('research-attribute', (_e, id: string, outcome: ResearchOutcome, note: string) =>
    attributeDecision(id, outcome, note),
  );
  ipcMain.handle(
    'research-update-decision',
    (_e, id: string, patch: { target?: string; stance?: ResearchStance; thesis?: string }) =>
      updateDecision(id, patch),
  );
  ipcMain.handle('research-delete-decision', (_e, id: string) => deleteDecision(id));
  ipcMain.handle('research-export', () => exportDecisionsCsv());
  // Leadership report markdown: the renderer composes it, main writes it.
  ipcMain.handle('macro-export-report', (_e, markdown: string) => exportMacroReport(markdown));
  // Background-generated reports: the page lists the latest one per theme and
  // can re-run a theme's task (fire and forget — completion arrives as a
  // briefing notification plus a `macro-reports-updated` broadcast).
  ipcMain.handle('macro-reports', () => listMacroReports());
  ipcMain.handle('macro-report-read', (_e, file: string) => {
    const markdown = readMacroReport(file);
    return markdown === null ? null : { file, markdown };
  });
  ipcMain.handle(
    'macro-regenerate',
    (_e, themeId: MacroThemeId): { ok: true; taskId: string } | { ok: false; reason: string } => {
      if (!cronEngine.canFire()) return { ok: false, reason: 'runtime-not-ready' };
      let task = cronEngine.listTasks().find((t) => t.macroTheme === themeId);
      if (!task) {
        try {
          // Explicit re-run of a theme the user deleted: recreate the task
          // paused (the delete is respected) and run it once, right now.
          task = cronEngine.ensureTask(defaultMacroTask(themeId));
          cronEngine.toggleTask(task.id, false);
        } catch {
          return { ok: false, reason: 'unknown-theme' };
        }
      }
      void cronEngine.fireNow(task.id).then((record) => {
        if (!record) log.warn(`[macro] regenerate ${themeId}: task was not executed`);
      });
      return { ok: true, taskId: task.id };
    },
  );
  ipcMain.handle('research-digest', () => readKnowledgeDigest());
  // Snapshot pushes (dashboard refresh) + created alerts (threshold moves).
  macroStore.onChange((snapshot, alerts) => {
    broadcast('macro-dashboard-updated', snapshot);
    for (const alert of alerts) broadcast('macro-notification', alert);
  });

  // ---- Whisper STT ----
  ipcMain.handle('whisper-available', () => isWhisperAvailable());
  ipcMain.handle('whisper-transcribe', async (_e, wavBuffer: ArrayBuffer, lang?: string) => {
    try {
      return await transcribeWav(Buffer.from(wavBuffer), lang ?? 'zh');
    } catch (err) {
      log.warn(`[whisper] transcribe failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  });

  log.info('IPC handlers registered');
  registerTerminalHandlers();

  // ---- Browser ----
  ipcMain.handle('browser:fetch', async (_e, url: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
      const html = await fetchPageContent(url);
      return extractText(html);
    } catch (err) {
      return `获取页面内容失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
}
