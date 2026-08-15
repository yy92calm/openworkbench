import { WebSocket } from "ws";
// Local copy of the relay wire protocol (contract between the three projects:
// Workbench host, relay, remote client). Keep in sync with relay/src/protocol.ts
// and client/src/protocol.ts — changes to the relay server must be mirrored here.
import type { RelayMessage } from "./relay-protocol";
import { getServerUrl, getServerPassword, workspaceDir, baseWorkspaceDir, setActiveWorkspace } from "./server";
import { getStore } from "./store";
import * as artifactFile from "./artifact_file";
import { cronEngine } from "./scheduler";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export interface RelayHostConfig {
  enabled: boolean;
  relayUrl: string;
  deviceId: string;
  token: string;
}

export type RelayHostStatus = "off" | "connecting" | "connected" | "error";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const REMOTE_SESSIONS_KEY = "remoteSessionIds";
const STORE_NAME = "workbench.relay";

/** Host side of the remote relay: opens an outbound WS to the public relay and
 *  forwards guest HTTP requests to the local OpenCode sidecar. Reconnects with
 *  exponential backoff. Never exposes the sidecar port directly. */
export class RelayHost {
  private config: RelayHostConfig | null = null;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private stopped = true;
  private status: RelayHostStatus = "off";
  private readonly listeners = new Set<(s: RelayHostStatus) => void>();
  /** In-flight sidecar fetches keyed by relay request id — aborted when the
   *  relay sends `cancel` (the guest disconnected). */
  private readonly pendingFetches = new Map<string, AbortController>();
  /** Session IDs created by remote guests via relay. Persisted so the badge
   *  survives host restarts. */
  private remoteSessionIds: Set<string> = new Set();
  private readonly remoteListeners = new Set<() => void>();

  constructor() {
    this.loadRemoteSessions();
  }

  getStatus(): RelayHostStatus {
    return this.status;
  }

  onStatusChange(cb: (s: RelayHostStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Returns the set of session IDs known to be created by remote guests. */
  getRemoteSessionIds(): string[] {
    return Array.from(this.remoteSessionIds);
  }

  /** Subscribe to remote-session-set changes (new remote session recorded). */
  onRemoteSessionsChange(cb: () => void): () => void {
    this.remoteListeners.add(cb);
    return () => this.remoteListeners.delete(cb);
  }

  private loadRemoteSessions(): void {
    try {
      const store = getStore(STORE_NAME);
      const raw = store.get(REMOTE_SESSIONS_KEY);
      if (Array.isArray(raw)) {
        this.remoteSessionIds = new Set(raw.filter((x): x is string => typeof x === "string"));
      }
    } catch {
      // store not yet available (very early init) — skip; will load lazily
    }
  }

  private recordRemoteSession(sessionId: string): void {
    if (this.remoteSessionIds.has(sessionId)) return;
    this.remoteSessionIds.add(sessionId);
    try {
      const store = getStore(STORE_NAME);
      store.set(REMOTE_SESSIONS_KEY, Array.from(this.remoteSessionIds));
    } catch {
      // persistence failure is non-fatal — badge still works for this run
    }
    for (const cb of this.remoteListeners) {
      try { cb(); } catch { /* listener errors are isolated */ }
    }
  }

  start(config: RelayHostConfig): RelayHostStatus {
    this.stop();
    this.config = config;
    this.stopped = false;
    this.attempts = 0;
    this.connect();
    return this.status;
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const ctrl of this.pendingFetches.values()) ctrl.abort();
    this.pendingFetches.clear();
    this.ws?.close();
    this.ws = null;
    this.setStatus("off");
  }

  private setStatus(next: RelayHostStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const cb of this.listeners) cb(next);
  }

  private connect(): void {
    if (this.stopped || !this.config) return;
    this.setStatus("connecting");
    const { relayUrl, deviceId, token } = this.config;
    const url = new URL(relayUrl);
    url.searchParams.set("role", "host");
    url.searchParams.set("device", deviceId);
    url.searchParams.set("token", token);
    const ws = new WebSocket(url.toString());
    this.ws = ws;
    ws.on("open", () => {
      this.attempts = 0;
      this.setStatus("connected");
    });
    ws.on("message", (data) => void this.handleMessage(data));
    ws.on("close", () => {
      if (this.ws !== ws) return; // superseded by stop()/start()
      this.ws = null;
      if (!this.stopped) {
        this.setStatus("error");
        this.scheduleReconnect();
      }
    });
    ws.on("error", () => {
      // close follows; just surface the transient state
      if (!this.stopped) this.setStatus("error");
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempts, RECONNECT_MAX_MS);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Guest request → local sidecar → head/chunk/done back through the socket.
   *  Also handles relay → host `cancel` messages so an in-flight forward (e.g.
   *  an SSE stream) is aborted when its guest disconnects. */
  private async handleMessage(data: unknown): Promise<void> {
    let msg: RelayMessage | null = null;
    try {
      msg = JSON.parse(String(data)) as RelayMessage;
    } catch {
      return;
    }
    if (!msg) return;
    if (msg.type === "cancel") {
      // The guest left — abort the sidecar fetch so it doesn't hang/leak.
      const ctrl = this.pendingFetches.get(msg.id);
      if (ctrl) {
        ctrl.abort();
        this.pendingFetches.delete(msg.id);
      }
      return;
    }
    if (msg.type !== "request") return;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Special relay endpoint: write a file attachment into the host workspace.
    // The client uploads base64 content; this writes it to disk so the sidecar
    // can reference it as a real FilePartInput path. Body: { filename, base64 }.
    if (msg.path === "/__relay/write-file") {
      await this.handleWriteFile(ws, msg);
      return;
    }

    // Host API: operations that touch Electron main-process resources
    // (scheduler, workspace, file system) and never reach the sidecar.
    if (msg.path.startsWith("/__host/")) {
      await this.handleHostApi(ws, msg);
      return;
    }

    const sidecarUrl = getServerUrl();
    if (!sidecarUrl) {
      ws.send(JSON.stringify({ type: "head", id: msg.id, status: 503, headers: {} }));
      ws.send(JSON.stringify({ type: "done", id: msg.id }));
      return;
    }
    // The sidecar's Basic auth password is host-local (regenerated per run) —
    // guests never learn it. Inject the host's own credential on every
    // forwarded request, overriding anything the guest sent.
    const headers = { ...(msg.headers ?? {}) };
    const password = getServerPassword();
    if (password) {
      headers["Authorization"] = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    }
    const ctrl = new AbortController();
    this.pendingFetches.set(msg.id, ctrl);
    // Detect remote session creation so we can badge it in the sidebar.
    // POST /session (optionally with ?directory=... query) returns { id }.
    const isRemoteSessionCreate =
      msg.method === "POST" && /^\/session(\?|$)/.test(msg.path);
    let collectedBody = "";
    try {
      const res = await fetch(`${sidecarUrl}${msg.path}`, {
        method: msg.method,
        headers,
        signal: ctrl.signal,
        ...(msg.body !== undefined ? { body: msg.body } : {}),
      });
      ws.send(JSON.stringify({
        type: "head",
        id: msg.id,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
      }));
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text) {
            if (isRemoteSessionCreate) collectedBody += text;
            ws.send(JSON.stringify({ type: "chunk", id: msg.id, chunk: text }));
          }
        }
      }
      ws.send(JSON.stringify({ type: "done", id: msg.id }));
      if (isRemoteSessionCreate && collectedBody) {
        try {
          const parsed = JSON.parse(collectedBody) as { id?: unknown };
          if (typeof parsed.id === "string" && parsed.id) {
            this.recordRemoteSession(parsed.id);
          }
        } catch {
          // response wasn't the expected JSON — ignore
        }
      }
    } catch (err) {
      // Aborted because the guest disconnected (relay sent cancel) — the guest
      // is gone, nothing to reply to. Any other failure is a genuine error.
      if ((err as Error).name === "AbortError") {
        this.pendingFetches.delete(msg.id);
        return;
      }
      const logger = (await import("./logging")).getLogger();
      logger.warn(`[relayHost] forward failed: ${(err as Error)?.message} path=${msg.path} sidecar=${sidecarUrl}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "head", id: msg.id, status: 502, headers: {} }));
        ws.send(JSON.stringify({ type: "done", id: msg.id }));
      }
    } finally {
      this.pendingFetches.delete(msg.id);
    }
  }

  /** Write a file attachment into the host workspace (the "__relay/write-file"
   *  endpoint). Body: { filename: string, base64: string }. Replies with the
   *  absolute path the sidecar can reference in a FilePartInput. */
  private async handleWriteFile(
    ws: WebSocket,
    msg: Extract<RelayMessage, { type: "request" }>,
  ): Promise<void> {
    const logger = (await import("./logging")).getLogger();
    const respond = (status: number, body: string) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "head", id: msg.id, status, headers: { "content-type": "application/json" } }));
      ws.send(JSON.stringify({ type: "chunk", id: msg.id, chunk: body }));
      ws.send(JSON.stringify({ type: "done", id: msg.id }));
    };
    try {
      const payload = JSON.parse(msg.body ?? "{}") as { filename?: string; base64?: string };
      const filename = basename(payload.filename ?? "");
      if (!filename || typeof payload.base64 !== "string") {
        respond(400, JSON.stringify({ error: "filename and base64 required" }));
        return;
      }
      const dir = workspaceDir();
      if (!dir || !existsSync(dir)) {
        respond(503, JSON.stringify({ error: "no workspace" }));
        return;
      }
      const dest = join(dir, filename);
      const bytes = Buffer.from(payload.base64, "base64");
      writeFileSync(dest, bytes);
      logger.info(`[relayHost] wrote attachment ${filename} (${bytes.length} bytes) -> ${dest}`);
      respond(200, JSON.stringify({ path: dest, filename }));
    } catch (err) {
      logger.warn(`[relayHost] write-file failed: ${(err as Error)?.message}`);
      respond(500, JSON.stringify({ error: (err as Error)?.message ?? "write failed" }));
    }
  }

  /** Host API: routes `/__host/*` requests to main-process functions
   *  (scheduler, workspace, file system). Never reaches the sidecar. */
  private async handleHostApi(
    ws: WebSocket,
    msg: Extract<RelayMessage, { type: "request" }>,
  ): Promise<void> {
    const respond = (status: number, body: unknown) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "head", id: msg.id, status, headers: { "content-type": "application/json" } }));
      ws.send(JSON.stringify({ type: "chunk", id: msg.id, chunk: JSON.stringify(body) }));
      ws.send(JSON.stringify({ type: "done", id: msg.id }));
    };

    try {
      // Strip query string for routing; parse query params separately.
      const rawPath = msg.path;
      const qIdx = rawPath.indexOf("?");
      const path = qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath;
      const query: Record<string, string> = {};
      if (qIdx >= 0) {
        const sp = new URLSearchParams(rawPath.slice(qIdx + 1));
        for (const [k, v] of sp.entries()) query[k] = v;
      }
      const body = msg.body ? JSON.parse(msg.body) : {};
      const method = msg.method;

      // ── Workspace ────────────────────────────────────────────────
      if (path === "/__host/workspace" && method === "GET") {
        return respond(200, { current: workspaceDir(), base: baseWorkspaceDir() });
      }
      if (path === "/__host/workspace" && method === "PUT") {
        const p = String(body.path ?? "");
        if (!p) return respond(400, { error: "path required" });
        setActiveWorkspace(p);
        return respond(200, { path: workspaceDir() });
      }
      if (path === "/__host/workspace/dated" && method === "POST") {
        const name = String(body.name ?? "");
        if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
          return respond(400, { error: "invalid folder name" });
        }
        const dir = join(baseWorkspaceDir(), name);
        setActiveWorkspace(dir);
        return respond(200, { path: dir });
      }
      if (path === "/__host/workspace/list" && method === "GET") {
        return respond(200, artifactFile.listDir(query.rel ?? "", query.root));
      }
      if (path === "/__host/artifact" && method === "GET") {
        return respond(200, artifactFile.readArtifact(query.path ?? "", query.root));
      }
      if (path === "/__host/notebooks" && method === "GET") {
        return respond(200, artifactFile.listNotebooks(query.root));
      }

      // ── Scheduler ────────────────────────────────────────────────
      if (path === "/__host/scheduler/tasks" && method === "GET") {
        return respond(200, cronEngine.listTasks());
      }
      if (path === "/__host/scheduler/tasks" && method === "POST") {
        const task = cronEngine.addTask(body);
        return respond(200, task);
      }
      const taskMatch = path.match(/^\/__host\/scheduler\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const id = taskMatch[1];
        if (method === "PATCH") {
          return respond(200, cronEngine.updateTask(id, body));
        }
        if (method === "DELETE") {
          cronEngine.removeTask(id);
          return respond(200, { ok: true });
        }
      }
      const toggleMatch = path.match(/^\/__host\/scheduler\/tasks\/([^/]+)\/toggle$/);
      if (toggleMatch && method === "POST") {
        return respond(200, cronEngine.toggleTask(toggleMatch[1], !!body.enabled));
      }
      const fireMatch = path.match(/^\/__host\/scheduler\/tasks\/([^/]+)\/fire$/);
      if (fireMatch && method === "POST") {
        return respond(200, await cronEngine.fireNow(fireMatch[1]));
      }
      if (path === "/__host/scheduler/history" && method === "GET") {
        const limit = query.limit ? Number(query.limit) : undefined;
        return respond(200, cronEngine.getHistory(query.taskId, limit));
      }
      if (path === "/__host/scheduler/history" && method === "DELETE") {
        cronEngine.clearHistory(query.taskId);
        return respond(200, { ok: true });
      }
      const execMatch = path.match(/^\/__host\/scheduler\/history\/([^/]+)$/);
      if (execMatch && method === "DELETE") {
        cronEngine.deleteExecution(execMatch[1]);
        return respond(200, { ok: true });
      }

      // ── Relay status ─────────────────────────────────────────────
      if (path === "/__host/relay/status" && method === "GET") {
        // Relay config lives in the default settings store under the "relay"
        // key (same place index.ts reads from on boot).
        const relay = getStore().get("relay") as Partial<RelayHostConfig> | undefined;
        return respond(200, {
          status: this.status,
          config: {
            enabled: !!relay?.enabled,
            relayUrl: relay?.relayUrl ?? "",
            deviceId: relay?.deviceId ?? "",
            tokenSet: !!relay?.token,
          },
        });
      }

      return respond(404, { error: `unknown host route: ${method} ${path}` });
    } catch (err) {
      respond(500, { error: (err as Error)?.message ?? "host api failed" });
    }
  }
}
