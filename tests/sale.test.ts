import { describe, it, expect, beforeEach } from "vitest";
import { simulateSale } from "../src/simulator.js";
import { state } from "../src/state.js";
import { TERMINAL_ID, TEST_CARD } from "./helpers.js";

describe("pyxis_sale", () => {
  beforeEach(() => state.reset());

  it("approves a sale with test card", () => {
    const result = simulateSale({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "1000",
    });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("Sale");
    expect(result.transactionId).toBeDefined();
    expect(result.approvalNumber).toBeDefined();
    expect(result.approvedAmount).toBe("1000");
    expect(result.accountMasked).toBe("411111******1111");
    expect(result.gatewayResponseCode).toBe("00");
    expect(result.gatewayResponseMessage).toBe("APPROVAL");
    expect(result.feeAmount).toBe("30"); // 3% of 1000
  });

  it("declines amount $0.01 (amount=1) with error 110", () => {
    const result = simulateSale({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "1",
    });
    expect(result.status).toBe("Error");
    expect(result.errors).toBeDefined();
    expect(result.errors![0].errorCode).toBe("110");
  });

  it("declines amount $0.23 (amount=23) with error 110", () => {
    const result = simulateSale({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "23",
    });
    expect(result.status).toBe("Error");
    expect(result.errors).toBeDefined();
    expect(result.errors![0].errorCode).toBe("110");
  });

  it("saleWithTokenize includes generatedToken in response", () => {
    const result = simulateSale({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "1000",
      saleWithTokenize: true,
    });
    expect(result.status).toBe("Success");
    expect(result.generatedToken).toBeDefined();
  });

  it("recurring First includes recurringScheduleTransId", () => {
    const result = simulateSale({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "1000",
      recurring: "First",
    });
    expect(result.status).toBe("Success");
    expect(result.recurringScheduleTransId).toBeDefined();
  });

  it("recurring InTrack uses provided recurringScheduleTransId", () => {
    // First create a recurring schedule
    const firstResult = simulateSale({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "1000",
      recurring: "First",
    });
    const scheduleId = firstResult.recurringScheduleTransId!;

    // Now do an InTrack sale with that schedule ID
    const result = simulateSale({
      terminalId: TERMINAL_ID,
      accountInfo: {
        accountNumber: TEST_CARD,
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
      totalAmount: "500",
      recurring: "InTrack",
      recurringScheduleTransId: scheduleId,
    });
    expect(result.status).toBe("Success");
    expect(result.recurringScheduleTransId).toBe(scheduleId);
  });
});
