#!/usr/bin/env node
/**
 * Scheduler MCP Server — zero-dependency implementation.
 *
 * Speaks the Model Context Protocol (JSON-RPC 2.0 over stdio) and proxies
 * every tool call to the Electron main-process scheduler HTTP API.
 *
 * Required env vars:
 *   SCHEDULER_API_URL   — e.g. http://127.0.0.1:54321
 *   SCHEDULER_API_TOKEN — Basic-auth password
 */

import { request as httpReq } from "node:http";
import { request as httpsReq } from "node:https";

// ── HTTP helper ──────────────────────────────────────────────────────────

const API_URL = process.env.SCHEDULER_API_URL ?? "http://127.0.0.1:0";
const API_TOKEN = process.env.SCHEDULER_API_TOKEN ?? "";

function debug(msg) {
  process.stderr.write(`[mcp-scheduler] ${msg}\n`);
}

debug(`starting — API_URL=${API_URL}, TOKEN_SET=${!!API_TOKEN}`);

function apiCall(method, path, body, retries = 2) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const isHttps = url.protocol === "https:";
    const reqFn = isHttps ? httpsReq : httpReq;
    const req = reqFn(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + Buffer.from(`user:${API_TOKEN}`).toString("base64"),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", (err) => {
      if (retries > 0) {
        debug(`request failed (${err.code ?? err.message}), retrying… (${retries} left)`);
        setTimeout(() => apiCall(method, path, body, retries - 1).then(resolve, reject), 500);
      } else {
        reject(err);
      }
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Tool definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "scheduler_list",
    description: "List all scheduled tasks. Returns an array of task objects.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "scheduler_create",
    description:
      "Create a new scheduled task. The cron field uses standard 5-field cron syntax (minute hour day month weekday). Examples: '0 8 * * *' = every day at 08:00, '0 9 * * 1-5' = weekdays at 09:00, '*/30 * * * *' = every 30 minutes.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable task name" },
        cron: { type: "string", description: "Cron expression (5 fields: min hour day month weekday)" },
        prompt: { type: "string", description: "The prompt to send to the agent when the task fires" },
        agent: { type: "string", description: "Optional agent name" },
        model: { type: "string", description: "Optional model name" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      },
      required: ["name", "cron", "prompt"],
    },
  },
  {
    name: "scheduler_update",
    description: "Update an existing scheduled task. Only provided fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
        name: { type: "string" },
        cron: { type: "string" },
        prompt: { type: "string" },
        agent: { type: "string" },
        model: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
  },
  {
    name: "scheduler_delete",
    description: "Delete a scheduled task by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Task ID" } },
      required: ["id"],
    },
  },
  {
    name: "scheduler_toggle",
    description: "Enable or disable a scheduled task.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
        enabled: { type: "boolean", description: "true to enable, false to disable" },
      },
      required: ["id", "enabled"],
    },
  },
  {
    name: "scheduler_fire_now",
    description: "Immediately trigger a scheduled task (run it once right now).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Task ID" } },
      required: ["id"],
    },
  },
  {
    name: "scheduler_history",
    description: "View execution history for scheduled tasks.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Optional task ID to filter by" },
        limit: { type: "number", description: "Max records to return (default 50)" },
      },
      required: [],
    },
  },
];

// ── Tool handler ─────────────────────────────────────────────────────────

async function handleToolCall(name, args) {
  switch (name) {
    case "scheduler_list":
      return apiCall("GET", "/api/scheduler/tasks");
    case "scheduler_create":
      return apiCall("POST", "/api/scheduler/tasks", args);
    case "scheduler_update": {
      const { id, ...patch } = args;
      return apiCall("PATCH", `/api/scheduler/tasks/${id}`, patch);
    }
    case "scheduler_delete":
      return apiCall("DELETE", `/api/scheduler/tasks/${args.id}`);
    case "scheduler_toggle":
      return apiCall("PATCH", `/api/scheduler/tasks/${args.id}`, { enabled: args.enabled });
    case "scheduler_fire_now":
      return apiCall("POST", `/api/scheduler/tasks/${args.id}/fire`);
    case "scheduler_history": {
      const params = new URLSearchParams();
      if (args.taskId) params.set("taskId", args.taskId);
      if (args.limit) params.set("limit", String(args.limit));
      const qs = params.toString();
      return apiCall("GET", `/api/scheduler/history${qs ? `?${qs}` : ""}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC over stdio ──────────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg) {
  // Ignore notifications (no id)
  if (msg.id === undefined || msg.id === null) return;

  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      send(
        rpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "workbench-scheduler", version: "1.0.0" },
        }),
      );
      break;

    case "tools/list":
      send(rpcResult(id, { tools: TOOLS }));
      break;

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      debug(`tool call: ${toolName}(${JSON.stringify(toolArgs)})`);
      try {
        const result = await handleToolCall(toolName, toolArgs);
        debug(`tool result: ${JSON.stringify(result).slice(0, 200)}`);
        send(
          rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          }),
        );
      } catch (err) {
        debug(`tool error: ${err.message}`);
        send(
          rpcResult(id, {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          }),
        );
      }
      break;
    }

    default:
      send(rpcError(id, -32601, `Method not found: ${method}`));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

let buffer = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      // Fire-and-forget — responses are sent asynchronously
      handleMessage(msg).catch((err) => {
        if (msg.id !== undefined && msg.id !== null) {
          send(rpcError(msg.id, -32603, err.message));
        }
      });
    } catch {
      // Invalid JSON — skip
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

// Keep the process alive
process.on("SIGPIPE", () => process.exit(0));
