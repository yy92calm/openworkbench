import { WebSocket } from "ws";
// Local copy of the relay wire protocol (contract between the three projects:
// Workbench host, relay, remote client). Keep in sync with relay/src/protocol.ts
// and client/src/protocol.ts — changes to the relay server must be mirrored here.
import type { RelayMessage } from "./relay-protocol";
import { getServerUrl, getServerPassword, workspaceDir } from "./server";
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

  getStatus(): RelayHostStatus {
    return this.status;
  }

  onStatusChange(cb: (s: RelayHostStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
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
          if (text) ws.send(JSON.stringify({ type: "chunk", id: msg.id, chunk: text }));
        }
      }
      ws.send(JSON.stringify({ type: "done", id: msg.id }));
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
}
