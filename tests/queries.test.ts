import { describe, it, expect, beforeEach } from "vitest";
import {
  simulateSale,
  simulateGetTransaction,
  simulateGetSettledTransactions,
} from "../src/simulator.js";
import { state } from "../src/state.js";

describe("pyxis_get_transaction", () => {
  beforeEach(() => state.reset());

  it("returns success with all fields for an existing transaction", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
      externalTransactionId: "EXT-001",
    });

    const result = simulateGetTransaction(sale.transactionId!);
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("GetTransaction");
    expect(result.transactionId).toBe(sale.transactionId);
    expect(result.type).toBe("Sale");
    expect(result.transactionStatus).toBe("Approved");
    expect(result.terminalId).toBe("T001");
    expect(result.totalAmount).toBe("5000");
    expect(result.approvedAmount).toBe("5000");
    expect(result.feeAmount).toBe("150");
    expect(result.approvalNumber).toBeDefined();
    expect(result.accountType).toBe("Visa");
    expect(result.accountFirst6).toBe("411111");
    expect(result.accountLast4).toBe("1111");
    expect(result.accountMasked).toBe("411111******1111");
    expect(result.isDeclined).toBe(false);
    expect(result.externalTransactionId).toBe("EXT-001");
    expect(result.creationTime).toBeDefined();
    expect(result.tokenUsedIndicator).toBe("No");
    expect(result.gatewayResponseCode).toBe("00");
    expect(result.gatewayResponseMessage).toBe("APPROVAL");
  });

  it("returns error 302 for non-existent transaction", () => {
    const result = simulateGetTransaction("non-existent-id");
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("302");
  });
});

describe("pyxis_get_settled_transactions", () => {
  beforeEach(() => state.reset());

  it("returns empty list when no transactions are settled", () => {
    simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });

    const result = simulateGetSettledTransactions({ terminalId: "T001" });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("GetSettledTransactions");
    expect(result.transactions).toHaveLength(0);
  });

  it("returns transactions that have settledAt set", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });

    // Mark as settled
    state.updateTransaction(sale.transactionId!, { settledAt: new Date() });

    const result = simulateGetSettledTransactions({ terminalId: "T001" });
    expect(result.status).toBe("Success");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].transactionId).toBe(sale.transactionId);
    expect(result.transactions[0].totalAmount).toBe("5000");
    expect(result.transactions[0].settlementDate).toBeDefined();
  });
});
