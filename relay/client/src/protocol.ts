/** Wire protocol for the Workbench remote relay.
 *
 * Messages are JSON text frames on the WebSocket. Two roles:
 *  - host  (the machine running the Workbench sidecar)
 *  - guest (the remote client — Web/PWA or Electron)
 *
 * Flow: guest sends a request, the relay routes it to the host, the host
 * replies with head → (chunk)* → done. The relay itself is a pure byte
 * forwarder: it never parses payloads and keeps no request content.
 */

/** Guest → host: an HTTP request to perform against the local sidecar. */
export interface RelayRequest {
  type: "request";
  /** Unique request id — enables concurrent requests on one socket. */
  id: string;
  method: string;
  /** Path + query, e.g. "/session/abc/message?directory=/ws" */
  path: string;
  headers?: Record<string, string>;
  /** UTF-8 text body (the sidecar API is JSON/SSE text only). */
  body?: string;
}

/** Host → guest: response status line. Always precedes chunks. */
export interface RelayResponseHead {
  type: "head";
  id: string;
  status: number;
  headers: Record<string, string>;
}

/** Host → guest: one body chunk (SSE frames ride these). */
export interface RelayChunk {
  type: "chunk";
  id: string;
  chunk: string;
}

/** Host → guest: response finished; the guest closes the fetch stream. */
export interface RelayDone {
  type: "done";
  id: string;
}

/** Guest → relay (control): list the devices registered under the account
 *  (only valid on a guest connection without a device, i.e. device="" ). */
export interface RelayListDevices {
  type: "list-devices";
  id: string;
}

/** One registered device in a device-list reply. */
export interface RelayDeviceInfo {
  device: string;
  /** Whether the device's host is currently connected to the relay. */
  online: boolean;
}

/** Relay → guest: reply to list-devices. */
export interface RelayDeviceList {
  type: "device-list";
  id: string;
  devices: RelayDeviceInfo[];
}

export type RelayMessage = RelayRequest | RelayResponseHead | RelayChunk | RelayDone | RelayListDevices | RelayDeviceList;

/** Connection query params: ?role=host|guest&token=<accountToken>[&device=<deviceId>]
 *  device is required for host and for guest data connections; a guest control
 *  connection (listing devices before pairing) may omit it. */
export interface RelayConnectionParams {
  role: "host" | "guest";
  device: string;
  token: string;
}

export function parseConnectionParams(url: string): RelayConnectionParams | null {
  try {
    // req.url is a relative path (no host) — supply a base for URL parsing.
    const u = new URL(url, "http://relay.local");
    const role = u.searchParams.get("role");
    const token = u.searchParams.get("token");
    if (role !== "host" && role !== "guest") return null;
    if (!token) return null;
    return { role, device: u.searchParams.get("device") ?? "", token };
  } catch {
    return null;
  }
}
