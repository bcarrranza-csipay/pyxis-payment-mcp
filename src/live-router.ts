/**
 * live-router.ts
 *
 * Drop-in replacement for router.ts that routes tool calls through
 * pyxis-client.ts instead of the in-memory simulator.
 *
 * Activated when PYXIS_MODE=mock or PYXIS_MODE=live (anything except "simulator").
 * The http-bridge picks the right router based on the env var.
 */

import {
  getToken,
  tokenize,
  sale,
  authorize,
  capture,
  voidTransaction,
  refund,
  accountVerify,
  getTransaction,
  getSettledTransactions,
  convenienceFee,
  binLookup,
} from "./pyxis-client.js";
import { simulateGetAllTransactions } from "./simulator.js";
import { state } from "./state.js";
import type { Transaction, TransactionType, TransactionStatus } from "./state.js";
import { auditLog, sanitizeArgs } from "./audit.js";

// ---------------------------------------------------------------------------
// Persist mock responses to state (→ Redis) so history survives restarts
// ---------------------------------------------------------------------------

/**
 * After a successful mock operation, save the transaction to in-memory state
 * so it gets mirrored to Redis and returned by pyxis_get_all_transactions.
 */
function persistToState(
  result: Record<string, unknown>,
  type: TransactionType,
  terminalId: string,
  totalAmount: number,
  accountInfo?: { accountType?: string; accountFirst6?: string; accountLast4?: string }
): void {
  if (result.status !== "Success") return;
  const txId = result.transactionId as string;
  if (!txId) return;
  // Don't double-save if already in state
  if (state.getTransaction(txId)) return;

  const tx: Transaction = {
    transactionId:       txId,
    terminalId,
    type,
    status:              (result.transactionStatus as TransactionStatus) ?? "Approved",
    totalAmount,
    approvedAmount:      parseInt((result.approvedAmount as string) ?? "0", 10),
    feeAmount:           parseInt((result.feeAmount as string) ?? "0", 10),
    approvalNumber:      (result.approvalNumber as string) ?? "",
    accountType:         (result.accountType as string) ?? accountInfo?.accountType ?? "",
    accountFirst6:       (result.accountFirst6 as string) ?? accountInfo?.accountFirst6 ?? "",
    accountLast4:        (result.accountLast4 as string) ?? accountInfo?.accountLast4 ?? "",
    createdAt:           new Date(),
    gatewayResponseCode: (result.gatewayResponseCode as string) ?? "00",
    gatewayResponseMessage: (result.gatewayResponseMessage as string) ?? "APPROVAL",
    isDeclined:          false,
    referencedTransactionId: result.referencedTransactionId as string | undefined,
  };
  state.saveTransaction(tx); // this also fires redisSave()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function errorObj(operation: string, msg: string, code: string) {
  return {
    status: "Error",
    operation,
    responseTimestamp: ts(),
    errors: [{ errorSource: "Validation", errorCode: code, errorMsg: msg }],
  };
}

function text(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Simple token validation for mock/live mode
// In live mode the real Pyxis API validates the token on every call.
// In mock mode we do a lightweight check: token must be a non-empty string.
// ---------------------------------------------------------------------------

function validateBearerToken(token: string | undefined): { valid: boolean; error?: object } {
  if (!token) {
    return {
      valid: false,
      error: {
        status: "Error",
        responseTimestamp: ts(),
        errors: [{ errorSource: "Security", errorCode: "700", errorMsg: "Missing Bearer token. Call pyxis_get_token first." }],
      },
    };
  }
  // In mock mode any non-empty string is accepted (mirrors sandbox convenience)
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Main handler — mirrors router.ts switch structure exactly
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const a = args;
  const startMs = Date.now();

  async function respond(resultPromise: Promise<unknown> | unknown) {
    const result = await resultPromise;
    const r = result as Record<string, unknown> | null | undefined;
    const status = (r?.status as string) ?? "unknown";
    const errors = r?.errors as Array<{ errorCode?: string; errorMsg?: string }> | undefined;
    const firstError = errors?.[0];
    auditLog({
      tool: name,
      args: sanitizeArgs(a),
      status,
      ...(firstError?.errorCode ? { errorCode: firstError.errorCode } : {}),
      ...(firstError?.errorMsg  ? { errorMsg:  firstError.errorMsg  } : {}),
      durationMs: Date.now() - startMs,
    });
    return text(result);
  }

  // Auth guard — skip for get_token and sandbox_info
  const noAuth = ["pyxis_get_token", "pyxis_sandbox_info", "pyxis_get_mode", "pyxis_get_all_transactions"];
  if (!noAuth.includes(name)) {
    const guard = validateBearerToken(a.bearerToken as string | undefined);
    if (!guard.valid) return respond(guard.error);
  }

  switch (name) {

    // ── Auth ──────────────────────────────────────────────────────────────
    case "pyxis_get_token":
      return respond(getToken(a.username as string, a.password as string));

    // ── Tokenize ──────────────────────────────────────────────────────────
    case "pyxis_tokenize": {
      if (!a.terminalId)  return respond(errorObj("Tokenize", "Missing required field: terminalId", "100"));
      if (!a.accountInfo) return respond(errorObj("Tokenize", "Missing required field: accountInfo", "100"));
      if (a.token)        return respond(errorObj("Tokenize", "Cannot pass a token to tokenize. Provide accountInfo instead.", "100"));
      return respond(tokenize({
        terminalId:    a.terminalId as string,
        accountInfo:   a.accountInfo as any,
        accountHolder: a.accountHolder as any,
      }));
    }

    // ── Sale ──────────────────────────────────────────────────────────────
    case "pyxis_sale": {
      if (!a.terminalId)  return respond(errorObj("Sale", "Missing required field: terminalId", "100"));
      if (!a.totalAmount) return respond(errorObj("Sale", "Missing required field: totalAmount", "100"));
      if (a.accountInfo && a.token) return respond(errorObj("Sale", "Provide either accountInfo or token, not both", "100"));
      if (!a.accountInfo && !a.token) return respond(errorObj("Sale", "Provide either accountInfo or token", "100"));
      if (parseInt(a.totalAmount as string, 10) <= 0) return respond(errorObj("Sale", "totalAmount must be greater than zero", "100"));
      const saleResult = await sale({
        terminalId:             a.terminalId as string,
        token:                  a.token as string | undefined,
        accountInfo:            a.accountInfo as any,
        accountHolder:          a.accountHolder as any,
        totalAmount:            a.totalAmount as string,
        externalTransactionId:  a.externalTransactionId as string | undefined,
        recurring:              a.recurring as string | undefined,
        recurringScheduleTransId: a.recurringScheduleTransId as string | undefined,
        saleWithTokenize:       a.saleWithTokenize as boolean | undefined,
      });
      persistToState(saleResult, "Sale", a.terminalId as string, parseInt(a.totalAmount as string, 10));
      return respond(saleResult);
    }

    // ── Account Verify ────────────────────────────────────────────────────
    case "pyxis_account_verify": {
      if (!a.terminalId)  return respond(errorObj("AccountVerify", "Missing required field: terminalId", "100"));
      if (!a.accountInfo) return respond(errorObj("AccountVerify", "Missing required field: accountInfo", "100"));
      return respond(accountVerify({
        terminalId:    a.terminalId as string,
        accountInfo:   a.accountInfo as any,
        accountHolder: a.accountHolder as any,
      }));
    }

    // ── Authorize ─────────────────────────────────────────────────────────
    case "pyxis_authorize": {
      if (!a.terminalId)  return respond(errorObj("Authorize", "Missing required field: terminalId", "100"));
      if (!a.totalAmount) return respond(errorObj("Authorize", "Missing required field: totalAmount", "100"));
      if (a.accountInfo && a.token) return respond(errorObj("Authorize", "Provide either accountInfo or token, not both", "100"));
      if (!a.accountInfo && !a.token) return respond(errorObj("Authorize", "Provide either accountInfo or token", "100"));
      if (parseInt(a.totalAmount as string, 10) <= 0) return respond(errorObj("Authorize", "totalAmount must be greater than zero", "100"));
      if (a.recurring) return respond(errorObj("Authorize", "Recurring payments are not supported on Authorize. Use Sale instead.", "100"));
      const authResult = await authorize({
        terminalId:            a.terminalId as string,
        token:                 a.token as string | undefined,
        accountInfo:           a.accountInfo as any,
        totalAmount:           a.totalAmount as string,
        externalTransactionId: a.externalTransactionId as string | undefined,
      });
      persistToState(authResult, "Authorization", a.terminalId as string, parseInt(a.totalAmount as string, 10));
      return respond(authResult);
    }

    // ── Capture ───────────────────────────────────────────────────────────
    case "pyxis_capture": {
      if (!a.terminalId)     return respond(errorObj("Capture", "Missing required field: terminalId", "100"));
      if (!a.transactionId)  return respond(errorObj("Capture", "Missing required field: transactionId", "100"));
      if (a.totalAmount && parseInt(a.totalAmount as string, 10) <= 0)
        return respond(errorObj("Capture", "totalAmount must be greater than zero", "100"));
      const captureAmt = a.totalAmount ? parseInt(a.totalAmount as string, 10) : 0;
      const captureResult = await capture({
        terminalId:    a.terminalId as string,
        transactionId: a.transactionId as string,
        totalAmount:   a.totalAmount as string | undefined,
      });
      persistToState(captureResult, "Capture", a.terminalId as string, captureAmt);
      return respond(captureResult);
    }

    // ── Void ──────────────────────────────────────────────────────────────
    case "pyxis_void": {
      if (!a.terminalId)          return respond(errorObj("Void", "Missing required field: terminalId", "100"));
      if (!a.transactionToVoidId) return respond(errorObj("Void", "Missing required field: transactionToVoidId", "100"));
      const voidResult = await voidTransaction({
        terminalId:          a.terminalId as string,
        transactionToVoidId: a.transactionToVoidId as string,
      });
      persistToState(voidResult, "Void", a.terminalId as string, 0);
      return respond(voidResult);
    }

    // ── Refund ────────────────────────────────────────────────────────────
    case "pyxis_refund": {
      if (!a.terminalId)            return respond(errorObj("Refund", "Missing required field: terminalId", "100"));
      if (!a.transactionToRefundId) return respond(errorObj("Refund", "Missing required field: transactionToRefundId", "100"));
      if (a.totalAmount && parseInt(a.totalAmount as string, 10) <= 0)
        return respond(errorObj("Refund", "totalAmount must be greater than zero", "100"));
      const refundAmt = a.totalAmount ? parseInt(a.totalAmount as string, 10) : 0;
      const refundResult = await refund({
        terminalId:            a.terminalId as string,
        transactionToRefundId: a.transactionToRefundId as string,
        totalAmount:           a.totalAmount as string | undefined,
      });
      persistToState(refundResult, "Refund", a.terminalId as string, refundAmt);
      return respond(refundResult);
    }

    // ── Get Transaction ───────────────────────────────────────────────────
    case "pyxis_get_transaction": {
      if (!a.transactionId) return respond(errorObj("GetTransaction", "Missing required field: transactionId", "100"));
      return respond(getTransaction(a.transactionId as string));
    }

    // ── Settled Transactions ──────────────────────────────────────────────
    case "pyxis_get_settled_transactions":
      return respond(getSettledTransactions({
        terminalId: a.terminalId as string | undefined,
        startDate:  a.startDate  as string | undefined,
        endDate:    a.endDate    as string | undefined,
      }));

    // ── Convenience Fee ───────────────────────────────────────────────────
    case "pyxis_convenience_fee": {
      if (!a.terminalId)  return respond(errorObj("ConvenienceFee", "Missing required field: terminalId", "100"));
      if (!a.totalAmount) return respond(errorObj("ConvenienceFee", "Missing required field: totalAmount", "100"));
      if (!a.accountType) return respond(errorObj("ConvenienceFee", "Missing required field: accountType", "100"));
      return respond(convenienceFee({
        terminalId:  a.terminalId  as string,
        totalAmount: a.totalAmount as string,
        accountType: a.accountType as string,
      }));
    }

    // ── BIN Lookup ────────────────────────────────────────────────────────
    case "pyxis_bin_lookup": {
      if (!a.accountNumber) return respond(errorObj("BinLookup", "Missing required field: accountNumber", "100"));
      return respond(binLookup(a.accountNumber as string));
    }

    // ── Get All Transactions (history restore from Redis) ─────────────────
    case "pyxis_get_all_transactions":
      return respond(
        simulateGetAllTransactions({
          terminalId: a.terminalId as string | undefined,
          limit: a.limit as number | undefined,
        })
      );

    // ── Settle Transactions (simulator-only — not available in live/mock) ─
    case "pyxis_settle_transactions":
      return respond({
        status: "Success",
        operation: "SettleTransactions",
        responseTimestamp: ts(),
        message: "Settlement is handled automatically by the Pyxis gateway in live/mock mode.",
        settled: 0,
        transactions: [],
      });

    // ── Sandbox Info ──────────────────────────────────────────────────────
    case "pyxis_sandbox_info":
      return respond({
        status: "Success",
        mode: process.env.PYXIS_MODE ?? "mock",
        apiVersion: "Pyxis v3 (current)",
        note: "Running in live-router mode. Calls go through pyxis-client.ts.",
        testCards: [
          { number: "4111111111111111", type: "Visa",       result: "Success" },
          { number: "5555555555554444", type: "MasterCard", result: "Success" },
          { number: "378282246310005",  type: "Amex",       result: "Success" },
          { number: "6011989578768275", type: "Discover",   result: "Success" },
          { number: "4242424242424242", type: "Generic",    result: "Failure (Till Gateway)" },
        ],
        amountTriggers: [
          { amountCents: 50001, amountDisplay: "$500.01", result: "Decline" },
          { amountCents: 2123,  amountDisplay: "$21.23",  result: "Network Error" },
        ],
        conventions: {
          amounts:    "Cents as string. $25.30 = '2530'",
          cardExpiry: "MM.YYYY — e.g. '05.2026'",
          timestamps: "YYYY-MM-DD hh:mm:ss UTC",
        },
      });

    // ── Get Mode — returns current PYXIS_MODE + seeded mock transactions ──
    case "pyxis_get_mode": {
      const mode = process.env.PYXIS_MODE ?? "simulator";
      const now = new Date();
      const fmt = (d: Date) => d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
      const ago = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);

      const seededTransactions = mode === "mock" ? [
        {
          transactionId: "mock-seed-001",
          type: "Sale",
          transactionStatus: "Approved",
          terminalId: process.env.PYXIS_TERMINAL_ID ?? "mock-terminal-001",
          totalAmount: "5000",
          approvedAmount: "5000",
          feeAmount: "150",
          approvalNumber: "A1B2C3",
          accountType: "Visa",
          accountFirst6: "411111",
          accountLast4: "1111",
          accountMasked: "411111******1111",
          gatewayResponseCode: "00",
          gatewayResponseMessage: "APPROVAL",
          creationTime: fmt(ago(120)),
          isDeclined: false,
          isMockSeed: true,
        },
        {
          transactionId: "mock-seed-002",
          type: "Sale",
          transactionStatus: "Approved",
          terminalId: process.env.PYXIS_TERMINAL_ID ?? "mock-terminal-001",
          totalAmount: "2530",
          approvedAmount: "2530",
          feeAmount: "76",
          approvalNumber: "D4E5F6",
          accountType: "MasterCard",
          accountFirst6: "555555",
          accountLast4: "4444",
          accountMasked: "555555******4444",
          gatewayResponseCode: "00",
          gatewayResponseMessage: "APPROVAL",
          creationTime: fmt(ago(60)),
          isDeclined: false,
          isMockSeed: true,
        },
        {
          transactionId: "mock-seed-003",
          type: "Sale",
          transactionStatus: "Declined",
          terminalId: process.env.PYXIS_TERMINAL_ID ?? "mock-terminal-001",
          totalAmount: "50001",
          approvedAmount: "0",
          feeAmount: "0",
          approvalNumber: "",
          accountType: "Visa",
          accountFirst6: "424242",
          accountLast4: "4242",
          accountMasked: "424242******4242",
          gatewayResponseCode: "05",
          gatewayResponseMessage: "Decline",
          creationTime: fmt(ago(30)),
          isDeclined: true,
          isMockSeed: true,
        },
      ] : [];

      return respond({
        status: "Success",
        operation: "GetMode",
        responseTimestamp: fmt(now),
        mode,
        seededTransactions,
      });
    }

    default:
      return respond({ status: "Error", errorMsg: `Unknown tool: ${name}` });
  }
}
