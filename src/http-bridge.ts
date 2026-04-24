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
import { handleToolCall } from "./router.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server = http.createServer((req, res) => {
  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const rpc = JSON.parse(body);
      const { id, params } = rpc;
      const toolName = params?.name as string;
      const args = (params?.arguments ?? {}) as Record<string, unknown>;

      const result = handleToolCall(toolName, args);

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

server.listen(PORT, () => {
  console.log(`Pyxis Payment MCP HTTP bridge listening on http://localhost:${PORT}`);
});
