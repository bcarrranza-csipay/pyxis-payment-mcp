import { simulateGetToken, simulateSale, simulateAuthorize } from "../src/simulator.js";
import { state } from "../src/state.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TERMINAL_ID = "test-terminal-001";
export const TEST_CARD = "4111111111111111";

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/** Clear all in-memory state between tests. */
export function resetState(): void {
  state.reset();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Authenticate with default sandbox credentials and return the token string. */
export function getTestToken(): string {
  const result = simulateGetToken("testuser", "testpass");
  if (result.status !== "Success" || !result.token) {
    throw new Error(`Failed to obtain test token: ${JSON.stringify(result)}`);
  }
  return result.token;
}

// ---------------------------------------------------------------------------
// Transaction helpers
// ---------------------------------------------------------------------------

export interface SaleOpts {
  amount?: number; // cents, default 1000
  token?: string;
  externalTransactionId?: string;
}

/** Create an approved sale with the default test card. Returns the full simulator result. */
export function makeApprovedSale(terminalId: string, opts: SaleOpts = {}) {
  const amount = opts.amount ?? 1000;
  return simulateSale({
    terminalId,
    accountInfo: {
      accountNumber: TEST_CARD,
      accountType: "Visa",
      accountAccessory: "12.2026",
    },
    totalAmount: amount.toString(),
    token: opts.token,
    externalTransactionId: opts.externalTransactionId,
  });
}

export interface AuthOpts {
  amount?: number; // cents, default 1000
  token?: string;
  externalTransactionId?: string;
}

/** Create an authorization with the default test card. Returns the full simulator result. */
export function makeAuthorization(terminalId: string, opts: AuthOpts = {}) {
  const amount = opts.amount ?? 1000;
  return simulateAuthorize({
    terminalId,
    accountInfo: {
      accountNumber: TEST_CARD,
      accountType: "Visa",
      accountAccessory: "12.2026",
    },
    totalAmount: amount.toString(),
    token: opts.token,
    externalTransactionId: opts.externalTransactionId,
  });
}
