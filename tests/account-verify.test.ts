import { describe, it, expect, beforeEach } from "vitest";
import { simulateAccountVerify } from "../src/simulator.js";
import { state } from "../src/state.js";
import { TERMINAL_ID, TEST_CARD } from "./helpers.js";

describe("pyxis_account_verify", () => {
  beforeEach(() => state.reset());

  it("approves verification with transaction ID and approval code", () => {
    const result = simulateAccountVerify({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
    });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("AccountVerify");
    expect(result.transactionId).toBeDefined();
    expect(result.approvalNumber).toBeDefined();
    expect(result.accountType).toBe("Visa");
    expect(result.accountFirst6).toBe("411111");
    expect(result.accountLast4).toBe("1111");
    expect(result.accountMasked).toBe("411111******1111");
    expect(result.gatewayResponseCode).toBe("00");
    expect(result.gatewayResponseMessage).toBe("APPROVAL");
  });
});
