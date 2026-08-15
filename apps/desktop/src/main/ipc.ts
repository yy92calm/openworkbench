import { app, ipcMain, dialog, BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { createAgentRuntime, type AgentRuntime, type AgentRuntimeEvent } from "@workbench/sdk/agent-runtime";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL, APP_NAMES, APP_IDS } from "./constants";
import { getStore, removeStoreFile } from "./store";
import { getLogger, exportDebugLogs } from "./logging";
import { stopSidecar, getServerPassword, workspaceDir, baseWorkspaceDir, setActiveWorkspace, setBaseWorkspace, getServerUrl, startAgentRuntime, type AgentRuntimeKind, deployedProfileDir } from "./server";
import * as artifactFile from "./artifact_file";
import * as kernel from "./kernel";
import * as provenance from "./provenance";
import { startPreviewServer, stopPreviewServer, previewToken, previewUrl } from "./preview_server";
import { detectShells, detectTools, enrichedPath } from "./shell_env";
import { checkForUpdates } from "./updater";
import { createMainWindow, getMainWindow } from "./windows";
import { cronEngine, type CreateTaskInput, type UpdateTaskInput } from "./scheduler";
import { readDeployedManifest, writeUserPatch, readInteractionConfig, validateUserPatch } from "./profilePatch";
import { registerTerminalHandlers } from "./terminal";
import { fetchPageContent, extractText } from "./browser";
import { isWhisperAvailable, transcribeWav } from "./whisper";
import { RelayHost, type RelayHostConfig } from "./relayHost";

/** Host-side relay instance (shared by IPC handlers). */
export const relayHost = new RelayHost();

export function registerIpcHandlers(): void {
  const log = getLogger();

  // ---- Channel ----
  ipcMain.handle("channel-name", () => CHANNEL);
  ipcMain.handle("app-identifier", () => APP_IDS[CHANNEL]);
  ipcMain.handle("app-version", () => app.getVersion());

  // ---- Runtime (sidecar) ----
  // `kind` selects the engine: "opencode" (default) spawns the opencode serve
  // sidecar; "claude-code" deploys the .claude profile and runs the Agent SDK
  // in-process (no sidecar URL). The renderer reads the user's choice from the
  // UI store and passes it here.
  ipcMain.handle("start-runtime", async (_e, kind?: AgentRuntimeKind) => {
    const runtimeKind: AgentRuntimeKind = kind === "claude-code" ? "claude-code" : "opencode";
    try {
      const result = await startAgentRuntime(runtimeKind);
      log.info(`[server] agent runtime started: ${result.kind} url=${result.url ?? "null"}`);

      // For opencode: the cron engine needs a client connected to the sidecar.
      // For claude-code: cron is opencode-only for now (no long-running sidecar
      // to attach to); a future claude-code cron path would use a
      // ClaudeCodeAdapter in the main process.
      if (result.kind === "opencode" && result.url) {
        const password = getServerPassword();
        const directory = workspaceDir();
        const client: AgentRuntime = await createAgentRuntime({
          kind: "opencode",
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
            log.warn(`[server] client.connect attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
            if (attempt < 4) await new Promise((r) => setTimeout(r, 1000));
          }
        }
        if (lastErr) throw lastErr;
        cronEngine.setFireCallback(async (task) => {
          const sessionId = await client.createSession();
          const idlePromise = new Promise<void>((resolve) => {
            const unsubscribe = client.onEvent((event: AgentRuntimeEvent) => {
              if (event.type === "session.idle" && event.sessionId === sessionId) {
                unsubscribe();
                resolve();
              }
            });
            setTimeout(() => { unsubscribe(); resolve(); }, 10 * 60 * 1000);
          });
          await client.sendPrompt(sessionId, task.prompt);
          await idlePromise;
          return sessionId;
        });
        cronEngine.start();
      }
      return result.url;
    } catch (err) {
      log.error(`[server] start-runtime failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  });
  ipcMain.handle("runtime-password", () => getServerPassword());
  ipcMain.handle("stop-runtime", () => stopSidecar());
  ipcMain.handle("server-url", () => getServerUrl());

  // ---- Remote relay (host side) ----
  // Config is persisted in the electron-store under "relay". deviceId and token
  // are generated once on first use; the token never leaves the main process
  // in status responses.
  ipcMain.handle("relay-status", () => {
    const store = getStore();
    const cfg = store.get("relay") as Partial<RelayHostConfig> | undefined;
    return {
      status: relayHost.getStatus(),
      config: {
        enabled: !!cfg?.enabled,
        relayUrl: cfg?.relayUrl ?? "ws://43.133.82.137:8080",
        deviceId: cfg?.deviceId ?? "",
        tokenSet: !!cfg?.token,
      },
    };
  });
  ipcMain.handle("relay-start", (_e, input: RelayHostConfig) => {
    const store = getStore();
    const existing = store.get("relay") as Partial<RelayHostConfig> | undefined;
    const cfg: RelayHostConfig = {
      enabled: true,
      relayUrl: input.relayUrl?.trim() || existing?.relayUrl || "ws://43.133.82.137:8080",
      deviceId: input.deviceId?.trim() || existing?.deviceId || randomUUID(),
      token: input.token?.trim() || existing?.token || randomUUID(),
    };
    store.set("relay", cfg);
    return relayHost.start(cfg);
  });
  ipcMain.handle("relay-stop", () => {
    const store = getStore();
    const cfg = store.get("relay") as Partial<RelayHostConfig> | undefined;
    if (cfg) store.set("relay", { ...cfg, enabled: false });
    relayHost.stop();
    return "off";
  });
  relayHost.onStatusChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("relay-status-changed", status);
    }
  });

  // Restart: stop the sidecar then start it again (picks up new provider config).
  ipcMain.handle("restart-runtime", async (_e, kind?: AgentRuntimeKind) => {
    stopSidecar();
    const runtimeKind: AgentRuntimeKind = kind === "claude-code" ? "claude-code" : "opencode";
    const result = await startAgentRuntime(runtimeKind);
    return result.url;
  });

  // ---- Workspace ----
  ipcMain.handle("workspace-path", () => workspaceDir());
  ipcMain.handle("workspace-base", () => baseWorkspaceDir());
  ipcMain.handle("set-workspace-base", (_e, path: string) => {
    setBaseWorkspace(path);
    return baseWorkspaceDir();
  });
  ipcMain.handle("set-workspace", (_e, path: string) => {
    setActiveWorkspace(path);
    return workspaceDir();
  });
  ipcMain.handle("new-dated-workspace", (_e, name: string) => {
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
      throw new Error("invalid folder name");
    }
    const dir = require("node:path").join(baseWorkspaceDir(), name);
    setActiveWorkspace(dir);
    return dir;
  });
  ipcMain.handle("open-workspace-base", () => {
    const { shell } = require("electron");
    shell.openPath(baseWorkspaceDir());
  });
  ipcMain.handle("pick-folder", async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ---- Artifact / File ----
  ipcMain.handle("read-artifact", (_e, path: string, root?: string) => artifactFile.readArtifact(path, root));
  ipcMain.handle("open-path", (_e, rel: string, root?: string) => artifactFile.openPath(rel, root));
  ipcMain.handle("resolve-artifact", (_e, rel: string, root?: string) => artifactFile.resolveArtifact(rel, root));
  ipcMain.handle("save-text-file", (_e, filename: string, content: string) => artifactFile.saveTextFile(filename, content));
  ipcMain.handle("open-url", (_e, url: string) => artifactFile.openUrl(url));
  ipcMain.handle("add-files-to-workspace", async () => {
    const win = getMainWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"] });
    if (result.canceled || result.filePaths.length === 0) return [];
    const names: string[] = [];
    for (const fp of result.filePaths) {
      const fs = await import("node:fs");
      const content = fs.readFileSync(fp, "utf-8");
      const name = require("node:path").basename(fp);
      artifactFile.addTextToWorkspace(name, content);
      names.push(name);
    }
    return names;
  });
  ipcMain.handle("add-text-to-workspace", (_e, filename: string, content: string) =>
    artifactFile.addTextToWorkspace(filename, content));
  ipcMain.handle("list-notebooks", (_e, root?: string) => artifactFile.listNotebooks(root));
  ipcMain.handle("list-dir", (_e, rel: string, root?: string) => artifactFile.listDir(rel, root));
  ipcMain.handle("write-workspace-file", (_e, rel: string, content: string, root?: string) =>
    artifactFile.writeWorkspaceFile(rel, content, root));

  // ---- Kernel ----
  ipcMain.handle("kernel-execute", (_e, code: string, language: string, notebook?: string) =>
    kernel.kernelExecute(code, language, notebook));
  ipcMain.handle("kernel-reset", (_e, language: string, notebook?: string) =>
    kernel.kernelReset(language, notebook));

  // ---- Provenance ----
  ipcMain.handle("record-provenance", (_e, sessionId: string, callId: string, tool: string, input: unknown, output: unknown, model: string | null) =>
    provenance.recordProvenance(sessionId, callId, tool, input, output, model));
  ipcMain.handle("list-provenance", (_e, path: string) => provenance.listProvenance(path));
  ipcMain.handle("read-env-lockfile", (_e, hash: string) => provenance.readEnvLockfile(hash));

  // ---- Preview ----
  ipcMain.handle("preview-url", (_e, rel: string, root?: string) => previewUrl(rel, root));

  // ---- Tools ----
  ipcMain.handle("detect-tools", async () => {
    const tools = await detectTools();
    return tools.map((t) => ({
      name: t.name,
      found: t.path !== null,
      version: t.version,
    }));
  });

  // ---- Shell ----
  ipcMain.handle("shell-path", () => enrichedPath());
  ipcMain.handle("shell-info", () => detectShells());

  // ---- Store ----
  ipcMain.handle("store-get", (_e, key: string, scope?: string) => {
    const store = getStore(scope);
    return store.get(key);
  });
  ipcMain.handle("store-set", (_e, key: string, value: unknown, scope?: string) => {
    const store = getStore(scope);
    store.set(key, value);
  });
  ipcMain.handle("store-delete", (_e, key: string, scope?: string) => {
    const store = getStore(scope);
    store.delete(key);
  });
  ipcMain.handle("store-clear", (_e, scope?: string) => {
    const store = getStore(scope);
    store.clear();
  });
  ipcMain.handle("store-keys", (_e, scope?: string) => {
    const store = getStore(scope);
    return Object.keys(store.store);
  });
  ipcMain.handle("store-length", (_e, scope?: string) => {
    const store = getStore(scope);
    return Object.keys(store.store).length;
  });

  // ---- Profile patch overlay ----
  ipcMain.handle("profile-manifest", () => readDeployedManifest());
  ipcMain.handle("profile-interaction", () => readInteractionConfig(deployedProfileDir()));
  ipcMain.handle("profile-validate-patch", (_e, raw: string) => {
    const file = join(deployedProfileDir(), "opencode.json");
    const base = existsSync(file) ? readFileSync(file, "utf-8") : "{}";
    return validateUserPatch(base, raw);
  });
  ipcMain.handle("profile-write-patch", (_e, raw: string) => {
    try {
      writeUserPatch(raw);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- Logging ----
  ipcMain.handle("log-debug", (_e, message: string) => {
    log.info(`[renderer] ${message}`);
  });
  ipcMain.handle("log-event", (_e, level: string, module: string, message: string, data?: unknown) => {
    const lvl = level.toLowerCase() === "warn" ? "warn"
      : level.toLowerCase() === "error" ? "error"
      : level.toLowerCase() === "debug" ? "debug"
      : "info";
    const meta = data ? ` ${JSON.stringify(data)}` : "";
    log[lvl](`[${module}] ${message}${meta}`);
  });
  ipcMain.handle("export-logs", async () => exportDebugLogs());

  // ---- Updater ----
  ipcMain.handle("check-for-updates", async (_e, alertOnUpToDate: boolean) => {
    await checkForUpdates(alertOnUpToDate);
  });

  // ---- Scheduler ----
  ipcMain.handle("scheduler:list", () => cronEngine.listTasks());
  ipcMain.handle("scheduler:create", (_e, task: CreateTaskInput) => cronEngine.addTask(task));
  ipcMain.handle("scheduler:update", (_e, id: string, patch: UpdateTaskInput) => cronEngine.updateTask(id, patch));
  ipcMain.handle("scheduler:delete", (_e, id: string) => cronEngine.removeTask(id));
  ipcMain.handle("scheduler:toggle", (_e, id: string, enabled: boolean) => cronEngine.toggleTask(id, enabled));
  ipcMain.handle("scheduler:fire-now", (_e, id: string) => cronEngine.fireNow(id));
  ipcMain.handle("scheduler:history", (_e, taskId?: string, limit?: number) => cronEngine.getHistory(taskId, limit));
  ipcMain.handle("scheduler:delete-execution", (_e, id: string) => cronEngine.deleteExecution(id));
  ipcMain.handle("scheduler:clear-history", (_e, taskId?: string) => cronEngine.clearHistory(taskId));

  // ---- Whisper STT ----
  ipcMain.handle("whisper-available", () => isWhisperAvailable());
  ipcMain.handle("whisper-transcribe", async (_e, wavBuffer: ArrayBuffer, lang?: string) => {
    try {
      return await transcribeWav(Buffer.from(wavBuffer), lang ?? "zh");
    } catch (err) {
      log.warn(`[whisper] transcribe failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  });

  log.info("IPC handlers registered");
  registerTerminalHandlers();

  // ---- Browser ----
  ipcMain.handle("browser:fetch", async (_e, url: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
      const html = await fetchPageContent(url);
      return extractText(html);
    } catch (err) {
      return `获取页面内容失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
}
