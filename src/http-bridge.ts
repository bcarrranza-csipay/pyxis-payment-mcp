#!/usr/bin/env node
/**
 * HTTP bridge for pyxis-payment-mcp.
 * Exposes the MCP tool router over HTTP JSON-RPC so the Android app
 * (or any HTTP client) can call it directly.
 *
 * Usage:  npx tsx src/http-bridge.ts
 *    or:  node dist/http-bridge.js
 *
 * Listens on port 3000 (override with PORT env var).
 */
import http from "node:http";
import { handleToolCall as simHandleToolCall } from "./router.js";
import { handleToolCall as liveHandleToolCall } from "./live-router.js";

// Use live-router when PYXIS_MODE is "mock" or "live"; fall back to simulator otherwise
const isMockOrLive = process.env.PYXIS_MODE === "mock" || process.env.PYXIS_MODE === "live";
const handleToolCall = isMockOrLive
  ? (name: string, args: Record<string, unknown>) => liveHandleToolCall(name, args)
  : simHandleToolCall;

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server = http.createServer((req, res) => {
  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint — required by App Runner
  if (req.url === "/health") {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const rpc = JSON.parse(body);
      const { id, params } = rpc;
      const toolName = params?.name as string;
      const args = (params?.arguments ?? {}) as Record<string, unknown>;

      const result = await handleToolCall(toolName, args);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: err.message ?? "Parse error" },
        })
      );
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pyxis Payment MCP HTTP bridge listening on http://0.0.0.0:${PORT}`);
});
