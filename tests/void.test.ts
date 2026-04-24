import { describe, it, expect, beforeEach } from "vitest";
import { simulateSale, simulateVoid } from "../src/simulator.js";
import { state } from "../src/state.js";

describe("pyxis_void", () => {
  beforeEach(() => state.reset());

  it("voids an approved sale successfully", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });
    expect(sale.status).toBe("Success");

    const result = simulateVoid({
      terminalId: "T001",
      transactionToVoidId: sale.transactionId!,
    });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("Void");
    expect(result.referencedTransactionId).toBe(sale.transactionId);
    expect(result.accountType).toBe("Visa");
    expect(result.accountFirst6).toBe("411111");
    expect(result.accountLast4).toBe("1111");
  });

  it("returns error 350 when voiding an already voided transaction", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });

    simulateVoid({
      terminalId: "T001",
      transactionToVoidId: sale.transactionId!,
    });

    const result = simulateVoid({
      terminalId: "T001",
      transactionToVoidId: sale.transactionId!,
    });
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("350");
  });

  it("returns error 351 when voiding a settled transaction", () => {
    const sale = simulateSale({
      terminalId: "T001",
      accountInfo: { accountNumber: "4111111111111111", accountType: "Visa" },
      totalAmount: "5000",
    });

    // Manually mark the transaction as settled
    state.updateTransaction(sale.transactionId!, { settledAt: new Date() });

    const result = simulateVoid({
      terminalId: "T001",
      transactionToVoidId: sale.transactionId!,
    });
    expect(result.status).toBe("Error");
    expect(result.errors![0].errorCode).toBe("351");
  });
});
