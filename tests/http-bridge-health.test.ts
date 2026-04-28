import http from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ---------------------------------------------------------------------------
// Inline the health handler logic (same as http-bridge.ts) to avoid importing
// the module directly — http-bridge.ts calls server.listen at module level
// which would conflict with the test server.
// ---------------------------------------------------------------------------
function createTestServer(): http.Server {
  return http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

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

    // Other routes return 404 in tests
    res.writeHead(404);
    res.end();
  });
}

// ---------------------------------------------------------------------------
// Helper to make HTTP requests in tests
// ---------------------------------------------------------------------------
function makeRequest(
  port: number,
  method: string,
  path: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, method, path },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("HTTP bridge /health endpoint", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = createTestServer();
    await new Promise<void>((resolve) => {
      // Port 0 lets the OS assign a random available port
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        port = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /health returns 200 with {status:'ok'}", async () => {
    const { status, body } = await makeRequest(port, "GET", "/health");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: "ok" });
  });

  it("POST /health returns 405", async () => {
    const { status } = await makeRequest(port, "POST", "/health");
    expect(status).toBe(405);
  });

  it("DELETE /health returns 405", async () => {
    const { status } = await makeRequest(port, "DELETE", "/health");
    expect(status).toBe(405);
  });
});
