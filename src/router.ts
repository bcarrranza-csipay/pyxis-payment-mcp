import {
  simulateGetToken,
  simulateTokenize,
  simulateSale,
  simulateAccountVerify,
  simulateAuthorize,
  simulateCapture,
  simulateVoid,
  simulateRefund,
  simulateGetTransaction,
  simulateGetSettledTransactions,
  simulateConvenienceFee,
  simulateBinLookup,
  simulateSettleTransactions,
} from "./simulator.js";
import { requireValidToken } from "./auth-guard.js";
import { auditLog, sanitizeArgs } from "./audit.js";

// ---------------------------------------------------------------------------
// Input validation helper (error code 100)
// ---------------------------------------------------------------------------

function errorObj(operation: string, msg: string, code: string) {
  return {
    status: "Error",
    operation,
    responseTimestamp: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
    errors: [{ errorSource: "Processing", errorCode: code, errorMsg: msg }],
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function text(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Route tool calls to simulator functions
// ---------------------------------------------------------------------------

export function handleToolCall(
  name: string,
  args: Record<string, unknown>
): { content: Array<{ type: "text"; text: string }> } {
  const a = args;
  const startMs = Date.now();

  function textAndLog(result: unknown): { content: Array<{ type: "text"; text: string }> } {
    const r = result as Record<string, unknown> | null | undefined;
    const status = (r?.status as string) ?? "unknown";
    const errors = r?.errors as Array<{ errorCode?: string; errorMsg?: string }> | undefined;
    const firstError = errors?.[0];
    auditLog({
      tool: name,
      args: sanitizeArgs(a),
      status,
      ...(firstError?.errorCode ? { errorCode: firstError.errorCode } : {}),
      ...(firstError?.errorMsg ? { errorMsg: firstError.errorMsg } : {}),
      durationMs: Date.now() - startMs,
    });
    return text(result);
  }

  // Auth guard (skip for get_token, sandbox_info)
  const noAuthRequired = ["pyxis_get_token", "pyxis_sandbox_info"];
  if (!noAuthRequired.includes(name)) {
    const guard = requireValidToken(a.bearerToken as string | undefined);
    if (!guard.valid) return textAndLog(guard.response);
  }

  switch (name) {
    // -- Auth --------------------------------------------------------------
    case "pyxis_get_token": {
      return textAndLog(
        simulateGetToken(a.username as string, a.password as string)
      );
    }

    // -- Tokenize ----------------------------------------------------------
    case "pyxis_tokenize": {
      if (!a.terminalId) return textAndLog(errorObj("Tokenize", "Missing required field: terminalId", "100"));
      if (!a.accountInfo) return textAndLog(errorObj("Tokenize", "Missing required field: accountInfo", "100"));
      if (a.token) return textAndLog(errorObj("Tokenize", "Cannot pass a token to tokenize. Provide accountInfo instead.", "100"));
      return textAndLog(
        simulateTokenize({
          terminalId: a.terminalId as string,
          accountHolder: a.accountHolder as any,
          accountInfo: a.accountInfo as any,
        })
      );
    }

    // -- Sale --------------------------------------------------------------
    case "pyxis_sale": {
      if (!a.terminalId) return textAndLog(errorObj("Sale", "Missing required field: terminalId", "100"));
      if (!a.totalAmount) return textAndLog(errorObj("Sale", "Missing required field: totalAmount", "100"));
      if (a.accountInfo && a.token) return textAndLog(errorObj("Sale", "Provide either accountInfo or token, not both", "100"));
      if (!a.accountInfo && !a.token) return textAndLog(errorObj("Sale", "Provide either accountInfo or token", "100"));
      if (parseInt(a.totalAmount as string, 10) <= 0) return textAndLog(errorObj("Sale", "totalAmount must be greater than zero", "100"));
      return textAndLog(
        simulateSale({
          terminalId: a.terminalId as string,
          token: a.token as string | undefined,
          accountInfo: a.accountInfo as any,
          accountHolder: a.accountHolder as any,
          totalAmount: a.totalAmount as string,
          externalTransactionId: a.externalTransactionId as string | undefined,
          recurring: a.recurring as any,
          recurringScheduleTransId: a.recurringScheduleTransId as string | undefined,
          saleWithTokenize: a.saleWithTokenize as boolean | undefined,
        })
      );
    }

    // -- Account Verify ----------------------------------------------------
    case "pyxis_account_verify": {
      if (!a.terminalId) return textAndLog(errorObj("AccountVerify", "Missing required field: terminalId", "100"));
      if (!a.accountInfo) return textAndLog(errorObj("AccountVerify", "Missing required field: accountInfo", "100"));
      return textAndLog(
        simulateAccountVerify({
          terminalId: a.terminalId as string,
          accountInfo: a.accountInfo as any,
          accountHolder: a.accountHolder as any,
        })
      );
    }

    // -- Authorize ---------------------------------------------------------
    case "pyxis_authorize": {
      if (!a.terminalId) return textAndLog(errorObj("Authorize", "Missing required field: terminalId", "100"));
      if (!a.totalAmount) return textAndLog(errorObj("Authorize", "Missing required field: totalAmount", "100"));
      if (a.accountInfo && a.token) return textAndLog(errorObj("Authorize", "Provide either accountInfo or token, not both", "100"));
      if (!a.accountInfo && !a.token) return textAndLog(errorObj("Authorize", "Provide either accountInfo or token", "100"));
      if (parseInt(a.totalAmount as string, 10) <= 0) return textAndLog(errorObj("Authorize", "totalAmount must be greater than zero", "100"));
      if (a.recurring) return textAndLog(errorObj("Authorize", "Recurring payments are not supported on Authorize. Use Sale instead.", "100"));
      return textAndLog(
        simulateAuthorize({
          terminalId: a.terminalId as string,
          token: a.token as string | undefined,
          accountInfo: a.accountInfo as any,
          totalAmount: a.totalAmount as string,
          externalTransactionId: a.externalTransactionId as string | undefined,
        })
      );
    }

    // -- Capture -----------------------------------------------------------
    case "pyxis_capture": {
      if (!a.terminalId) return textAndLog(errorObj("Capture", "Missing required field: terminalId", "100"));
      if (!a.transactionId) return textAndLog(errorObj("Capture", "Missing required field: transactionId", "100"));
      if (a.totalAmount && parseInt(a.totalAmount as string, 10) <= 0) return textAndLog(errorObj("Capture", "totalAmount must be greater than zero", "100"));
      return textAndLog(
        simulateCapture({
          terminalId: a.terminalId as string,
          transactionId: a.transactionId as string,
          totalAmount: a.totalAmount as string | undefined,
        })
      );
    }

    // -- Void --------------------------------------------------------------
    case "pyxis_void": {
      if (!a.terminalId) return textAndLog(errorObj("Void", "Missing required field: terminalId", "100"));
      if (!a.transactionToVoidId) return textAndLog(errorObj("Void", "Missing required field: transactionToVoidId", "100"));
      return textAndLog(
        simulateVoid({
          terminalId: a.terminalId as string,
          transactionToVoidId: a.transactionToVoidId as string,
        })
      );
    }

    // -- Refund ------------------------------------------------------------
    case "pyxis_refund": {
      if (!a.terminalId) return textAndLog(errorObj("Refund", "Missing required field: terminalId", "100"));
      if (!a.transactionToRefundId) return textAndLog(errorObj("Refund", "Missing required field: transactionToRefundId", "100"));
      if (a.totalAmount && parseInt(a.totalAmount as string, 10) <= 0) return textAndLog(errorObj("Refund", "totalAmount must be greater than zero", "100"));
      return textAndLog(
        simulateRefund({
          terminalId: a.terminalId as string,
          transactionToRefundId: a.transactionToRefundId as string,
          totalAmount: a.totalAmount as string | undefined,
        })
      );
    }

    // -- Get Transaction ---------------------------------------------------
    case "pyxis_get_transaction": {
      if (!a.transactionId) return textAndLog(errorObj("GetTransaction", "Missing required field: transactionId", "100"));
      return textAndLog(simulateGetTransaction(a.transactionId as string));
    }

    // -- Settled Transactions ----------------------------------------------
    case "pyxis_get_settled_transactions": {
      return textAndLog(
        simulateGetSettledTransactions({
          terminalId: a.terminalId as string | undefined,
          startDate: a.startDate as string | undefined,
          endDate: a.endDate as string | undefined,
        })
      );
    }

    // -- Convenience Fee ---------------------------------------------------
    case "pyxis_convenience_fee": {
      if (!a.terminalId) return textAndLog(errorObj("ConvenienceFee", "Missing required field: terminalId", "100"));
      if (!a.totalAmount) return textAndLog(errorObj("ConvenienceFee", "Missing required field: totalAmount", "100"));
      if (!a.accountType) return textAndLog(errorObj("ConvenienceFee", "Missing required field: accountType", "100"));
      return textAndLog(
        simulateConvenienceFee({
          terminalId: a.terminalId as string,
          totalAmount: a.totalAmount as string,
          accountType: a.accountType as string,
        })
      );
    }

    // -- BIN Lookup --------------------------------------------------------
    case "pyxis_bin_lookup": {
      if (!a.accountNumber) return textAndLog(errorObj("BinLookup", "Missing required field: accountNumber", "100"));
      return textAndLog(simulateBinLookup(a.accountNumber as string));
    }

    // -- Settle Transactions -----------------------------------------------
    case "pyxis_settle_transactions": {
      return textAndLog(
        simulateSettleTransactions({
          terminalId: a.terminalId as string | undefined,
          transactionId: a.transactionId as string | undefined,
          olderThanHours: a.olderThanHours as number | undefined,
        })
      );
    }

    // -- Sandbox Info ------------------------------------------------------
    case "pyxis_sandbox_info": {
      return textAndLog({
        status: "Success",
        apiVersion: "Pyxis v3 (current)",
        note: "This MCP runs a local in-memory Pyxis sandbox. State resets when the server restarts.",
        authentication: {
          description: "Any username/password works in sandbox mode unless PYXIS_MCP_USERNAME/PYXIS_MCP_PASSWORD env vars are set.",
          tokenTTL: "10 days",
          errorCode511or407: "Token expired — call pyxis_get_token again",
        },
        testCards: [
          { number: "4111111111111111", type: "Visa", result: "Success" },
          { number: "4012888888881881", type: "Visa", result: "Success" },
          { number: "5555555555554444", type: "MasterCard", result: "Success" },
          { number: "2223000000000023", type: "MasterCard", result: "Success" },
          { number: "378282246310005",  type: "Amex (CVV is 4 digits)", result: "Success" },
          { number: "6011989578768275", type: "Discover", result: "Success" },
          { number: "4041639099002469", type: "Visa Debit", result: "Success" },
        ],
        failureCards: [
          { number: "4000000000000002", type: "Visa", result: "Decline: Do Not Honor" },
          { number: "5100000000000008", type: "MasterCard", result: "Decline: Insufficient Funds" },
          { number: "4000000000000069", type: "Visa", result: "Decline: Expired Card" },
        ],
        amountTriggers: [
          { amountCents: 1,  amountDisplay: "$0.01", result: "Decline: Exceeds Approval Amount Limit" },
          { amountCents: 23, amountDisplay: "$0.23", result: "Decline: Network Error" },
        ],
        testACH: {
          accountNumber: "Any 5\u201316 digit number",
          routingNumbers: ["021000021", "011401533", "091000019"],
        },
        conventions: {
          amounts: "Always in cents (integer as string). $25.30 = '2530'",
          cardExpiry: "MM.YYYY format \u2014 e.g. '05.2026'",
          flags: "'Yes' or 'No' (strings, not booleans)",
          dates: "YYYY-MM-DD",
          timestamps: "YYYY-MM-DD hh:mm:ss UTC",
          optionalFields: "Omit entirely \u2014 do not send null or empty string",
        },
        divergences: [
          "Settlement is simulated (~24hr auto-settle or manual via pyxis_settle_transactions) \u2014 not real batch processing",
          "In-memory state resets on server restart \u2014 no persistent storage",
          "Specific cent amounts ($0.01, $0.23) trigger test declines \u2014 production declines are network-based",
          "Fee calculation is a flat 3% \u2014 production uses complex per-merchant fee schedules",
          "No real network calls \u2014 no AVS, no 3D Secure, no CVV validation",
          "USD only \u2014 multi-currency not supported",
          "No webhooks or batch processing",
          "Card masking uses first6****last4 pattern \u2014 production masking may differ",
        ],
        keyReminders: [
          "Always check status field \u2014 HTTP 200 can still return status: 'Error'",
          "Same card + same terminalId always returns the same token from pyxis_tokenize",
          "For recurring: save recurringScheduleTransId from 'First' txn, pass to every 'InTrack' txn",
          "Void only works before settlement (~24hr). Use refund after settlement.",
          "Authorize/Capture pair does not support recurring \u2014 use Sale instead",
          "Failure cards always decline regardless of amount",
          "Additional triggers available in Phase 2: $0.50 network timeout, $0.51 processor unavailable, $0.52 partial approval, $0.99 duplicate detection",
        ],
      });
    }

    default:
      return textAndLog({ status: "Error", errorMsg: `Unknown tool: ${name}` });
  }
}
