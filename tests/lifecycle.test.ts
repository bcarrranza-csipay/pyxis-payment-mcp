import { describe, it, expect, beforeEach } from "vitest";
import {
  simulateGetToken,
  simulateTokenize,
  simulateSale,
  simulateGetTransaction,
  simulateVoid,
} from "../src/simulator.js";
import { state } from "../src/state.js";

describe("end-to-end lifecycle", () => {
  beforeEach(() => state.reset());

  it("get_token → tokenize → sale with token → get_transaction → void", () => {
    // Step 1: Get auth token
    const tokenResult = simulateGetToken("testuser", "testpass");
    expect(tokenResult.status).toBe("Success");
    expect(tokenResult.token).toBeDefined();

    // Step 2: Tokenize a card
    const tokenizeResult = simulateTokenize({
      terminalId: "T001",
      accountHolder: { holderFirstName: "John", holderLastName: "Doe" },
      accountInfo: {
        accountNumber: "4111111111111111",
        accountType: "Visa",
        accountAccessory: "12.2026",
      },
    });
    expect(tokenizeResult.status).toBe("Success");
    expect(tokenizeResult.token).toBeDefined();
    expect(tokenizeResult.accountFirst6).toBe("411111");
    expect(tokenizeResult.accountLast4).toBe("1111");

    // Step 3: Sale using the tokenized card
    const saleResult = simulateSale({
      terminalId: "T001",
      token: tokenizeResult.token,
      totalAmount: "10000",
      externalTransactionId: "ORDER-001",
    });
    expect(saleResult.status).toBe("Success");
    expect(saleResult.transactionId).toBeDefined();
    expect(saleResult.approvedAmount).toBe("10000");
    expect(saleResult.feeAmount).toBe("300");
    expect(saleResult.accountType).toBe("Visa");
    expect(saleResult.gatewayResponseCode).toBe("00");

    // Step 4: Get the transaction details
    const getResult = simulateGetTransaction(saleResult.transactionId!);
    expect(getResult.status).toBe("Success");
    expect(getResult.transactionId).toBe(saleResult.transactionId);
    expect(getResult.type).toBe("Sale");
    expect(getResult.transactionStatus).toBe("Approved");
    expect(getResult.totalAmount).toBe("10000");
    expect(getResult.tokenUsedIndicator).toBe("Yes");
    expect(getResult.externalTransactionId).toBe("ORDER-001");

    // Step 5: Void the sale
    const voidResult = simulateVoid({
      terminalId: "T001",
      transactionToVoidId: saleResult.transactionId!,
    });
    expect(voidResult.status).toBe("Success");
    expect(voidResult.referencedTransactionId).toBe(saleResult.transactionId);

    // Verify the original transaction is now voided
    const afterVoid = simulateGetTransaction(saleResult.transactionId!);
    expect(afterVoid.status).toBe("Success");
    expect(afterVoid.transactionStatus).toBe("Voided");
  });
});
