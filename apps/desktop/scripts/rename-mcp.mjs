import { renameSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const file = join("out", "main", "browser-mcp-server.js");
const dest = join("out", "main", "browser-mcp-server.mjs");

if (existsSync(file)) {
  copyFileSync(file, dest);
  console.log("browser-mcp-server.mjs created");
} else {
  console.warn("browser-mcp-server.js not found, skipping rename");
}
