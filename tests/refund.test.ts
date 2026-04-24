import { describe, it, expect, beforeEach } from "vitest";
import { simulateSale, simulateRefund, simulateVoid } from "../src/simulator.js";
import { state } from "../src/state.js";

describe("pyxis_refund", () => {
  beforeEach(() => state.reset());

  it("refunds a settled sale successfully", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });
    expect(sale.status).toBe("Success");

    // Mark the transaction as settled
    state.updateTransaction(sale.transactionId!, { settledAt: new Date() });

    const result = simulateRefund({
      terminalId: "T001",
      transactionToRefundId: sale.transactionId!,
    });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("Refund");
    expect(result.referencedTransactionId).toBe(sale.transactionId);
    expect(result.approvedAmount).toBe("5000");
    expect(result.accountType).toBe("Visa");
    expect(result.gatewayResponseCode).toBe("00");
  });

  it("returns error 352 when refunding a voided transaction", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });

    simulateVoid({
      terminalId: "T001",
      transactionToVoidId: sale.transactionId!,
    });

    const result = simulateRefund({
      terminalId: "T001",
      transactionToRefundId: sale.transactionId!,
    });
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("352");
  });

  it("returns error 353 when refunding an already refunded transaction", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });

    state.updateTransaction(sale.transactionId!, { settledAt: new Date() });

    simulateRefund({
      terminalId: "T001",
      transactionToRefundId: sale.transactionId!,
    });

    const result = simulateRefund({
      terminalId: "T001",
      transactionToRefundId: sale.transactionId!,
    });
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("353");
  });

  it("returns error 354 when refund amount exceeds original amount", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });

    state.updateTransaction(sale.transactionId!, { settledAt: new Date() });

    const result = simulateRefund({
      terminalId: "T001",
      transactionToRefundId: sale.transactionId!,
      totalAmount: "9999",
    });
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("354");
  });

  it("returns error 357 when refunding an unsettled transaction", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });

    const result = simulateRefund({
      terminalId: "T001",
      transactionToRefundId: sale.transactionId!,
    });
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("357");
  });
});
