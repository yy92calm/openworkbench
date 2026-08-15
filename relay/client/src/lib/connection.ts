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

export function loadConfig(): ConnectionConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as ConnectionConfig;
    if (!cfg.relayUrl || !cfg.token) return null;
    return { ...cfg, deviceId: cfg.deviceId ?? "" };
  } catch {
    return null;
  }
}

export function saveConfig(cfg: ConnectionConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function clearConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

/** Login step: list the devices registered under the account token, with
 *  online status (online first). */
export async function listDevices(relayUrl: string, token: string): Promise<RelayDeviceInfo[]> {
  return listAccountDevices(relayUrl, token);
}

/** Connect to a specific device's sidecar through the relay. Idempotent:
 *  returns the existing client when already connected. */
export async function connect(cfg: ConnectionConfig): Promise<OpenCodeClient> {
  if (client) return client;
  if (!cfg.deviceId) throw new Error("请先选择设备");
  const t = new RelayHttpTransport();
  await t.connect(cfg.relayUrl, cfg.deviceId, cfg.token);
  transport = t;
  // The sidecar password is host-local; RelayHttpTransport requests are
  // re-authed by the host. No password here — the client never learns it.
  client = new OpenCodeClient({
    baseUrl: "http://relay",
    fetchImpl: t.fetchImpl,
  });
  saveConfig(cfg);
  return client;
}

export function disconnect(): void {
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