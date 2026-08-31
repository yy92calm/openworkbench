/**
 * Test-only guest client for the relay. The relay package is self-contained
 * (no dependency on the standalone `client/` project): this helper connects as
 * a guest over a raw `ws` socket and speaks the relay wire protocol
 * (../src/protocol).
 */

import { WebSocket as WsClient } from 'ws';

import type {
  RelayDeviceInfo,
  RelayListDevices,
  RelayMessage,
  RelayRequest,
  RelayResponseHead,
} from '../../src/protocol';

interface RelayGuestOptions {
  WebSocketImpl?: typeof WsClient;
}

interface Pending {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  stream: ReadableStream<Uint8Array>;
  buffered: string[];
  headResolve: (res: Response) => void;
  headReject: (err: Error) => void;
  headPromise: Promise<Response>;
  done: boolean;
}

let seq = 0;
function nextId(): string {
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
  return `r${seq}`;
}

export interface RelayGuest {
  connect(relayUrl: string, deviceId: string, token: string): Promise<void>;
  fetchImpl(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  close(): void;
}

/** Minimal fetch() over the relay WebSocket, mirroring the wire protocol used
 *  by the real client. Good enough to exercise the relay's forwarding. */
export function makeGuestTransport(opts: RelayGuestOptions = {}): RelayGuest {
  const Ws = opts.WebSocketImpl ?? WsClient;
  let ws: InstanceType<typeof Ws> | null = null;
  const pending = new Map<string, Pending>();

  const handleMessage = (raw: unknown): void => {
    let msg: RelayMessage | null = null;
    try {
      msg = JSON.parse(String(raw)) as RelayMessage;
    } catch {
      return;
    }
    // Room (peer) messages don't have an `id` — ignore them here.
    if (!('id' in msg)) return;
    const p = pending.get(msg.id);
    if (!p) return;
    switch (msg.type) {
      case 'head': {
        if (p.done) break;
        p.headResolve(
          new Response(p.stream, {
            status: msg.status,
            headers: new Headers(msg.headers ?? {}),
          }),
        );
        break;
      }
      case 'chunk': {
        if (!p.controller) {
          p.buffered.push(msg.chunk);
          break;
        }
        p.controller.enqueue(new TextEncoder().encode(msg.chunk));
        break;
      }
      case 'done': {
        if (p.done) break;
        p.done = true;
        pending.delete(msg.id);
        if (p.controller) {
          try {
            p.controller.close();
          } catch {
            /* closed */
          }
        }
        break;
      }
    }
  };

  return {
    async connect(relayUrl, deviceId, token) {
      this.close?.();
      const url = new URL(relayUrl);
      url.searchParams.set('role', 'guest');
      url.searchParams.set('device', deviceId);
      url.searchParams.set('token', token);
      ws = new Ws(url.toString());
      ws.on('open', () => {});
      ws.on('message', (data) => handleMessage(data));
      ws.on('error', (e) => {
        const err = new Error(`relay connection failed: ${(e as Error).message}`);
        for (const [, p] of pending) p.headReject(err);
      });
      ws.on('close', () => {
        const err = new Error('relay connection closed');
        for (const [id, p] of pending) {
          pending.delete(id);
          try {
            p.controller?.error(err);
          } catch {
            /* closed */
          }
          // Attach a noop to avoid unhandled rejections when the caller does not
          // await the head promise (e.g. expecting a failed pairing).
          p.headReject(err);
          Promise.resolve(p.headPromise).catch(() => {});
        }
      });
      await new Promise<void>((resolve, reject) => {
        ws!.once('open', () => resolve());
        ws!.once('error', (e) => reject(new Error((e as Error).message)));
        ws!.once('close', () => reject(new Error('relay connection closed before open')));
      });
    },
    async fetchImpl(input, init) {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);
      const headers: Record<string, string> = {};
      if (init?.headers)
        new Headers(init.headers).forEach((v, k) => {
          headers[k] = v;
        });
      const body = init?.body == null ? undefined : String(init.body);
      const msg: RelayRequest = {
        type: 'request',
        id: nextId(),
        method: init?.method ?? 'GET',
        path: url.pathname + url.search,
        ...(Object.keys(headers).length ? { headers } : {}),
        ...(body !== undefined ? { body } : {}),
      };
      const p: Pending = {
        controller: null,
        stream: null as unknown as ReadableStream<Uint8Array>,
        buffered: [],
        headResolve: () => {},
        headReject: () => {},
        headPromise: Promise.resolve(new Response(null, { status: 502 })),
        done: false,
      };
      p.stream = new ReadableStream<Uint8Array>({
        start(c) {
          p.controller = c;
          for (const chunk of p.buffered) c.enqueue(new TextEncoder().encode(chunk));
          p.buffered = [];
        },
      });
      pending.set(msg.id, p);
      const headPromise = new Promise<Response>((resolve, reject) => {
        p.headResolve = resolve;
        p.headReject = reject;
      });
      p.headPromise = headPromise;
      if (!ws || ws.readyState !== Ws.OPEN) throw new Error('relay not connected');
      ws.send(JSON.stringify(msg));
      return headPromise;
    },
    close() {
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}

/** Open a temporary guest (no device) connection, list registered devices,
 *  then close. Rejects on auth failure or protocol error. */
export function listAccountDevices(
  relayUrl: string,
  token: string,
  opts: RelayGuestOptions = {},
): Promise<RelayDeviceInfo[]> {
  const Ws = opts.WebSocketImpl ?? WsClient;
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new Ws(`${relayUrl}?role=guest&token=${token}`);
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      ws.close();
      fn();
    };
    ws.on('open', () => {
      const msg: RelayListDevices = { type: 'list-devices', id: 'devices' };
      ws.send(JSON.stringify(msg));
    });
    ws.on('message', (data) => {
      let parsed: RelayMessage | null = null;
      try {
        parsed = JSON.parse(String(data)) as RelayMessage;
      } catch {
        return;
      }
      if (parsed.type !== 'device-list' || parsed.id !== 'devices') return;
      done(() => resolve(parsed.devices));
    });
    ws.on('close', () => {
      if (!settled) reject(new Error('relay: connection closed without device-list (check token)'));
    });
    ws.on('error', (e) =>
      done(() => reject(new Error(`relay: connection failed: ${(e as Error).message}`))),
    );
  });
}

// Re-export for consumers that need the head message shape.
export type { RelayResponseHead };
