import { RelayHttpTransport, listAccountDevices, type RelayDeviceInfo } from "../client";
import { OpenCodeClient, HostClient } from "@workbench/sdk";

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
  // Login = establishing the relay transport. This only depends on the relay
  // being up — the host sidecar does NOT need to be online. SSE /event is
  // opened separately below and retried in the background until the host
  // comes online, so the user can still see the device list / sessions.
  await t.connect(c.relayUrl, c.deviceId, c.token);
  const c2 = new OpenCodeClient({
    baseUrl: "http://relay",
    fetchImpl: t.fetchImpl,
  });
  // Kick off SSE in the background. Failures (host offline → 502) do not
  // block login; OpenCodeClient.status will flip to "ready" once it opens,
  // and views already track that status to show the "host offline" banner.
  void ensureEventStream(c2);
  return c2;
}

/** Keep retrying the SSE /event stream until it opens. Host offline returns
 *  502 — we back off and try again so the user is connected the moment the
 *  host comes back online. Resolves once the stream opens; never throws. */
async function ensureEventStream(c: OpenCodeClient): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await c.connect();
      return;
    } catch {
      const delay = Math.min(1_500 * 2 ** Math.min(attempt, 5), 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/** Device-sheet event bus: lets any tab request that the global DeviceBar
 *  open its device picker (e.g. a "请先选择设备" CTA in SessionsPage). */
const openSheetListeners = new Set<() => void>();

export function openDeviceSheet(): void {
  for (const cb of openSheetListeners) {
    try { cb(); } catch { /* listener errors are isolated */ }
  }
}

export function onOpenDeviceSheet(cb: () => void): () => void {
  openSheetListeners.add(cb);
  return () => openSheetListeners.delete(cb);
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

/** Logged in = a relay+token config is saved (deviceId may be empty, in which
 *  case isConnected() is still false). Used by App.tsx to decide whether to
 *  show the ConnectPage or the main shell with a DeviceBar CTA. */
export function isLoggedIn(): boolean {
  return cfg !== null;
}

/** The live relay transport (for HostClient to reuse its fetchImpl). Null when
 *  not connected. */
export function getTransport(): RelayHttpTransport | null {
  return transport;
}

/** Lazily build a HostClient backed by the current relay transport. Throws if
 *  not connected — call from inside a view that only renders after connect. */
export function getHostClient(): HostClient {
  if (!transport) throw new Error("relay not connected");
  return new HostClient(transport.fetchImpl);
}
