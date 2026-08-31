import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { RelayMessage } from '../src/protocol';
import { AccountRegistry } from '../src/registry';
import { RelayServer } from '../src/server';
import { listAccountDevices, makeGuestTransport, type RelayGuest } from './helpers/relay-guest';

const TOKEN = 'test-secret';
const TOKEN2 = 'account-two';
const DEVICE = 'device-1';

/** A fake HTTP server standing in for the OpenCode sidecar on the host. */
function startFakeSidecar(): Promise<{ server: Server; port: number }> {
  const server = createHttpServer((req, res) => {
    if (req.url?.startsWith('/sse')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"n":1}\n\n');
      setTimeout(() => res.write('data: {"n":2}\n\n'), 20);
      setTimeout(() => res.end(), 40);
      return;
    }
    if (req.url?.startsWith('/echo')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, path: req.url, body }));
      });
      return;
    }
    if (req.url?.startsWith('/headers')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
      return;
    }
    res.writeHead(404).end('nope');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

interface FakeHostOpts {
  token?: string;
  device?: string;
  sidecarPort?: number;
  /** Reply directly (no sidecar) — used to test offline hosts without one. */
  direct?: boolean;
}

/** A host WebSocket client that forwards relay requests to the fake sidecar. */
function startFakeHost(relayUrl: string, opts: FakeHostOpts = {}): Promise<WebSocket> {
  const token = opts.token ?? TOKEN;
  const device = opts.device ?? DEVICE;
  const ws = new WebSocket(`${relayUrl}?role=host&device=${device}&token=${token}`);
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as RelayMessage & { type: 'request' };
    if (msg.type !== 'request') return;
    void (async () => {
      const sidecarPort = opts.sidecarPort;
      if (opts.direct || sidecarPort == null) {
        // No sidecar: reply with a canned 200 so the request completes.
        ws.send(
          JSON.stringify({
            type: 'head',
            id: msg.id,
            status: 200,
            headers: {},
          } satisfies RelayMessage),
        );
        ws.send(JSON.stringify({ type: 'done', id: msg.id } satisfies RelayMessage));
        return;
      }
      const res = await fetch(`http://127.0.0.1:${sidecarPort}${msg.path}`, {
        method: msg.method,
        headers: msg.headers,
        ...(msg.body !== undefined ? { body: msg.body } : {}),
      });
      const head: RelayMessage = {
        type: 'head',
        id: msg.id,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
      };
      ws.send(JSON.stringify(head));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        // Split the SSE frame arbitrarily to exercise chunking.
        for (const c of text.match(/.{1,7}/gs) ?? []) {
          ws.send(JSON.stringify({ type: 'chunk', id: msg.id, chunk: c } satisfies RelayMessage));
        }
      }
      ws.send(JSON.stringify({ type: 'done', id: msg.id } satisfies RelayMessage));
    })();
  });
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

function makeGuest(_relayUrl: string): RelayGuest {
  return makeGuestTransport({ WebSocketImpl: WebSocket });
}

const servers: RelayServer[] = [];
const sidecars: Server[] = [];

async function setup(
  opts: {
    adminTokens?: string[];
    dataDir?: string;
    staticDir?: string;
    adminPassword?: string;
    adminStaticDir?: string;
  } = {},
): Promise<{
  relayUrl: string;
  sidecarPort: number;
  relay: RelayServer;
}> {
  const relay = new RelayServer({ port: 0, authToken: TOKEN, ...opts });
  const port = await relay.listen();
  servers.push(relay);
  const sidecar = await startFakeSidecar();
  sidecars.push(sidecar.server);
  return { relayUrl: `ws://127.0.0.1:${port}`, sidecarPort: sidecar.port, relay };
}

afterEach(async () => {
  for (const s of sidecars.splice(0)) s.close();
  for (const s of servers.splice(0)) await s.close();
});

describe('RelayServer + RelayHttpTransport', () => {
  it('forwards a simple GET with JSON body', async () => {
    const { relayUrl, sidecarPort } = await setup();
    await startFakeHost(relayUrl, { sidecarPort });
    const guest = makeGuest(relayUrl);
    await guest.connect(relayUrl, DEVICE, TOKEN);

    const res = await guest.fetchImpl('http://relay/echo?q=1');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { method: string; path: string; body: string };
    expect(json.method).toBe('GET');
    expect(json.path).toBe('/echo?q=1');
    expect(json.body).toBe('');
  });

  it('forwards POST body and method', async () => {
    const { relayUrl, sidecarPort } = await setup();
    await startFakeHost(relayUrl, { sidecarPort });
    const guest = makeGuest(relayUrl);
    await guest.connect(relayUrl, DEVICE, TOKEN);

    const res = await guest.fetchImpl('http://relay/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    const json = (await res.json()) as { method: string; body: string };
    expect(json.method).toBe('POST');
    expect(JSON.parse(json.body)).toEqual({ hello: 'world' });
  });

  it('passes Authorization headers through to the sidecar', async () => {
    const { relayUrl, sidecarPort } = await setup();
    await startFakeHost(relayUrl, { sidecarPort });
    const guest = makeGuest(relayUrl);
    await guest.connect(relayUrl, DEVICE, TOKEN);

    const res = await guest.fetchImpl('http://relay/headers', {
      headers: { authorization: 'Basic dGVzdDpwdw==' },
    });
    const json = (await res.json()) as { auth: string | null };
    expect(json.auth).toBe('Basic dGVzdDpwdw==');
  });

  it('streams SSE chunks in order', async () => {
    const { relayUrl, sidecarPort } = await setup();
    await startFakeHost(relayUrl, { sidecarPort });
    const guest = makeGuest(relayUrl);
    await guest.connect(relayUrl, DEVICE, TOKEN);

    const res = await guest.fetchImpl('http://relay/sse', {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('data: {"n":1}\n\ndata: {"n":2}\n\n');
  });

  it('handles concurrent requests with correct id routing', async () => {
    const { relayUrl, sidecarPort } = await setup();
    await startFakeHost(relayUrl, { sidecarPort });
    const guest = makeGuest(relayUrl);
    await guest.connect(relayUrl, DEVICE, TOKEN);

    const [a, b, c] = await Promise.all([
      guest.fetchImpl('http://relay/echo?a=1').then((r) => r.json()),
      guest.fetchImpl('http://relay/echo?b=2').then((r) => r.json()),
      guest.fetchImpl('http://relay/echo?c=3').then((r) => r.json()),
    ]);
    expect((a as { path: string }).path).toBe('/echo?a=1');
    expect((b as { path: string }).path).toBe('/echo?b=2');
    expect((c as { path: string }).path).toBe('/echo?c=3');
  });

  it('returns 502 when the registered host is offline', async () => {
    const { relayUrl } = await setup();
    // Register the device with a host, then take it offline.
    const host = await startFakeHost(relayUrl);
    host.close();
    await new Promise((r) => setTimeout(r, 20));
    const guest = makeGuest(relayUrl);
    await guest.connect(relayUrl, DEVICE, TOKEN);
    const res = await guest.fetchImpl('http://relay/echo');
    expect(res.status).toBe(502);
  });

  it('rejects guest pairing with a device not registered under the account', async () => {
    const { relayUrl } = await setup();
    const guest = makeGuest(relayUrl);
    await guest.connect(relayUrl, 'never-registered', TOKEN);
    // The server closes the socket (4003) right after open — the first request
    // must fail, not silently hang.
    await expect(guest.fetchImpl('http://relay/echo')).rejects.toThrow(
      /relay not connected|connection closed/,
    );
  });

  it('rejects connections with a wrong token', async () => {
    const { relayUrl } = await setup();
    const guest = makeGuest(relayUrl);
    await expect(guest.connect(relayUrl, DEVICE, 'wrong-token')).rejects.toThrow();
  });

  it('rebuilds the connection when connect() is called with a different device (no stale reuse)', async () => {
    const { relayUrl, sidecarPort } = await setup();
    await startFakeHost(relayUrl, { sidecarPort });
    const guest = makeGuest(relayUrl);
    // First connect: an unregistered device — the server rejects (4003) soon after
    // open. The transport reports connected, then requests fail.
    await guest.connect(relayUrl, 'reg-a', TOKEN);
    await expect(guest.fetchImpl('http://relay/echo')).rejects.toThrow(
      /relay not connected|connection closed/,
    );
    // Re-connect with the registered device: connect() must NOT reuse the dead
    // connection — it rebuilds and a request reaches the host.
    await guest.connect(relayUrl, DEVICE, TOKEN);
    const res = await guest.fetchImpl('http://relay/echo?q=rebuild');
    expect(res.status).toBe(200);
    guest.close();
  });

  it('reuses a live connection when connect() is called with the same parameters', async () => {
    const { relayUrl, sidecarPort } = await setup();
    await startFakeHost(relayUrl, { sidecarPort });
    const guest = makeGuest(relayUrl);
    await guest.connect(relayUrl, DEVICE, TOKEN);
    await guest.connect(relayUrl, DEVICE, TOKEN); // same params — reusable
    const res = await guest.fetchImpl('http://relay/echo?q=same');
    expect(res.status).toBe(200);
    guest.close();
  });

  it('lists registered devices with online status for an account', async () => {
    const { relayUrl, sidecarPort } = await setup();
    // desk-a and device-1 are online (host connected); desk-b registered but offline.
    await startFakeHost(relayUrl, { sidecarPort, device: 'desk-a' });
    await startFakeHost(relayUrl, { sidecarPort, device: DEVICE });
    const hostB = await startFakeHost(relayUrl, { sidecarPort, device: 'desk-b' });
    hostB.close();
    await new Promise((r) => setTimeout(r, 20));

    const devices = await listAccountDevices(relayUrl, TOKEN, { WebSocketImpl: WebSocket });
    // Sorted by device id (registration order, as in listDevices).
    expect(devices).toEqual([
      { device: 'desk-a', online: true },
      { device: 'desk-b', online: false },
      { device: DEVICE, online: true },
    ]);
  });

  it('rejects listAccountDevices with a wrong token', async () => {
    const { relayUrl } = await setup();
    await expect(
      listAccountDevices(relayUrl, 'nope', { WebSocketImpl: WebSocket }),
    ).rejects.toThrow();
  });

  it('isolates devices per account (same device id, different accounts)', async () => {
    const { relayUrl, sidecarPort } = await setup({ adminTokens: [TOKEN2] });
    // Both accounts use the same device id — routing must not collide.
    await startFakeHost(relayUrl, { sidecarPort, device: DEVICE, token: TOKEN });
    await startFakeHost(relayUrl, { sidecarPort, device: DEVICE, token: TOKEN2, direct: true });

    const guest1 = makeGuest(relayUrl);
    await guest1.connect(relayUrl, DEVICE, TOKEN);
    const res1 = await guest1.fetchImpl('http://relay/echo');
    expect(res1.status).toBe(200); // routed to account 1's sidecar-backed host

    // Account 2's guest pairs the same device id but must reach account 2's
    // own host (direct → 200), never account 1's.
    const guest2 = makeGuest(relayUrl);
    await guest2.connect(relayUrl, DEVICE, TOKEN2);
    expect((await guest2.fetchImpl('http://relay/echo:1')).status).toBe(200);
  });

  it('persists the account registry to disk and loads it back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-registry-'));
    const { relayUrl, sidecarPort } = await setup({ dataDir: dir });
    await startFakeHost(relayUrl, { sidecarPort, device: 'persisted-dev' });

    // Give the registry a moment to flush, then verify the file.
    await new Promise((r) => setTimeout(r, 50));
    const raw = JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8')) as Record<
      string,
      { note?: string; devices: string[] }
    >;
    expect(raw[TOKEN].devices).toContain('persisted-dev');

    // A fresh registry instance reads the same accounts/devices back.
    const reloaded = new AccountRegistry(dir, { watch: false });
    expect(reloaded.hasAccount(TOKEN)).toBe(true);
    expect(reloaded.listDevices(TOKEN)).toContain('persisted-dev');
  });

  it('admin CLI registry: upsert, list, remove', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-registry-admin-'));
    const reg = new AccountRegistry(dir, { watch: false });

    reg.upsertAccount('tok-a', 'Alice');
    reg.upsertAccount('tok-b');
    reg.registerDevice('tok-a', 'd1');
    reg.registerDevice('tok-a', 'd2');
    reg.registerDevice('tok-b', 'd3');

    expect(reg.listDevices('tok-a').sort()).toEqual(['d1', 'd2']);
    expect(reg.listDevices('tok-b')).toEqual(['d3']);
    expect(reg.hasDevice('tok-a', 'd1')).toBe(true);
    expect(reg.hasDevice('tok-b', 'd1')).toBe(false);

    expect(reg.removeAccount('tok-b')).toBe(true);
    expect(reg.removeAccount('tok-b')).toBe(false);
    expect(reg.hasAccount('tok-b')).toBe(false);
    // A removed account must not resurrect from the on-disk snapshot.
    expect(reg.listAccounts().map((a) => a.token)).toEqual(['tok-a']);
  });

  it('hot-reloads account removal: admin CLI removes an account and the live relay kicks its connections', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-registry-hot-'));
    const { relayUrl } = await setup({ dataDir: dir });
    const host = await startFakeHost(relayUrl);
    // Give the registry time to flush its file, then remove the account via a
    // second process (like the admin CLI, but watching off in the same test —
    // simulate the CLI write).
    await new Promise((r) => setTimeout(r, 50));
    const gone = new AccountRegistry(dir, { watch: false });
    gone.removeAccount(TOKEN);

    // The live relay watches the file and should terminate the host socket.
    await new Promise((r) => setTimeout(r, 200));
    expect(host.readyState).toBe(WebSocket.CLOSED);
  });

  it('serves static files from staticDir with SPA fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-static-'));
    writeFileSync(join(dir, 'index.html'), '<html>app shell</html>');
    writeFileSync(join(dir, 'app.js'), 'console.log(1)');
    const { relayUrl } = await setup({ staticDir: dir });

    const base = relayUrl.replace(/^ws:/, 'http:');
    const page = await fetch(`${base}/`);
    expect(await page.text()).toBe('<html>app shell</html>');
    const asset = await fetch(`${base}/app.js`);
    expect(await asset.text()).toBe('console.log(1)');
    const fallback = await fetch(`${base}/some/route`);
    expect(await fallback.text()).toBe('<html>app shell</html>');
  });
});

// ── Admin API ─────────────────────────────────────────────────────────────
describe('Admin API', () => {
  const ADMIN_PW = 'hunter2';
  let base = '';
  let cookie = '';

  async function loginAdmin(): Promise<string> {
    const res = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PW }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    const sid = setCookie.split(';')[0];
    expect(sid).toContain('admin_session=');
    return sid;
  }

  async function authed(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${base}/api/admin${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), cookie },
    });
  }

  beforeEach(async () => {
    const { relayUrl } = await setup({ adminPassword: ADMIN_PW });
    base = relayUrl.replace(/^ws:/, 'http:');
    cookie = '';
  });

  it('rejects wrong password and lets right password in (sets HttpOnly session cookie)', async () => {
    const bad = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(bad.status).toBe(401);

    cookie = await loginAdmin();
    const sc = (await fetch(`${base}/api/admin/accounts`, { headers: { cookie } })).status;
    expect(sc).toBe(200);
  });

  it('requires a session for admin endpoints', async () => {
    const anon = await fetch(`${base}/api/admin/accounts`);
    expect(anon.status).toBe(401);
  });

  it('creates, lists (with online status), removes accounts and devices', async () => {
    cookie = await loginAdmin();

    // Create an account via the API.
    const created = await authed('/accounts', {
      method: 'POST',
      body: JSON.stringify({ token: 'tok-api', note: 'via api' }),
    });
    expect(created.status).toBe(200);

    // Online status: start a host for tok-api (the legacy TOKEN account is
    // seeded by setup so it also shows up; we only assert on tok-api).
    const host = new WebSocket(
      `${base.replace(/^http:/, 'ws:')}?role=host&device=dev-a&token=tok-api`,
    );
    await new Promise<void>((r) => {
      host.on('open', () => r());
    });

    const accounts = (await (await authed('/accounts')).json()) as {
      accounts: Array<{ token: string; devices: Array<{ device: string; online: boolean }> }>;
    };
    const found = accounts.accounts.find((a) => a.token === 'tok-api');
    expect(found?.devices).toEqual([{ device: 'dev-a', online: true }]);

    // Add another device offline: register it in the registry directly.
    // (registry is internal; use the account registration via a second host then close it)
    const host2 = new WebSocket(
      `${base.replace(/^http:/, 'ws:')}?role=host&device=dev-b&token=tok-api`,
    );
    await new Promise<void>((r) => host2.on('open', () => r()));
    host2.close();
    await new Promise((r) => setTimeout(r, 30));

    const after = (await (await authed('/accounts')).json()) as {
      accounts: Array<{ token: string; devices: Array<{ device: string; online: boolean }> }>;
    };
    const devB = after.accounts
      .find((a) => a.token === 'tok-api')
      ?.devices.find((d) => d.device === 'dev-b');
    expect(devB).toEqual({ device: 'dev-b', online: false });

    host.close();

    // Delete device dev-b.
    const delDev = await authed('/accounts/tok-api/devices/dev-b', { method: 'DELETE' });
    expect(delDev.status).toBe(200);
    const afterDel = (await (await authed('/accounts')).json()) as {
      accounts: Array<{ token: string; devices: Array<{ device: string }> }>;
    };
    const devList =
      afterDel.accounts.find((a) => a.token === 'tok-api')?.devices.map((d) => d.device) ?? [];
    expect(devList).not.toContain('dev-b');

    // Delete the whole account.
    const del = await authed('/accounts/tok-api', { method: 'DELETE' });
    expect(del.status).toBe(200);
    const finalL = (await (await authed('/accounts')).json()) as {
      accounts: Array<{ token: string }>;
    };
    expect(finalL.accounts.some((a) => a.token === 'tok-api')).toBe(false);
  });

  it('serves the admin UI at /relayadmin with SPA fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-admin-static-'));
    writeFileSync(join(dir, 'index.html'), '<html>admin shell</html>');
    writeFileSync(join(dir, 'app.js'), 'console.log(2)');

    const { relayUrl } = await setup({
      adminPassword: ADMIN_PW,
      adminStaticDir: dir,
    });
    const b = relayUrl.replace(/^ws:/, 'http:');
    expect(await (await fetch(`${b}/relayadmin`)).text()).toBe('<html>admin shell</html>');
    expect(await (await fetch(`${b}/relayadmin/app.js`)).text()).toBe('console.log(2)');
    // Admin routes fall back to admin shell; the old /admin path does not.
    expect(await (await fetch(`${b}/relayadmin/random`)).text()).toBe('<html>admin shell</html>');
    expect((await fetch(`${b}/admin`)).status).toBe(404);
  });

  it('uses the fixed default password test@123 when adminPassword is not set', async () => {
    const { relayUrl } = await setup({});
    const b = relayUrl.replace(/^ws:/, 'http:');
    const bad = await fetch(`${b}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(bad.status).toBe(401);
    const good = await fetch(`${b}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test@123' }),
    });
    expect(good.status).toBe(200);
  });
});
