import { createServer, type Server, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { baseWorkspaceDir, workspaceDir } from "./server";

let server: Server | null = null;
let serverToken: string | null = null;
let serverPort: number | null = null;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".ipynb": "application/json",
  ".py": "text/x-python",
  ".r": "text/x-r",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function previewToken(): string {
  if (!serverToken) serverToken = randomBytes(24).toString("hex");
  return serverToken;
}

/** Root for a preview request, mirroring artifact_file.rootDir: "base" pins to
 *  the base workspace, anything else resolves under the active workspace. */
function rootDirFor(root?: string): string {
  return root === "base" ? baseWorkspaceDir() : workspaceDir();
}

export function previewUrl(rel: string, root?: string): string | null {
  const base = rootDirFor(root);
  const file = resolve(base, rel);
  if (!file.startsWith(base) || !existsSync(file)) return null;
  const rootSeg = root === "base" ? "base" : "ws";
  return `http://127.0.0.1:${serverPort ?? 0}/${previewToken()}/${rootSeg}/${encodeURIComponent(rel)}`;
}

export function startPreviewServer(): number {
  if (server) return serverPort!;

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts.length >= 3 && parts[0] === serverToken && (parts[1] === "base" || parts[1] === "ws")) {
      const rel = decodeURIComponent(parts.slice(2).join("/"));
      const base = rootDirFor(parts[1] === "base" ? "base" : undefined);
      const file = resolve(base, rel);
      if (!file.startsWith(base) || !existsSync(file)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const ext = extname(file).toLowerCase();
      const mime = MIME[ext] ?? "application/octet-stream";
      const content = readFileSync(file);
      res.writeHead(200, { "Content-Type": mime, "Content-Length": String(content.length) });
      res.end(content);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server!.address();
    if (typeof addr === "object" && addr) serverPort = addr.port;
  });

  return serverPort ?? 0;
}

export function stopPreviewServer(): void {
  if (server) {
    server.close();
    server = null;
  }
  serverPort = null;
}