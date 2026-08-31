/**
 * 账号全链路 E2E（自包含，不依赖 SDK）：真实 relay + mock sidecar + 极简 client。
 *
 * 流程：host 连接（自动注册设备）→ 客户端 listAccountDevices（账号登录）→
 *       选择设备 → 配对 → createSession → sendPrompt → 流式事件（text.updated）
 *       → session.idle → deleteSession。
 *
 * 运行：pnpm tsx e2e-account.ts
 * 期望输出：E2E PASS
 */
import { createServer } from 'node:http';

import { WebSocket } from 'ws';

import { RelayServer } from './src/server.js';
import { listAccountDevices, makeGuestTransport } from './test/helpers/relay-guest.js';

const TOKEN = 'dev-account-a';
const DEVICE = 'desk-1';

// ── 极简 OpenCode mock sidecar：只实现 E2E 用到的端点 ─────────────────────
async function startMockOpenCode() {
  const clients = new Set();
  const send = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const server = createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url.startsWith('/event')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      send(res, { type: 'server.connected', properties: {} });
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && /^\/session\/?$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'ses_e2e', title: 'New session', slug: 'e2e' }));
      return;
    }
    if (req.method === 'DELETE' && /^\/session\/[^/]+$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('true');
      return;
    }
    const m = url.match(/^\/session\/([^/]+)\/prompt_async/);
    if (req.method === 'POST' && m) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      // 流式回合：文本增量 → text.updated → session.idle。
      setTimeout(() => {
        const sessionID = decodeURIComponent(m[1]);
        const push = (obj) => clients.forEach((c) => send(c, obj));
        push({
          type: 'message.part.updated',
          properties: { part: { sessionID, id: 'p1', type: 'text', text: '' } },
        });
        push({
          type: 'message.part.delta',
          properties: { sessionID, partID: 'p1', field: 'text', delta: 'Planning ' },
        });
        push({
          type: 'message.part.delta',
          properties: { sessionID, partID: 'p1', field: 'text', delta: 'works.' },
        });
        push({
          type: 'message.part.updated',
          properties: { part: { sessionID, id: 'p1', type: 'text', text: 'Planning works.' } },
        });
        push({ type: 'session.idle', properties: { sessionID } });
      }, 5);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : 0,
        close: () =>
          new Promise((r) => {
            for (const c of clients) c.end();
            clients.clear();
            server.close(() => r());
          }),
      });
    });
  });
}

// ── 极简 OpenCode client：只实现 E2E 用到的回调 ──────────────────────────
class MiniOpenCodeClient {
  constructor({ baseUrl, fetchImpl }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.listeners = new Set();
    this.sawText = false;
    this.sawIdle = false;
  }

  onEvent(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** 打开 /event 长连接（streaming fetch），逐行解析 SSE 帧。 */
  async connect() {
    const res = await this.fetchImpl(`${this.baseUrl}/event`, {
      headers: { Accept: 'text/event-stream' },
    });
    if (!res.ok || !res.body) throw new Error(`event returned ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!frame.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(frame.slice(5).trim());
          if (ev.type === 'message.part.updated' && ev.properties?.part?.type === 'text')
            this.sawText = true;
          if (ev.type === 'session.idle') this.sawIdle = true;
          for (const cb of this.listeners) cb(ev);
        } catch {
          /* malformed frame — ignore */
        }
      }
    }
  }

  async createSession() {
    const res = await this.fetchImpl(`${this.baseUrl}/session`, { method: 'POST', body: '{}' });
    if (!res.ok) throw new Error(`createSession ${res.status}`);
    const json = await res.json();
    return json.id;
  }

  async deleteSession(sessionId) {
    const res = await this.fetchImpl(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`deleteSession ${res.status}`);
  }

  async sendPrompt(sessionId, text) {
    const res = await this.fetchImpl(
      `${this.baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async`,
      {
        method: 'POST',
        body: JSON.stringify({ parts: [{ type: 'text', text }] }),
      },
    );
    if (!res.ok) throw new Error(`sendPrompt ${res.status}`);
  }

  close() {
    // fetchImpl 是一发/一收；长连接靠 relay 的 done 自然结束。
    this.listeners.clear();
  }
}

// ── E2E ─────────────────────────────────────────────────────────────────
const relay = new RelayServer({ port: 0, authToken: TOKEN, dataDir: './.e2e-data' });
const port = await relay.listen();
const relayUrl = `ws://127.0.0.1:${port}`;

const mock = await startMockOpenCode();

// 1. Host（桌面端）连接 → 设备 desk-1 自动注册到账号 TOKEN。
const host = new WebSocket(`${relayUrl}?role=host&device=${DEVICE}&token=${TOKEN}`);
host.on('message', async (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type !== 'request') return;
  try {
    const res = await fetch(`http://127.0.0.1:${mock.port}${msg.path}`, {
      method: msg.method,
      headers: msg.headers,
      ...(msg.body !== undefined ? { body: msg.body } : {}),
    });
    host.send(
      JSON.stringify({
        type: 'head',
        id: msg.id,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
      }),
    );
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) host.send(JSON.stringify({ type: 'chunk', id: msg.id, chunk: text }));
    }
    host.send(JSON.stringify({ type: 'done', id: msg.id }));
  } catch {
    host.send(JSON.stringify({ type: 'head', id: msg.id, status: 502, headers: {} }));
    host.send(JSON.stringify({ type: 'done', id: msg.id }));
  }
});
await new Promise((r) => host.on('open', r));

// 2. 客户端登录：拉取该账号的设备列表（含在线状态）。
const devices = await listAccountDevices(relayUrl, TOKEN, { WebSocketImpl: WebSocket });
const desk = devices.find((d) => d.device === DEVICE);
if (!desk || !desk.online)
  throw new Error(`E2E FAIL: 设备未注册或不在线: ${JSON.stringify(devices)}`);

// 3. 用选中的设备配对，走完整会话流。
const t = makeGuestTransport({ WebSocketImpl: WebSocket });
await t.connect(relayUrl, DEVICE, TOKEN);
const client = new MiniOpenCodeClient({ baseUrl: 'http://relay', fetchImpl: t.fetchImpl });
const connectDone = client.connect(); // 打开 /event 长连接（流式读取直至 done）

const sessionID = await client.createSession({});
await client.sendPrompt(sessionID, 'hi');

// 等流式回合完成（text.updated + session.idle）。
const deadline = Date.now() + 10_000;
while (Date.now() < deadline && !(client.sawText && client.sawIdle)) {
  await new Promise((r) => setTimeout(r, 50));
  if (client.sawText && client.sawIdle) break;
}

await client.deleteSession(sessionID);
client.close();
await connectDone.catch(() => {
  /* 长连接随 relay 关闭自然结束 */
});
t.close();
host.close();
await relay.close();
await mock.close();

if (!(client.sawText && client.sawIdle)) {
  throw new Error(`E2E FAIL { sawText: ${client.sawText}, sawIdle: ${client.sawIdle} }`);
}
console.log('E2E PASS: 登录 → 设备列表 → 配对 → 流式会话 → idle (self-contained)');
process.exit(0);
