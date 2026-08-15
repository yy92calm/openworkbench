import { RelayHttpTransport, listAccountDevices, type RelayDeviceInfo } from "../client";
import { OpenCodeClient } from "@workbench/sdk";

export type { RelayDeviceInfo } from "../client";

export interface ConnectionConfig {
  relayUrl: string;
  /** Last-selected device; empty until the user picks one. */
  deviceId: string;
  /** Account token — the login credential itself. */
  token: string;
}

const CONFIG_KEY = "workbench.remote.config";

let transport: RelayHttpTransport | null = null;
let client: OpenCodeClient | null = null;
let cfg: ConnectionConfig | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
/** Fired after an automatic reconnect succeeds, so views can re-fetch. */
const reconnectListeners = new Set<() => void>();

export function onReconnect(cb: () => void): () => void {
  reconnectListeners.add(cb);
  return () => reconnectListeners.delete(cb);
}

export function loadConfig(): ConnectionConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as ConnectionConfig;
    if (!c.relayUrl || !c.token) return null;
    return { ...c, deviceId: c.deviceId ?? "" };
  } catch {
    return null;
  }
}

export function saveConfig(c: ConnectionConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

export function clearConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

/** Login step: list the devices registered under the account token, with
 *  online status (online first). */
export async function listDevices(relayUrl: string, token: string): Promise<RelayDeviceInfo[]> {
  return listAccountDevices(relayUrl, token);
}

function makeTransport(): RelayHttpTransport {
  return new RelayHttpTransport({
    // Auto-reconnect with exponential backoff when the relay drops us.
    onDisconnect: () => void scheduleReconnect(),
  });
}

async function buildClient(t: RelayHttpTransport, c: ConnectionConfig): Promise<OpenCodeClient> {
  await t.connect(c.relayUrl, c.deviceId, c.token);
  const c2 = new OpenCodeClient({
    baseUrl: "http://relay",
    fetchImpl: t.fetchImpl,
  });
  // Open the SSE /event stream (via the relay transport's streaming fetch) so
  // onEvent subscribers get live text/tool/idle updates.
  await c2.connect();
  return c2;
}

/** Reconnect after an unexpected disconnect. Keeps retrying with backoff. */
function scheduleReconnect(): void {
  if (!cfg || reconnectTimer) return;
  const delay = Math.min(1_000 * 2 ** attempts, 30_000);
  attempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void (async () => {
      if (!cfg) return;
      try {
        const t = makeTransport();
        const next = await buildClient(t, cfg);
        client?.close();
        client = next;
        transport = t;
        attempts = 0;
        for (const cb of reconnectListeners) cb();
      } catch {
        scheduleReconnect(); // keep trying
      }
    })();
  }, delay);
}

/** Connect to a specific device's sidecar through the relay. Idempotent:
 *  returns the existing client when already connected. */
export async function connect(c: ConnectionConfig): Promise<OpenCodeClient> {
  if (client) return client;
  if (!c.deviceId) throw new Error("请先选择设备");
  cfg = c;
  const t = makeTransport();
  client = await buildClient(t, c);
  transport = t;
  // The sidecar password is host-local; RelayHttpTransport requests are
  // re-authed by the host. No password here — the client never learns it.
  saveConfig(c);
  return client;
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  cfg = null;
  attempts = 0;
  client?.close();
  client = null;
  transport?.close();
  transport = null;
}

export function getClient(): OpenCodeClient | null {
  return client;
}

export function isConnected(): boolean {
  return client !== null;
}
