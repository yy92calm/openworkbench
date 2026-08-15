import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { AccountRegistry } from "./registry";
import type { RelayMessage } from "./protocol";
import { parseConnectionParams } from "./protocol";

export interface RelayServerOptions {
  port: number;
  host?: string;
  /** Legacy shared token — treated as one account (created on boot if missing). */
  authToken: string;
  /** Extra initial tokens to seed as accounts (comma-separated). */
  adminTokens?: string[];
  /** Directory for the persisted account registry (accounts.json). */
  dataDir?: string;
  /** PEM certificate path — when set the relay serves https/wss. */
  tlsCert?: string;
  /** PEM private key path — required together with tlsCert. */
  tlsKey?: string;
  /** Optional directory of static files (the web client build). */
  staticDir?: string;
  /** Admin UI password — defaults to "test@123" when not set. */
  adminPassword?: string;
  /** Optional directory of static files for the admin UI (served at /relayadmin/). */
  adminStaticDir?: string;
}

const HEARTBEAT_MS = 30_000;

/**
 * WebSocket relay: pure in-memory forwarder between one host and many guests.
 * No payload inspection, no request logging.
 *
 * Auth is per-account: a connection must present a token that exists in the
 * AccountRegistry. Host connections additionally register their device under
 * the account; guest data connections are only allowed to pair with devices
 * registered under their own token. The request-context is keyed by account
 * token + device id, so different accounts never share device ids.
 */
export class RelayServer {
  private readonly opts: RelayServerOptions;
  private readonly server: HttpServer | HttpsServer;
  private readonly wss: WebSocketServer;
  private readonly registry: AccountRegistry;
  /** True when serving TLS (https/wss). */
  readonly hasTls: boolean;
  /** `${token}|${device}` → host socket (one host per device; newer wins). */
  private readonly hosts = new Map<string, WebSocket>();
  /** requestId → guest socket that owns the request (routes host replies). */
  private readonly pending = new Map<string, WebSocket>();
  /** guest socket → `${token}|${device}` of the host it is paired with. */
  private readonly guestKey = new Map<WebSocket, string>();
  /** socket → account token (for kicking connections of removed accounts). */
  private readonly socketToken = new WeakMap<WebSocket, string>();
  /** Admin sessions: sessionId → expiry timestamp. In-memory only. */
  private readonly adminSessions = new Map<string, number>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(opts: RelayServerOptions) {
    this.opts = opts;
    this.hasTls = !!(opts.tlsCert && opts.tlsKey);
    if (!!opts.tlsCert !== !!opts.tlsKey) {
      throw new Error("tlsCert and tlsKey must be provided together");
    }
    this.registry = new AccountRegistry(opts.dataDir);
    // A legacy single-token deployment becomes one account.
    this.registry.upsertAccount(opts.authToken);
    for (const t of opts.adminTokens ?? []) {
      if (t.trim()) this.registry.upsertAccount(t.trim());
    }
    if (this.hasTls) {
      this.server = createHttpsServer(
        { cert: readFileSync(opts.tlsCert!), key: readFileSync(opts.tlsKey!) },
        (req, res) => this.handleHttp(req, res),
      );
    } else {
      this.server = createHttpServer((req, res) => this.handleHttp(req, res));
    }
    // Authenticate at the HTTP upgrade stage: a rejected handshake surfaces as
    // a client-side error (never a misleading open-then-close).
    this.wss = new WebSocketServer({
      server: this.server,
      verifyClient: ({ req }: { req: import("node:http").IncomingMessage }) => {
        const params = parseConnectionParams(req.url ?? "");
        return !!params && this.registry.hasAccount(params.token);
      },
    });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req.url ?? ""));
    // Admin CLI wrote the account file (added/removed accounts) — hot reload.
    // Removed accounts' sockets get terminated so auth applies immediately.
    this.registry.onFileChange(() => {
      const gone: Array<{ ws: WebSocket; key: string }> = [];
      for (const ws of this.wss.clients) {
        const token = this.socketToken.get(ws);
        if (token && !this.registry.hasAccount(token)) {
          gone.push({ ws, key: this.hostsKey(token, ws) });
        }
      }
      for (const { ws, key } of gone) {
        if (key && this.hosts.get(key) === ws) this.hosts.delete(key);
        this.failPending(502, "account removed");
        ws.terminate();
      }
    });
  }

  private hostsKey(token: string, ws: WebSocket): string {
    for (const [key, host] of this.hosts) {
      if (host === ws && key.startsWith(`${token}|`)) return key;
    }
    return "";
  }

  /** The account registry (used by the admin CLI / tests). */
  getAccountRegistry(): AccountRegistry {
    return this.registry;
  }

  /** Start listening. Resolves with the bound port; rejects on bind errors. */
  listen(): Promise<number> {
    return new Promise((resolvePort, reject) => {
      const onError = (err: Error) => {
        this.server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        this.server.removeListener("error", onError);
        const addr = this.server.address();
        resolvePort(typeof addr === "object" && addr ? addr.port : this.opts.port);
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.opts.port, this.opts.host ?? "0.0.0.0");
      this.heartbeat = setInterval(() => this.pingAll(), HEARTBEAT_MS);
    });
  }

  close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.registry.dispose();
    for (const ws of this.wss.clients) ws.terminate();
    return new Promise((resolveClose) => this.server.close(() => resolveClose()));
  }

  private handleConnection(ws: WebSocket, rawUrl: string): void {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on("pong", () => { (ws as WebSocket & { isAlive?: boolean }).isAlive = true; });
    const params = parseConnectionParams(rawUrl);
    if (!params || !this.registry.hasAccount(params.token)) {
      ws.close(4001, "unauthorized");
      return;
    }
    this.socketToken.set(ws, params.token);
    if (params.role === "host") {
      this.handleHost(ws, params.token, params.device);
      return;
    }
    this.handleGuest(ws, params.token, params.device);
  }

  /** Host: register the device under the account, then serve requests. */
  private handleHost(ws: WebSocket, token: string, device: string): void {
    if (!device) {
      ws.close(4004, "device required for host");
      return;
    }
    this.registry.registerDevice(token, device);
    const key = `${token}|${device}`;
    // A fresh host connection supersedes a stale one for the same device.
    const old = this.hosts.get(key);
    if (old && old !== ws) old.terminate();
    this.hosts.set(key, ws);
    // In-flight requests die with the old host connection.
    this.failPending(502, "host disconnected");
    ws.on("message", (data) => this.handleHostMessage(ws, data));
    ws.on("close", () => {
      if (this.hosts.get(key) === ws) this.hosts.delete(key);
      this.failPending(502, "host disconnected");
    });
  }

  /** Guest: pair with a registered device, or serve control messages when no device. */
  private handleGuest(ws: WebSocket, token: string, device: string): void {
    ws.on("message", (data) => this.handleGuestMessage(ws, token, device, data));
    ws.on("close", () => this.dropGuest(ws));
    if (!device) {
      // Control connection: only list-devices is meaningful.
      return;
    }
    if (!this.registry.hasDevice(token, device)) {
      // Unknown device under this account — reject now, not on first request.
      ws.close(4003, "unknown device for account");
      return;
    }
    this.guestKey.set(ws, `${token}|${device}`);
  }

  /** Guest → relay/host: forward HTTP requests, or answer control messages. */
  private handleGuestMessage(guest: WebSocket, token: string, device: string, data: unknown): void {
    const msg = this.parse<RelayMessage & { id?: string }>(data);
    if (!msg) return;
    if (msg.type === "list-devices") {
      if (device) return; // only control connections may list
      const devices = this.registry.listDevices(token).map((d) => ({
        device: d,
        online: this.hosts.has(`${token}|${d}`),
      }));
      this.reply(guest, { type: "device-list", id: msg.id ?? "", devices });
      return;
    }
    if (msg.type !== "request" || !device) return;
    const key = this.guestKey.get(guest);
    const host = key ? this.hosts.get(key) : undefined;
    if (!host || host.readyState !== WebSocket.OPEN) {
      this.reply(guest, { type: "head", id: msg.id, status: 502, headers: {} });
      this.reply(guest, { type: "done", id: msg.id });
      return;
    }
    this.pending.set(msg.id, guest);
    host.send(JSON.stringify(msg));
  }

  /** Host → guest: route the reply back to the owning guest. */
  private handleHostMessage(host: WebSocket, data: unknown): void {
    const msg = this.parse<RelayMessage>(data);
    if (!msg || (msg.type !== "head" && msg.type !== "chunk" && msg.type !== "done")) return;
    const guest = this.pending.get(msg.id);
    if (!guest || guest.readyState !== WebSocket.OPEN) return;
    if (msg.type === "done") this.pending.delete(msg.id);
    guest.send(JSON.stringify(msg));
  }

  private dropGuest(ws: WebSocket): void {
    this.guestKey.delete(ws);
    // Drop requests this guest started so host replies never route nowhere.
    for (const [id, owner] of this.pending) {
      if (owner === ws) this.pending.delete(id);
    }
  }

  private failPending(status: number, reason: string): void {
    const ids = [...this.pending.keys()];
    for (const id of ids) {
      const guest = this.pending.get(id);
      if (!guest) continue;
      this.pending.delete(id);
      if (guest.readyState !== WebSocket.OPEN) continue;
      this.reply(guest, { type: "head", id, status, headers: { "x-relay-error": reason } });
      this.reply(guest, { type: "done", id });
    }
  }

  private reply(ws: WebSocket, msg: RelayMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private parse<T>(data: unknown): T | null {
    try {
      return JSON.parse(String(data)) as T;
    } catch {
      return null;
    }
  }

  private pingAll(): void {
    for (const ws of this.wss.clients) {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
      ws.ping();
    }
    for (const ws of this.wss.clients) {
      if ((ws as WebSocket & { isAlive?: boolean }).isAlive === false) {
        ws.terminate();
        this.guestKey.delete(ws);
        for (const [k, v] of this.hosts) if (v === ws) this.hosts.delete(k);
        this.failPending(502, "connection timed out");
      }
    }
  }

  // ── HTTP: admin API + static hosting ────────────────────────────────────

  /** All HTTP requests enter here: /api/admin/* → JSON API, /relayadmin* →
   *  the admin UI, everything else → the client build (SPA). */
  private handleHttp(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
    const url = (req.url ?? "/").split("?")[0];
    if (url.startsWith("/api/admin/")) {
      this.handleAdminApi(req, res, url);
      return;
    }
    if ((url === "/relayadmin" || url.startsWith("/relayadmin/")) && this.opts.adminStaticDir) {
      this.handleStaticDir(req, res, this.opts.adminStaticDir, url.replace(/^\/relayadmin/, "") || "/");
      return;
    }
    if (!url.startsWith("/api/")) this.handleStatic(req, res);
    else res.writeHead(404).end();
  }

  // ── Admin API ────────────────────────────────────────────────────────────

  private static readonly ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  /** Fixed default password when RELAY_ADMIN_PASSWORD is not set. */
  private static readonly DEFAULT_ADMIN_PASSWORD = "test@123";

  private sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(data);
  }

  private readBody(req: import("node:http").IncomingMessage): Promise<string> {
    return new Promise((resolveBody, reject) => {
      let acc = "";
      req.on("data", (c) => (acc += c));
      req.on("end", () => resolveBody(acc));
      req.on("error", reject);
    });
  }

  private parseCookie(req: import("node:http").IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  private isAdminAuthed(req: import("node:http").IncomingMessage): boolean {
    const sid = this.parseCookie(req).admin_session;
    if (!sid) return false;
    const expires = this.adminSessions.get(sid);
    if (!expires) return false;
    if (Date.now() > expires) {
      this.adminSessions.delete(sid);
      return false;
    }
    return true;
  }

  private setAdminSession(res: import("node:http").ServerResponse, sid: string): void {
    const secure = this.hasTls ? "; Secure" : "";
    res.setHeader("set-cookie", `admin_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(RelayServer.ADMIN_SESSION_TTL_MS / 1000)}${secure}`);
  }

  private async handleAdminApi(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    url: string,
  ): Promise<void> {
    const pw = this.opts.adminPassword ?? RelayServer.DEFAULT_ADMIN_PASSWORD;
    // Login is the only unauthenticated endpoint; everything else needs a session.
    if (url === "/api/admin/login" && req.method === "POST") {
      let body: { password?: string } = {};
      try {
        body = JSON.parse(await this.readBody(req)) as { password?: string };
      } catch {
        this.sendJson(res, 400, { error: "invalid json" });
        return;
      }
      if (body.password !== pw) {
        this.sendJson(res, 401, { error: "wrong password" });
        return;
      }
      const sid = randomUUID();
      this.adminSessions.set(sid, Date.now() + RelayServer.ADMIN_SESSION_TTL_MS);
      this.setAdminSession(res, sid);
      this.sendJson(res, 200, { ok: true });
      return;
    }
    if (url === "/api/admin/logout" && req.method === "POST") {
      const sid = this.parseCookie(req).admin_session;
      if (sid) this.adminSessions.delete(sid);
      res.writeHead(204).end();
      return;
    }

    if (!this.isAdminAuthed(req)) {
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const reg = this.registry;

    // GET /api/admin/accounts — token/note/devices (with online status).
    if (url === "/api/admin/accounts" && req.method === "GET") {
      const accounts = reg.listAccounts().map((a) => ({
        token: a.token,
        note: a.note ?? null,
        devices: reg.listDevices(a.token).map((d) => ({
          device: d,
          online: this.hosts.has(`${a.token}|${d}`),
        })),
      }));
      this.sendJson(res, 200, { accounts });
      return;
    }
    // POST /api/admin/accounts — { token, note? }.
    if (url === "/api/admin/accounts" && req.method === "POST") {
      let body: { token?: string; note?: string } = {};
      try {
        body = JSON.parse(await this.readBody(req)) as { token?: string; note?: string };
      } catch {
        this.sendJson(res, 400, { error: "invalid json" });
        return;
      }
      if (!body.token) {
        this.sendJson(res, 400, { error: "token required" });
        return;
      }
      if (!reg.hasAccount(body.token)) reg.upsertAccount(body.token, body.note);
      this.sendJson(res, 200, { ok: true });
      return;
    }
    // DELETE /api/admin/accounts/:token
    const dm = url.match(/^\/api\/admin\/accounts\/([^/]+)$/);
    if (dm && req.method === "DELETE") {
      const token = decodeURIComponent(dm[1]);
      const removed = reg.removeAccount(token);
      this.sendJson(res, removed ? 200 : 404, { ok: removed });
      return;
    }
    // DELETE /api/admin/accounts/:token/devices/:device
    const dv = url.match(/^\/api\/admin\/accounts\/([^/]+)\/devices\/([^/]+)$/);
    if (dv && req.method === "DELETE") {
      const token = decodeURIComponent(dv[1]);
      const device = decodeURIComponent(dv[2]);
      if (!reg.hasAccount(token)) {
        this.sendJson(res, 404, { error: "account not found" });
        return;
      }
      // Registry has no per-device removal; remove the device id from the set.
      reg.unregisterDevice(token, device);
      this.sendJson(res, 200, { ok: true });
      return;
    }
    this.sendJson(res, 404, { error: "not found" });
  }

  // ── Static hosting ───────────────────────────────────────────────────────
  private handleStatic(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
    const dir = this.opts.staticDir;
    if (!dir) {
      res.writeHead(404).end();
      return;
    }
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    this.handleStaticDir(req, res, dir, urlPath);
  }

  /** Serve files from a static dir, SPA-fallback to index.html. */
  private handleStaticDir(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    dir: string,
    urlPath: string,
  ): void {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(404).end();
      return;
    }
    // Normalize and contain — never serve outside dir.
    const resolved = normalize(join(dir, urlPath === "/" ? "index.html" : urlPath));
    if (!resolved.startsWith(resolve(dir))) {
      res.writeHead(403).end();
      return;
    }
    let data: Buffer;
    try {
      data = readFileSync(resolved);
    } catch {
      // SPA fallback: unknown paths render the app shell.
      try {
        data = readFileSync(join(dir, "index.html"));
      } catch {
        res.writeHead(404).end();
        return;
      }
    }
    res.writeHead(200, { "content-type": mime(extname(resolved)) });
    res.end(req.method === "HEAD" ? undefined : data);
  }
}

function mime(ext: string): string {
  const table: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
  };
  return table[ext] ?? "application/octet-stream";
}

/** Standalone deployment entry: env-driven, no config file. */
export function startRelayFromEnv(env: NodeJS.ProcessEnv = process.env): RelayServer {
  const authToken = env.RELAY_AUTH_TOKEN ?? "";
  if (!authToken) throw new Error("RELAY_AUTH_TOKEN is required");
  return new RelayServer({
    port: Number(env.RELAY_PORT ?? 8080),
    host: env.RELAY_HOST,
    authToken,
    adminTokens: (env.RELAY_ADMIN_TOKENS ?? "").split(",").filter(Boolean),
    dataDir: env.RELAY_DATA_DIR,
    tlsCert: env.RELAY_TLS_CERT,
    tlsKey: env.RELAY_TLS_KEY,
    staticDir: env.RELAY_STATIC_DIR,
    adminPassword: env.RELAY_ADMIN_PASSWORD || undefined,
    adminStaticDir: env.RELAY_ADMIN_STATIC_DIR || undefined,
  });
}