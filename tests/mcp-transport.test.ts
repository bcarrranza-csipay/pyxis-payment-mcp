import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";

/**
 * Helpers for communicating with the MCP server over stdio.
 * The MCP StdioServerTransport uses newline-delimited JSON (one JSON object per line).
 */

function sendMessage(proc: ChildProcess, message: object): void {
  proc.stdin!.write(JSON.stringify(message) + "\n");
}

function waitForResponse(
  proc: ChildProcess,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for MCP response (${timeoutMs}ms)`)),
      timeoutMs,
    );

    const onData = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          clearTimeout(timeout);
          proc.stdout!.removeListener("data", onData);
          resolve(parsed);
          return;
        } catch {
          // not valid JSON yet, skip
        }
      }
      buffer = lines[lines.length - 1];
    };

    proc.stdout!.on("data", onData);
  });
}

describe("MCP transport smoke test", () => {
  const serverPath = resolve(__dirname, "../dist/index.js");

  it("initializes the server and calls pyxis_sandbox_info through MCP", async () => {
    const proc = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Prevent audit log from writing during tests
        PYXIS_AUDIT_LOG: resolve(__dirname, "../.test-audit.log"),
      },
    });

    // Collect stderr for debugging
    let stderr = "";
    proc.stderr!.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    try {
      // Step 1: Initialize
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });

      const initResponse = await waitForResponse(proc);
      expect(initResponse.jsonrpc).toBe("2.0");
      expect(initResponse.id).toBe(1);
      expect(initResponse.result).toBeDefined();

      const result = initResponse.result as Record<string, unknown>;
      expect(result.protocolVersion).toBeDefined();
      expect(result.serverInfo).toBeDefined();

      const serverInfo = result.serverInfo as Record<string, string>;
      expect(serverInfo.name).toBe("pyxis-payment-mcp");

      // Step 2: Send initialized notification (no response expected)
      sendMessage(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // Brief pause for the notification to be processed
      await new Promise((r) => setTimeout(r, 200));

      // Step 3: Call pyxis_sandbox_info tool
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "pyxis_sandbox_info",
          arguments: {},
        },
      });

      const toolResponse = await waitForResponse(proc);
      expect(toolResponse.jsonrpc).toBe("2.0");
      expect(toolResponse.id).toBe(2);
      expect(toolResponse.result).toBeDefined();

      const toolResult = toolResponse.result as Record<string, unknown>;
      expect(toolResult.content).toBeDefined();

      const content = toolResult.content as Array<{ type: string; text: string }>;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe("text");

      const parsed = JSON.parse(content[0].text);
      expect(parsed.status).toBe("Success");
      expect(parsed.apiVersion).toBe("Pyxis v3 (current)");
      expect(parsed.testCards).toBeDefined();
      expect(Array.isArray(parsed.testCards)).toBe(true);
      expect(parsed.testCards.length).toBeGreaterThan(0);
      expect(parsed.conventions).toBeDefined();
    } finally {
      proc.kill();
    }
  }, 15_000);

  it("lists tools through MCP and finds all 13 tools", async () => {
    const proc = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYXIS_AUDIT_LOG: resolve(__dirname, "../.test-audit.log"),
      },
    });

    try {
      // Initialize
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });
      await waitForResponse(proc);

      sendMessage(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      await new Promise((r) => setTimeout(r, 200));

      // List tools
      sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });

      const listResponse = await waitForResponse(proc);
      expect(listResponse.id).toBe(2);
      expect(listResponse.result).toBeDefined();

      const result = listResponse.result as Record<string, unknown>;
      const tools = result.tools as Array<{ name: string }>;
      expect(tools).toBeDefined();
      expect(tools.length).toBe(14);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("pyxis_get_token");
      expect(toolNames).toContain("pyxis_sale");
      expect(toolNames).toContain("pyxis_sandbox_info");
    } finally {
      proc.kill();
    }
  }, 15_000);
});
