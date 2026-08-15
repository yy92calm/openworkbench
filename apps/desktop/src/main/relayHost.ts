import { WebSocket } from "ws";
import type { RelayMessage } from "@workbench/client";
import { getServerUrl, getServerPassword } from "./server";

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

  /** Guest request → local sidecar → head/chunk/done back through the socket. */
  private async handleMessage(data: unknown): Promise<void> {
    let msg: RelayMessage | null = null;
    try {
      msg = JSON.parse(String(data)) as RelayMessage;
    } catch {
      return;
    }
    if (!msg || msg.type !== "request") return;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

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
    try {
      const res = await fetch(`${sidecarUrl}${msg.path}`, {
        method: msg.method,
        headers,
        ...(msg.body !== undefined ? { body: msg.body } : {}),
      });
      ws.send(JSON.stringify({
        type: "head",
        id: msg.id,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
      }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text) ws.send(JSON.stringify({ type: "chunk", id: msg.id, chunk: text }));
      }
      ws.send(JSON.stringify({ type: "done", id: msg.id }));
    } catch {
      ws.send(JSON.stringify({ type: "head", id: msg.id, status: 502, headers: {} }));
      ws.send(JSON.stringify({ type: "done", id: msg.id }));
    }
  }
}
