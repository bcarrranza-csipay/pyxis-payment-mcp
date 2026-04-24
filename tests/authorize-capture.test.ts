import { describe, it, expect, beforeEach } from "vitest";
import { simulateAuthorize, simulateCapture, simulateSale } from "../src/simulator.js";
import { state } from "../src/state.js";
import { TERMINAL_ID, TEST_CARD } from "./helpers.js";

describe("pyxis_authorize", () => {
  beforeEach(() => state.reset());

  it("approves an authorization", () => {
    const result = simulateAuthorize({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "2000",
    });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("Authorize");
    expect(result.transactionId).toBeDefined();
    expect(result.approvalNumber).toBeDefined();
    expect(result.approvedAmount).toBe("2000");
    expect(result.feeAmount).toBe("60"); // 3% of 2000
    expect(result.accountMasked).toBe("411111******1111");
    expect(result.gatewayResponseCode).toBe("00");
    expect(result.gatewayResponseMessage).toBe("APPROVAL");
  });
});

describe("pyxis_capture", () => {
  beforeEach(() => state.reset());

  it("captures an authorized transaction", () => {
    const auth = simulateAuthorize({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "2000",
    });

    const result = simulateCapture({
      terminalId: TERMINAL_ID,
      transactionId: auth.transactionId!,
    });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("Capture");
    expect(result.transactionId).toBeDefined();
    expect(result.referencedTransactionId).toBe(auth.transactionId);
    expect(result.approvedAmount).toBe("2000");
    expect(result.feeAmount).toBe("60"); // 3% of 2000
    expect(result.accountMasked).toBe("411111******1111");
    expect(result.gatewayResponseCode).toBe("00");
  });

  it("captures with partial amount (lower than authorized)", () => {
    const auth = simulateAuthorize({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "2000",
    });

    const result = simulateCapture({
      terminalId: TERMINAL_ID,
      transactionId: auth.transactionId!,
      totalAmount: "1500",
    });
    expect(result.status).toBe("Success");
    expect(result.approvedAmount).toBe("1500");
    expect(result.feeAmount).toBe("45"); // 3% of 1500
  });

  it("returns error 302 for non-existent transaction", () => {
    const result = simulateCapture({
      terminalId: TERMINAL_ID,
      transactionId: "non-existent-id",
    });
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("302");
  });

  it("returns error 303 when capturing a non-authorization (sale)", () => {
    const sale = simulateSale({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "1000",
    });

    const result = simulateCapture({
      terminalId: TERMINAL_ID,
      transactionId: sale.transactionId!,
    });
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("303");
  });
});
