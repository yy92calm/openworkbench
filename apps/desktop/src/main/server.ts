import { randomUUID } from "node:crypto";
import { accessSync, cpSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import type { ChildProcess } from "node:child_process";
import { execFileSync, spawn } from "node:child_process";
import { deploySchedulerProfile, startSchedulerApi, stopSchedulerApi } from "./scheduler";
import { createBrowserMcp, type BrowserMcpPlugin } from "@fafawork/browser-mcp";
import { enrichedPath } from "./shell_env";
import { syncDir } from "./syncDir";
import { applyUserOverlay } from "./profilePatch";
import { getStore } from "./store";

let child: ChildProcess | null = null;
let currentUrl: string | null = null;
let currentPort: number | null = null;
let serverPassword = "";

// Browser MCP plugin instance (lazy-initialized)
let browserMcpInstance: BrowserMcpPlugin | null = null;
export function getBrowserMcp(): BrowserMcpPlugin {
  if (!browserMcpInstance) {
    browserMcpInstance = createBrowserMcp({
      workspaceDir: () => workspaceDir(),
      logger: {
        info: (...a: unknown[]) => log("browser-mcp", "info", a.map(String).join(" ")),
        warn: (...a: unknown[]) => log("browser-mcp", "warn", a.map(String).join(" ")),
        error: (...a: unknown[]) => log("browser-mcp", "error", a.map(String).join(" ")),
      },
    });
  }
  return browserMcpInstance;
}

export function getServerPassword(): string {
  if (!serverPassword) serverPassword = randomUUID();
  return serverPassword;
}

export function getServerUrl(): string | null {
  return currentUrl;
}

function runtimeRoot(): string {
  const dir = join(app.getPath("userData"), "runtime");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function xdgConfigHome(): string {
  return join(runtimeRoot(), "xdg-config");
}

/** Where the bundled OpenCode profile is deployed on each sidecar start. */
export function deployedProfileDir(): string {
  return join(xdgConfigHome(), "opencode");
}

function activeWorkspaceFile(): string {
  return join(runtimeRoot(), "active-workspace.txt");
}

function baseWorkspaceFile(): string {
  return join(runtimeRoot(), "base-workspace.txt");
}

export function workspaceDir(): string {
  const file = activeWorkspaceFile();
  try {
    const dir = readFileSync(file, "utf-8").trim();
    if (existsSync(dir)) return dir;
  } catch { /* fall through */ }
  return baseWorkspaceDir();
}

export function baseWorkspaceDir(): string {
  const file = baseWorkspaceFile();
  try {
    const dir = readFileSync(file, "utf-8").trim();
    if (existsSync(dir)) return dir;
  } catch { /* fall through */ }
  const docs = join(app.getPath("documents"), "Workbench");
  mkdirSync(docs, { recursive: true });
  return docs;
}

export function setActiveWorkspace(path: string): void {
  writeFileSync(activeWorkspaceFile(), path);
}

export function setBaseWorkspace(path: string): void {
  writeFileSync(baseWorkspaceFile(), path);
}

function bundledProfileSource(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "app-config", ".opencode");
  }
  // app.getAppPath() -> apps/desktop  in dev, so we need two levels up to
  // reach the repo-root app-config/.opencode directory.
  return join(app.getAppPath(), "..", "..", "app-config", ".opencode");
}

function claudeProfileSource(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "app-config", ".claude");
  }
  return join(app.getAppPath(), "..", "..", "app-config", ".claude");
}

function sidecarBinaryPath(): string {
  const binaryName = process.platform === "win32" ? "opencode.exe" : "opencode";
  if (app.isPackaged) {
    return join(process.resourcesPath, "binaries", binaryName);
  }
  return join(app.getAppPath(), "binaries", binaryName);
}

/** Clear the OpenCode SQLite database when the bundled sidecar binary changes.
 *  OpenCode's DB schema is version-specific; a binary upgrade against a stale
 *  DB causes "no such table" errors that make /event return 500.
 *
 *  The fingerprint is the sidecar's `--version` output, not its mtime — a
 *  repackage/reinstall of the same binary must NOT wipe session history. Only
 *  an actual opencode version bump clears the DB. */
function migrateStaleDatabase(sidecarPath: string, dataHome: string): void {
  const markerPath = join(runtimeRoot(), "sidecar-fingerprint.txt");
  let fingerprint = "";
  try {
    // Quick version probe: identical version ⇒ identical schema ⇒ keep the DB.
    fingerprint = execFileSync(sidecarPath, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    // Can't probe (broken binary / no exec) — fall back to size+mtime.
    try {
      const st = statSync(sidecarPath);
      fingerprint = `${st.size}:${Math.floor(st.mtimeMs)}`;
    } catch {
      return; // can't stat - let the normal "not found" path handle it
    }
  }
  let stored = "";
  try {
    stored = readFileSync(markerPath, "utf-8").trim();
  } catch { /* no marker yet */ }
  if (stored === fingerprint) return; // same binary, DB is compatible
  // Binary changed (or first run) - clear stale DB files so OpenCode recreates
  // them with the correct schema.
  const dbDir = join(dataHome, "opencode");
  if (existsSync(dbDir)) {
    for (const f of ["opencode.db", "opencode.db-shm", "opencode.db-wal"]) {
      const p = join(dbDir, f);
      if (existsSync(p)) {
        rmSync(p, { force: true });
        log("db", "migrate", `deleted stale ${f}`);
      }
    }
  }
  writeFileSync(markerPath, fingerprint);
  log("db", "migrate", `sidecar fingerprint updated: ${fingerprint}`);
}

export function deployBundledProfile(): void {
  const source = bundledProfileSource();
  const target = deployedProfileDir();
  if (!existsSync(source)) {
    log("profile", "deploy", `source not found: ${source}`, "warn");
    return;
  }
  syncDir(source, target);
  // Layer user file overrides + patch.json on top of the base mirror.
  const manifest = applyUserOverlay(target);
  log(
    "profile",
    "deploy",
    `deployed ${source} -> ${target} (base=${manifest.base} patch=${manifest.patch}` +
      `${manifest.fileOverrides.length ? ` overlays=${manifest.fileOverrides.join(",")}` : ""})`,
  );
  // Merge user-configured provider overrides (Settings → Model Config)
  applyUserProviderConfig(target);
}

/** Read user's manual provider config from electron-store and patch it into
 *  the deployed opencode.json. Supports both:
 *  - Array format: "provider-configs" = [{ id, name, baseUrl, apiKey, modelId, providerName, active }]
 *  - Legacy single: "provider-config" = { baseUrl, apiKey, modelId, providerName } */
function applyUserProviderConfig(profileDir: string): void {
  try {
    const store = getStore();

    // Try array format first
    const arr = store.get("provider-configs") as
      | Array<{ id: string; baseUrl?: string; apiKey?: string; modelId?: string; providerName?: string; active?: boolean }>
      | undefined;
    let cfg: { baseUrl?: string; apiKey?: string; modelId?: string; providerName?: string } | undefined;
    if (arr && Array.isArray(arr) && arr.length > 0) {
      cfg = arr.find((c) => c.active) ?? arr[0];
    } else {
      // Fall back to legacy single-config format
      cfg = store.get("provider-config") as
        | { baseUrl?: string; apiKey?: string; modelId?: string; providerName?: string }
        | undefined;
    }
    if (!cfg || (!cfg.baseUrl && !cfg.apiKey && !cfg.modelId)) return;

    const jsonPath = join(profileDir, "opencode.json");
    if (!existsSync(jsonPath)) return;
    const json = JSON.parse(readFileSync(jsonPath, "utf-8"));

    const providerId = cfg.providerName || "custom";
    const modelId = cfg.modelId || "default-model";

    // Build / override the provider entry
    if (!json.provider) json.provider = {};
    json.provider[providerId] = {
      npm: "@ai-sdk/openai-compatible",
      name: providerId,
      options: {
        ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      },
      models: {
        [modelId]: { name: modelId },
      },
    };
    // Set as default model
    json.model = `${providerId}/${modelId}`;

    writeFileSync(jsonPath, JSON.stringify(json, null, 2));
    log("profile", "provider", `applied user provider config: ${providerId}/${modelId}`);
  } catch (err) {
    log("profile", "provider", `failed to apply user config: ${err}`, "warn");
  }
}

/** Deploy the bundled .claude profile to the active workspace so Claude Code
 *  picks up CLAUDE.md, settings.json, skills, and commands. */
export function deployClaudeProfile(): void {
  const source = claudeProfileSource();
  const ws = workspaceDir();
  const target = join(ws, ".claude");
  if (!existsSync(source)) {
    log("claude-profile", "deploy", `source not found: ${source}`, "warn");
    return;
  }
  // Merge (not replace) so user-authored skills/commands survive a redeploy.
  cpSync(source, target, { recursive: true });
  log("claude-profile", "deploy", `deployed ${source} -> ${target}`);
}

export type AgentRuntimeKind = "opencode" | "claude-code";

export interface StartRuntimeResult {
  kind: AgentRuntimeKind;
  /** OpenCode: the sidecar's base URL. Claude Code: null (no sidecar). */
  url: string | null;
}

/** Start the agent runtime for the selected engine.
 *  - opencode: spawn `opencode serve` sidecar, return its URL.
 *  - claude-code: deploy the .claude profile, return null (no sidecar needed;
 *    the ClaudeCodeAdapter runs in-process via the Agent SDK). */
export async function startAgentRuntime(kind: AgentRuntimeKind): Promise<StartRuntimeResult> {
  if (kind === "claude-code") {
    deployClaudeProfile();
    return { kind, url: null };
  }
  // Default: opencode
  const url = await startSidecar();
  return { kind: "opencode", url };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr !== "object" || !addr) {
        srv.close();
        reject(new Error("Failed to get port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

function mcpSchedulerScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "scripts", "mcp_scheduler.mjs");
  }
  return join(app.getAppPath(), "scripts", "mcp_scheduler.mjs");
}

export async function startSidecar(): Promise<string> {
  if (child && currentUrl) return currentUrl;
  const port = currentPort ?? (await freePort());
  currentPort = port;
  const url = `http://127.0.0.1:${port}`;

  const root = runtimeRoot();
  const cfg = join(root, "xdg-config");
  const data = join(root, "xdg-data");
  const cache = join(root, "xdg-cache");
  const state = join(root, "xdg-state");
  const workspace = workspaceDir();
  for (const d of [cfg, data, cache, state]) mkdirSync(d, { recursive: true });

  deployBundledProfile();

  // Start the scheduler HTTP API so the MCP server can reach it
  const password = getServerPassword();
  const apiInfo = await startSchedulerApi(password);

  // Deploy scheduler profile (skill + command + MCP config) with the live API info
  deploySchedulerProfile(cfg, mcpSchedulerScriptPath(), apiInfo);

  // Deploy browser MCP server (auto-register with agent runtime)
  getBrowserMcp().deploy(cfg);

  const env: Record<string, string> = {
    OPENCODE_SERVER_PASSWORD: password,
    XDG_CONFIG_HOME: cfg,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache,
    XDG_STATE_HOME: state,
    HOME: homedir(),
    PATH: enrichedPath(),
  };

  const sidecarPath = sidecarBinaryPath();

  // Clear stale DB if the bundled sidecar binary changed since last run.
  migrateStaleDatabase(sidecarPath, data);

  if (!existsSync(sidecarPath)) {
    const msg = `sidecar binary not found: ${sidecarPath}`;
    log("server", "error", msg, "error");
    throw new Error(msg);
  }

  try {
    accessSync(sidecarPath, fsConstants.X_OK);
  } catch {
    const msg = `sidecar not executable: ${sidecarPath}`;
    log("server", "error", msg, "error");
    throw new Error(msg);
  }

  const cmd = spawn(sidecarPath, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, ...env },
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let spawnError: Error | null = null;
  cmd.on("error", (err) => {
    spawnError = err;
    log("server", "error", `spawn failed: ${err.message}`, "error");
    child = null;
    currentUrl = null;
    currentPort = null;
  });

  cmd.stdout?.on("data", (d: Buffer) => {
    log("server", "stdout", d.toString().trim());
  });
  cmd.stderr?.on("data", (d: Buffer) => {
    log("server", "stderr", d.toString().trim(), "warn");
  });
  cmd.on("exit", (code) => {
    log("server", "sidecar exited", { code }, "warn");
    child = null;
    currentUrl = null;
    currentPort = null;
  });

  child = cmd;
  currentUrl = url;

  // Wait until the sidecar is actually accepting connections so that the
  // caller (and the renderer client) never hit a "connection refused" race.
  await waitForReady(url, 15_000);

  return url;
}

export function stopSidecar(): void {
  if (child) {
    child.kill();
    child = null;
  }
  currentUrl = null;
  // NOTE: scheduler API lifecycle is independent — managed in index.ts
}

/** Poll the sidecar until it accepts a TCP connection (or timeout). */
function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (!child) { reject(new Error("sidecar process died")); return; }
      if (Date.now() > deadline) { reject(new Error("sidecar ready timeout")); return; }
      const req = httpGet(url, (res: any) => {
        res.resume(); // drain
        resolve();
      });
      req.on("error", () => { setTimeout(tryConnect, 200); });
      req.setTimeout(500, () => { req.destroy(); setTimeout(tryConnect, 200); });
    };
    tryConnect();
  });
}

function log(
  module: string,
  stream: string,
  message: string,
  level: "info" | "warn" | "error" = "info",
): void {
  try {
    // dynamic import to avoid circular deps
    import("./logging").then(({ getLogger }) =>
      getLogger()[level](`[${module}] [${stream}] ${message}`),
    );
  } catch { /* ignore logging failures */ }
}
