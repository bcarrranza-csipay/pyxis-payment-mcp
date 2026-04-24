import { describe, it, expect, beforeEach } from "vitest";
import { simulateTokenize } from "../src/simulator.js";
import { state } from "../src/state.js";
import { TERMINAL_ID, TEST_CARD } from "./helpers.js";

describe("pyxis_tokenize", () => {
  beforeEach(() => state.reset());

  it("returns success with token for full card details", () => {
    const result = simulateTokenize({
      terminalId: TERMINAL_ID,
      accountHolder: { holderFirstName: "John", holderLastName: "Doe" },
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
    });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("Tokenize");
    expect(result.token).toBeDefined();
    expect(result.terminalId).toBe(TERMINAL_ID);
    expect(result.accountType).toBe("Visa");
    expect(result.accountFirst6).toBe("411111");
    expect(result.accountLast4).toBe("1111");
  });

  it("same card + terminal returns the same token (idempotent)", () => {
    const result1 = simulateTokenize({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
    });
    const result2 = simulateTokenize({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
    });
    expect(result1.token).toBe(result2.token);
  });

  it("different terminal returns a different token", () => {
    const result1 = simulateTokenize({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
    });
    const result2 = simulateTokenize({
      terminalId: "other-terminal-002",
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
    });
    expect(result1.token).not.toBe(result2.token);
  });
});
