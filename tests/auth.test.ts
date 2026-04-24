import { describe, it, expect, beforeEach } from "vitest";
import { simulateGetToken } from "../src/simulator.js";
import { state } from "../src/state.js";

describe("pyxis_get_token", () => {
  beforeEach(() => state.reset());

  it("returns success with token for default mode", () => {
    const result = simulateGetToken("testuser", "testpass");
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("Security");
    expect(result.token).toBeDefined();
    expect(result.issueAt).toBeDefined();
    expect(result.expiresAt).toBeDefined();
    expect(result.issuer).toBe("CSIPAY");
  });

  it("returns error 701 when env credentials are set and mismatch", () => {
    const origUser = process.env.PYXIS_MCP_USERNAME;
    const origPass = process.env.PYXIS_MCP_PASSWORD;
    process.env.PYXIS_MCP_USERNAME = "admin";
    process.env.PYXIS_MCP_PASSWORD = "secret";
    try {
      const result = simulateGetToken("wrong", "wrong");
      expect(result.status).toBe("Error");
      expect(result.errors?.[0].errorCode).toBe("701");
    } finally {
      if (origUser) process.env.PYXIS_MCP_USERNAME = origUser;
      else delete process.env.PYXIS_MCP_USERNAME;
      if (origPass) process.env.PYXIS_MCP_PASSWORD = origPass;
      else delete process.env.PYXIS_MCP_PASSWORD;
    }
  });

  it("issued token can be validated", () => {
    const result = simulateGetToken("testuser", "testpass");
    const validation = state.validateToken(result.token!);
    expect(validation.valid).toBe(true);
  });
});
