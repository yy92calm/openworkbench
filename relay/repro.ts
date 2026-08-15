import { createServer } from "node:http";
import { WebSocket } from "ws";
import { RelayServer } from "./src/server.js";
import { makeGuestTransport } from "./test/helpers/relay-guest.js";

const TOKEN = "t1", DEVICE = "d1";
let mockPORT = 0;

const mock = createServer((req, res) => {
  const url = req.url ?? "";
  if (req.method === "GET" && url.startsWith("/event")) {
    res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "s" } })}\n\n`);
    }, 100);
    return; // never end
  }
  if (req.method === "POST" && /^\/session\/?$/.test(url)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "s1" })); return;
  }
  if (req.method === "DELETE" && /^\/session\/[^/]+$/.test(url)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("true"); return;
  }
  res.writeHead(404); res.end();
});

const relay = new RelayServer({ port: 0, authToken: TOKEN });
const port = await relay.listen();
const relayUrl = `ws://127.0.0.1:${port}`;
const host = new WebSocket(`${relayUrl}?role=host&device=${DEVICE}&token=${TOKEN}`);
host.on("message", async (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type !== "request") return;
  try {
    const res = await fetch(`http://127.0.0.1:${mockPORT}${msg.path}`, { method: msg.method, headers: msg.headers, ...(msg.body !== undefined ? { body: msg.body } : {}) });
    host.send(JSON.stringify({ type: "head", id: msg.id, status: res.status, headers: Object.fromEntries(res.headers.entries()) }));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = dec.decode(value, { stream: true });
      if (text) host.send(JSON.stringify({ type: "chunk", id: msg.id, chunk: text }));
    }
    host.send(JSON.stringify({ type: "done", id: msg.id }));
  } catch (e) { console.log("host err", e.message); }
});
await new Promise((r) => host.on("open", r));

mock.listen(0, "127.0.0.1", () => {
  mockPORT = mock.address().port;
});

const t = makeGuestTransport({ WebSocketImpl: WebSocket });
await t.connect(relayUrl, DEVICE, TOKEN);
const res = await t.fetchImpl("http://relay/event", { headers: { Accept: "text/event-stream" } });
console.log("event status", res.status);
const reader = res.body.getReader();
const dec = new TextDecoder();
let read = 0;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  read += 1;
  const text = dec.decode(value, { stream: true });
  if (read <= 3) console.log("chunk:", text.slice(0, 60));
  if (read >= 3) break;
}
console.log("reached here fine");
const res2 = await t.fetchImpl("http://relay/session", { method: "POST", body: "{}" });
console.log("session status", res2.status, JSON.stringify(await res2.json()));
console.log("REPRO OK");
process.exit(0);