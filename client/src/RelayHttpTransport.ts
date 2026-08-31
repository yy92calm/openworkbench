import type { RelayDeviceInfo, RelayListDevices, RelayMessage, RelayRequest } from './protocol';

export type { RelayDeviceInfo } from './protocol';

/** Minimal WebSocket surface shared by browsers and the `ws` npm package. */
export interface WebSocketLike {
  readyState: number;
  addEventListener(
    type: string,
    listener: (ev: unknown) => void,
    options?: { once?: boolean },
  ): void;
  send(data: string): void;
  close(): void;
}

export interface WebSocketCtor {
  new (url: string): WebSocketLike;
  readonly OPEN: number;
}

export interface RelayHttpTransportOptions {
  /** WebSocket constructor. Browser: default global. Node: pass the `ws` one. */
  WebSocketImpl?: WebSocketCtor;
  /** Called when the underlying relay connection closes (not on close()). */
  onDisconnect?: () => void;
}

interface PendingRequest {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  stream: ReadableStream<Uint8Array>;
  /** Chunks that arrived before the head (hosts send head first, but keep the
   *  ordering guarantee regardless). */
  buffered: string[];
  headResolve: (res: Response) => void;
  headReject: (err: Error) => void;
  done: boolean;
}

let seq = 0;
function nextId(): string {
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
  return `r${seq}`;
}

/** fetch() polyfill that tunnels HTTP semantics over the relay WebSocket.
 *  Compatible with OpenCodeClient's expectations: res.ok, res.status,
 *  res.headers, and a res.body ReadableStream<Uint8Array> for SSE. */
export class RelayHttpTransport {
  private readonly wsCtor: WebSocketCtor;
  private ws: WebSocketLike | null = null;
  private opened: Promise<void> | null = null;
  /** (relayUrl, deviceId, token) the current connection was opened with. */
  private connectedTo: { url: string; device: string; token: string } | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly opts: RelayHttpTransportOptions;

  constructor(opts: RelayHttpTransportOptions = {}) {
    this.opts = opts;
    if (opts.WebSocketImpl) {
      this.wsCtor = opts.WebSocketImpl;
    } else if (typeof WebSocket !== 'undefined') {
      this.wsCtor = WebSocket as unknown as WebSocketCtor;
    } else {
      throw new Error(
        'RelayHttpTransport needs a WebSocket implementation (pass WebSocketImpl in Node)',
      );
    }
  }

  /** Open the guest WebSocket to the relay. Resolves once connected. If this
   *  transport is already connected to the same (relay, device, token), the
   *  existing connection is reused; a different set tears the old one down and
   *  reconnects (a transport is single-session). */
  connect(relayUrl: string, deviceId: string, token: string): Promise<void> {
    if (
      this.opened &&
      this.connectedTo &&
      this.connectedTo.url === relayUrl &&
      this.connectedTo.device === deviceId &&
      this.connectedTo.token === token
    ) {
      return this.opened;
    }
    // Different target than the live connection — rebuild it.
    this.close();
    this.connectedTo = { url: relayUrl, device: deviceId, token };
    const url = new URL(relayUrl);
    url.searchParams.set('role', 'guest');
    url.searchParams.set('device', deviceId);
    url.searchParams.set('token', token);
    const ws = new this.wsCtor(url.toString());
    this.ws = ws;
    ws.addEventListener('message', (ev) => this.handleMessage((ev as { data: unknown }).data));
    ws.addEventListener('close', () => {
      // Only report unexpected disconnects (not close()).
      const wasOpen = this.opened !== null && this.ws === ws;
      const err = new Error('relay connection closed');
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        try {
          p.controller?.error(err);
        } catch {
          /* already closed */
        }
        p.headReject(err);
      }
      if (wasOpen && this.ws === ws) {
        this.opened = null;
        this.connectedTo = null;
        this.opts.onDisconnect?.();
      }
    });
    this.opened = new Promise((resolveOpen, rejectOpen) => {
      ws.addEventListener('open', () => resolveOpen(), { once: true });
      ws.addEventListener('error', () => rejectOpen(new Error('relay connection failed')), {
        once: true,
      });
    });
    return this.opened;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.opened = null;
    this.connectedTo = null;
  }

  /** fetch-compatible signature — pass directly as OpenCodeClient's fetchImpl.
   *  Accepts absolute URLs (e.g. `http://relay/session`), relative paths
   *  (e.g. `/__host/workspace`), URL instances, and Request objects. Relative
   *  paths are resolved against a synthetic base — only pathname+search are
   *  forwarded to the relay anyway. */
  fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? new URL(input, 'http://relay.local')
        : input instanceof URL
          ? input
          : new URL(input.url, 'http://relay.local');
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => {
        headers[k] = v;
      });
    }
    const body = init?.body == null ? undefined : stringifyBody(init.body);
    const msg: RelayRequest = {
      type: 'request',
      id: nextId(),
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
    };
    return this.roundTrip(msg);
  };

  private roundTrip(msg: RelayRequest): Promise<Response> {
    const ws = this.ws;
    if (!ws || ws.readyState !== this.wsCtor.OPEN) {
      return Promise.reject(new Error('relay not connected'));
    }
    const pending: PendingRequest = {
      controller: null,
      stream: null as unknown as ReadableStream<Uint8Array>,
      buffered: [],
      headResolve: () => {},
      headReject: () => {},
      done: false,
    };
    // start() runs synchronously at construction, so pending.controller is set
    // before any WebSocket message can arrive.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        pending.controller = controller;
        for (const c of pending.buffered) controller.enqueue(new TextEncoder().encode(c));
        pending.buffered = [];
      },
    });
    pending.stream = stream;
    const headPromise = new Promise<Response>((res, rej) => {
      pending.headResolve = res;
      pending.headReject = rej;
    });
    this.pending.set(msg.id, pending);
    ws.send(JSON.stringify(msg));
    return headPromise;
  }

  private handleMessage(data: unknown): void {
    let msg: RelayMessage | null = null;
    try {
      msg = JSON.parse(String(data)) as RelayMessage;
    } catch {
      return;
    }
    // Room (peer) messages don't have an `id` — they're handled by a separate
    // WebSocket connection in roomConnection.ts, not this transport. Ignore them.
    if (!('id' in msg)) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    switch (msg.type) {
      case 'head': {
        if (p.done) break;
        try {
          // Status 204/205/304 must not carry a body per the fetch spec, and a
          // stream that was already locked/consumed (e.g. the SSE stream read
          // while the host dropped) cannot be re-wrapped — Response would throw
          // on construction. Resolve with a null body in both cases.
          const noBody =
            msg.status === 204 || msg.status === 205 || msg.status === 304 || p.stream.locked;
          if (noBody) {
            p.headResolve(
              new Response(null, {
                status: msg.status,
                headers: new Headers(msg.headers ?? {}),
              }),
            );
          } else {
            p.headResolve(
              new Response(p.stream, {
                status: msg.status,
                headers: new Headers(msg.headers ?? {}),
              }),
            );
          }
        } catch (e) {
          console.error('RELAY-DEBUG head id=', msg.id, 'err:', (e as Error).message);
          throw e;
        }
        break;
      }
      case 'chunk': {
        if (!p.controller) {
          p.buffered.push(msg.chunk);
          break;
        }
        try {
          p.controller.enqueue(new TextEncoder().encode(msg.chunk));
        } catch {
          /* stream closed */
        }
        break;
      }
      case 'done': {
        if (p.done) break;
        p.done = true;
        this.pending.delete(msg.id);
        if (p.controller) {
          try {
            p.controller.close();
          } catch {
            /* already closed */
          }
        }
        break;
      }
    }
  }
}

function stringifyBody(body: BodyInit): string | undefined {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  // Blob / FormData / ReadableStream are not used by the SDK — reject loudly.
  throw new Error('relay transport: unsupported body type');
}

/**
 * Control-plane call: list the devices registered under an account token
 * (each with its online status), without opening a data connection. Used by
 * the client login flow to let the user pick which desktop machine to pair
 * with — online devices first.
 *
 * Opens a temporary guest connection (no device), sends one list-devices
 * message, resolves with the device list, then closes. Rejects on auth failure
 * (wrong token) or any protocol error.
 */
export function listAccountDevices(
  relayUrl: string,
  token: string,
  opts: RelayHttpTransportOptions = {},
): Promise<RelayDeviceInfo[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      ws.close();
      fn();
    };
    let wsCtor = opts.WebSocketImpl;
    if (!wsCtor) {
      if (typeof WebSocket !== 'undefined') wsCtor = WebSocket as unknown as WebSocketCtor;
      else
        throw new Error(
          'listAccountDevices needs a WebSocket implementation (pass WebSocketImpl in Node)',
        );
    }
    const url = new URL(relayUrl);
    url.searchParams.set('role', 'guest');
    url.searchParams.set('token', token);
    const ws = new wsCtor(url.toString());
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      done(() => reject(new Error('relay: timed out waiting for device-list')));
    }, 15_000);
    const msg: RelayListDevices = { type: 'list-devices', id: 'devices' };
    ws.addEventListener('open', () => ws.send(JSON.stringify(msg)), { once: true });
    ws.addEventListener('message', (ev) => {
      let parsed: RelayMessage | null = null;
      try {
        parsed = JSON.parse(String((ev as { data: unknown }).data)) as RelayMessage;
      } catch {
        return;
      }
      if (parsed.type !== 'device-list' || parsed.id !== msg.id) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      done(() => resolve(parsed.devices));
    });
    ws.addEventListener('close', () => {
      if (settled) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      reject(new Error('relay: connection closed without device-list (check token)'));
    });
    ws.addEventListener('error', () => {
      done(() => reject(new Error('relay: connection failed')));
    });
  });
}
