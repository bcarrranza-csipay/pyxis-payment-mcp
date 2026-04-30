import { randomUUID } from "crypto";
import { state } from "./state.js";

/**
 * pyxis-client.ts
 *
 * Mimics the real Pyxis Payment API over HTTP.
 * When PYXIS_MODE=live this module makes actual fetch calls to the sandbox.
 * When PYXIS_MODE=mock (default for hackathon) it returns realistic
 * Pyxis-shaped responses without hitting any network — same field names,
 * same envelope, same error codes as production.
 *
 * The live path is fully wired and ready; just supply real env vars:
 *   PYXIS_BASE_URL, PYXIS_USERNAME, PYXIS_PASSWORD,
 *   PYXIS_SHARED_SECRET, PYXIS_TERMINAL_ID
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL   = process.env.PYXIS_BASE_URL     ?? "https://sandbox.csipay.com:8080";
const USERNAME   = process.env.PYXIS_USERNAME      ?? "sandbox_user";
const PASSWORD   = process.env.PYXIS_PASSWORD      ?? "sandbox_pass";
const SECRET     = process.env.PYXIS_SHARED_SECRET ?? "";
const MODE       = process.env.PYXIS_MODE          ?? "mock"; // "mock" | "live"

// ---------------------------------------------------------------------------
// Token cache (live mode)
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
let tokenExpiresAt: Date | null = null;

async function getLiveToken(): Promise<string> {
  const now = new Date();
  const oneHour = 60 * 60 * 1000;
  if (cachedToken && tokenExpiresAt && tokenExpiresAt.getTime() - now.getTime() > oneHour) {
    return cachedToken;
  }
  const creds = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
  const res = await fetch(`${BASE_URL}/getToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Basic ${creds}`,
      ...(SECRET ? { "pyxisAccess": SECRET } : {}),
    },
    body: JSON.stringify({}),
  });
  const data = await res.json() as Record<string, unknown>;
  if (data.status !== "Success") {
    throw new Error(`getToken failed: ${JSON.stringify(data)}`);
  }
  cachedToken = data.token as string;
  tokenExpiresAt = new Date(data.expiresAt as string);
  return cachedToken;
}

async function livePost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let token = await getLiveToken();
  const doRequest = async (t: string) =>
    fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${t}`,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(body),
    });

  let res = await doRequest(token);
  // Refresh token on 511 / 407 and retry once
  if (res.status === 511 || res.status === 407) {
    cachedToken = null;
    token = await getLiveToken();
    res = await doRequest(token);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function liveGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const token = await getLiveToken();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}${path}${qs ? "?" + qs : ""}`, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Helpers (mock mode)
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function approvalCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function feeFor(amount: number): number {
  const rate = parseFloat(process.env.PYXIS_FEE_RATE ?? "0.03");
  return Math.round(amount * (isNaN(rate) ? 0.03 : rate));
}

function masked(first6: string, last4: string): string {
  return `${first6}******${last4}`;
}

function detectType(pan: string): string {
  if (pan.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(pan) || /^2[2-7]/.test(pan)) return "MasterCard";
  if (/^3[47]/.test(pan)) return "Amex";
  if (pan.startsWith("6")) return "Discover";
  return "Visa";
}

// Failure cards — same as simulator
const FAILURE_CARDS: Record<string, string> = {
  "4000000000000002": "Do Not Honor",
  "5100000000000008": "Insufficient Funds",
  "4000000000000069": "Expired Card",
  "4000000000000127": "Incorrect CVV",
};

// Amount triggers — matches real Pyxis sandbox trigger amounts
const AMOUNT_TRIGGERS: Record<number, { code: string; gwCode: string; msg: string }> = {
  50001: { code: "110", gwCode: "05", msg: "Decline" },           // $500.01
  2123:  { code: "110", gwCode: "05", msg: "Network Error" },     // $21.23
  1:     { code: "110", gwCode: "05", msg: "Exceeds Approval Amount Limit" },
  23:    { code: "110", gwCode: "05", msg: "Network Error" },
};

function errResp(operation: string, msg: string, code: string, source = "Processing") {
  return {
    status: "Error",
    operation,
    responseTimestamp: ts(),
    errors: [{ errorSource: source, errorCode: code, errorMsg: msg }],
  };
}

// ---------------------------------------------------------------------------
// Exported API — same signatures as simulator.ts functions
// ---------------------------------------------------------------------------

// ── getToken ────────────────────────────────────────────────────────────────

export async function getToken(username: string, password: string): Promise<Record<string, unknown>> {
  if (MODE === "live") {
    const creds = Buffer.from(`${username}:${password}`).toString("base64");
    const res = await fetch(`${BASE_URL}/getToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Basic ${creds}`,
        ...(SECRET ? { "pyxisAccess": SECRET } : {}),
      },
      body: JSON.stringify({}),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  // Mock: any credentials succeed (mirror simulator behaviour)
  const expectedUser = process.env.PYXIS_MCP_USERNAME;
  const expectedPass = process.env.PYXIS_MCP_PASSWORD;
  if (expectedUser && expectedPass && (username !== expectedUser || password !== expectedPass)) {
    return errResp("Security", "Incorrect Credentials", "701", "Security");
  }
  if (username === "ratelimit_user") {
    return errResp("Security", "Rate limit exceeded. Try again later.", "713", "Security");
  }

  const token = randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 10 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  if (username === "expired_user") {
    const expiredAt = new Date(issuedAt.getTime() - 1000);
    return {
      status: "Success", operation: "Security", responseTimestamp: ts(),
      token, expiresAt: fmt(expiredAt), issueAt: fmt(issuedAt), issuer: "CSIPAY",
    };
  }

  return {
    status: "Success", operation: "Security", responseTimestamp: ts(),
    token, expiresAt: fmt(expiresAt), issueAt: fmt(issuedAt), issuer: "CSIPAY",
  };
}

// ── tokenize ────────────────────────────────────────────────────────────────

export async function tokenize(params: {
  terminalId: string;
  accountInfo: { accountNumber: string; accountType?: string; accountAccessory?: string };
  accountHolder?: { holderFirstName?: string; holderLastName?: string };
}): Promise<Record<string, unknown>> {
  const { terminalId, accountInfo } = params;
  const pan = accountInfo.accountNumber;
  const first6 = pan.slice(0, 6);
  const last4 = pan.slice(-4);
  const accountType = accountInfo.accountType ?? detectType(pan);

  if (MODE === "live") {
    return livePost("/tokenize", {
      terminalId,
      payment: {
        cardNumber: pan,
        accountType,
        expiryDate: convertExpiry(accountInfo.accountAccessory),
      },
      ...(params.accountHolder ? { accountHolder: params.accountHolder } : {}),
    });
  }

  // Mock: deterministic token based on terminalId + pan
  const token = deterministicUUID(`${terminalId}:${pan}`);
  return {
    status: "Success", operation: "Tokenize", responseTimestamp: ts(),
    terminalId, token, accountType, accountFirst6: first6, accountLast4: last4,
  };
}

// ── sale ────────────────────────────────────────────────────────────────────

export async function sale(params: {
  terminalId: string;
  token?: string;
  accountInfo?: { accountNumber?: string; accountType?: string; accountAccessory?: string };
  accountHolder?: { holderFirstName?: string; holderLastName?: string };
  totalAmount: string;
  externalTransactionId?: string;
  recurring?: string;
  recurringScheduleTransId?: string;
  saleWithTokenize?: boolean;
}): Promise<Record<string, unknown>> {
  const amount = parseInt(params.totalAmount, 10);

  if (MODE === "live") {
    const pan = params.accountInfo?.accountNumber;
    return livePost("/sale", {
      terminalId: params.terminalId,
      type: "sale",
      amount,
      ...(params.externalTransactionId ? { externalTransactionId: params.externalTransactionId } : {}),
      payment: pan
        ? { cardNumber: pan, accountType: params.accountInfo?.accountType ?? detectType(pan), expiryDate: convertExpiry(params.accountInfo?.accountAccessory) }
        : undefined,
      ...(params.token ? { token: params.token } : {}),
      ...(params.recurring ? { recurring: params.recurring } : {}),
      ...(params.recurringScheduleTransId ? { recurringScheduleTransId: params.recurringScheduleTransId } : {}),
    });
  }

  // Mock
  const { first6, last4, resolvedType, rawNumber } = resolveCard(params.token, params.accountInfo);

  // Failure card check
  const failMsg = FAILURE_CARDS[rawNumber];
  if (failMsg) {
    const txId = randomUUID();
    return {
      status: "Error", operation: "Sale", responseTimestamp: ts(),
      transactionId: txId, gatewayResponseCode: "05", gatewayResponseMessage: failMsg,
      errors: [{ errorSource: "Processing", errorCode: "110", errorMsg: failMsg }],
    };
  }

  // Amount trigger check
  const trigger = AMOUNT_TRIGGERS[amount];
  const txId = randomUUID();
  const approval = approvalCode();
  const fee = feeFor(amount);

  let recurringScheduleTransId: string | undefined;
  if (params.recurring === "First") recurringScheduleTransId = randomUUID();

  const generatedToken = params.saleWithTokenize && params.accountInfo?.accountNumber
    ? deterministicUUID(`${params.terminalId}:${params.accountInfo.accountNumber}`)
    : undefined;

  if (trigger) {
    return {
      status: "Error", operation: "Sale", responseTimestamp: ts(),
      transactionId: txId, gatewayResponseCode: trigger.gwCode, gatewayResponseMessage: trigger.msg,
      errors: [{ errorSource: "Processing", errorCode: trigger.code, errorMsg: trigger.msg }],
    };
  }

  return {
    status: "Success", operation: "Sale", responseTimestamp: ts(),
    transactionId: txId,
    ...(params.externalTransactionId ? { externalTransactionId: params.externalTransactionId } : {}),
    approvalNumber: approval,
    approvedAmount: amount.toString(),
    feeAmount: fee.toString(),
    accountType: resolvedType,
    accountFirst6: first6,
    accountLast4: last4,
    accountMasked: masked(first6, last4),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
    ...(recurringScheduleTransId ? { recurringScheduleTransId } : {}),
    ...(generatedToken ? { generatedToken } : {}),
  };
}

// ── authorize ───────────────────────────────────────────────────────────────

export async function authorize(params: {
  terminalId: string;
  token?: string;
  accountInfo?: { accountNumber?: string; accountType?: string; accountAccessory?: string };
  totalAmount: string;
  externalTransactionId?: string;
}): Promise<Record<string, unknown>> {
  const amount = parseInt(params.totalAmount, 10);

  if (MODE === "live") {
    const pan = params.accountInfo?.accountNumber;
    return livePost("/authorize", {
      terminalId: params.terminalId,
      type: "authorize",
      amount,
      ...(params.externalTransactionId ? { externalTransactionId: params.externalTransactionId } : {}),
      payment: pan
        ? { cardNumber: pan, accountType: params.accountInfo?.accountType ?? detectType(pan), expiryDate: convertExpiry(params.accountInfo?.accountAccessory) }
        : undefined,
      ...(params.token ? { token: params.token } : {}),
    });
  }

  const { first6, last4, resolvedType, rawNumber } = resolveCard(params.token, params.accountInfo);
  const failMsg = FAILURE_CARDS[rawNumber];
  if (failMsg) {
    return {
      status: "Error", operation: "Authorize", responseTimestamp: ts(),
      transactionId: randomUUID(), gatewayResponseCode: "05", gatewayResponseMessage: failMsg,
      errors: [{ errorSource: "Processing", errorCode: "110", errorMsg: failMsg }],
    };
  }

  const trigger = AMOUNT_TRIGGERS[amount];
  const txId = randomUUID();
  if (trigger) {
    return {
      status: "Error", operation: "Authorize", responseTimestamp: ts(),
      transactionId: txId, gatewayResponseCode: trigger.gwCode, gatewayResponseMessage: trigger.msg,
      errors: [{ errorSource: "Processing", errorCode: trigger.code, errorMsg: trigger.msg }],
    };
  }

  const approval = approvalCode();
  return {
    status: "Success", operation: "Authorize", responseTimestamp: ts(),
    transactionId: txId,
    ...(params.externalTransactionId ? { externalTransactionId: params.externalTransactionId } : {}),
    approvalNumber: approval,
    approvedAmount: amount.toString(),
    feeAmount: feeFor(amount).toString(),
    accountType: resolvedType, accountFirst6: first6, accountLast4: last4,
    accountMasked: masked(first6, last4),
    gatewayResponseCode: "00", gatewayResponseMessage: "APPROVAL",
  };
}

// ── capture ─────────────────────────────────────────────────────────────────

export async function capture(params: {
  terminalId: string;
  transactionId: string;
  totalAmount?: string;
}): Promise<Record<string, unknown>> {
  if (MODE === "live") {
    return livePost("/capture", {
      terminalId: params.terminalId,
      transactionId: params.transactionId,
      ...(params.totalAmount ? { amount: parseInt(params.totalAmount, 10) } : {}),
    });
  }

  // Mock: we don't track state in the client — return a realistic capture response
  const amount = params.totalAmount ? parseInt(params.totalAmount, 10) : 1000;
  const txId = randomUUID();
  return {
    status: "Success", operation: "Capture", responseTimestamp: ts(),
    transactionId: txId,
    referencedTransactionId: params.transactionId,
    approvalNumber: approvalCode(),
    approvedAmount: amount.toString(),
    feeAmount: feeFor(amount).toString(),
    accountType: "Visa", accountFirst6: "411111", accountLast4: "1111",
    accountMasked: "411111******1111",
    gatewayResponseCode: "00", gatewayResponseMessage: "APPROVAL",
  };
}

// ── void ────────────────────────────────────────────────────────────────────

export async function voidTransaction(params: {
  terminalId: string;
  transactionToVoidId: string;
}): Promise<Record<string, unknown>> {
  if (MODE === "live") {
    return livePost("/void", {
      terminalId: params.terminalId,
      transactionToVoidId: params.transactionToVoidId,
    });
  }

  const txId = randomUUID();
  return {
    status: "Success", operation: "Void", responseTimestamp: ts(),
    transactionId: txId,
    referencedTransactionId: params.transactionToVoidId,
    accountType: "Visa", accountFirst6: "411111", accountLast4: "1111",
    accountMasked: "411111******1111",
    gatewayResponseCode: "00", gatewayResponseMessage: "APPROVAL",
  };
}

// ── refund ──────────────────────────────────────────────────────────────────

export async function refund(params: {
  terminalId: string;
  transactionToRefundId: string;
  totalAmount?: string;
}): Promise<Record<string, unknown>> {
  if (MODE === "live") {
    return livePost("/refund", {
      terminalId: params.terminalId,
      transactionToRefundId: params.transactionToRefundId,
      ...(params.totalAmount ? { amount: parseInt(params.totalAmount, 10) } : {}),
    });
  }

  // Look up the original transaction amount from state so the refund reflects
  // the actual sale amount rather than a hardcoded default
  const originalTx = state.getTransaction(params.transactionToRefundId);
  const amount = params.totalAmount
    ? parseInt(params.totalAmount, 10)
    : (originalTx?.approvedAmount ?? 0);
  const txId = randomUUID();
  return {
    status: "Success", operation: "Refund", responseTimestamp: ts(),
    transactionId: txId,
    referencedTransactionId: params.transactionToRefundId,
    approvedAmount: amount.toString(),
    accountType: originalTx?.accountType ?? "Visa",
    accountFirst6: originalTx?.accountFirst6 ?? "411111",
    accountLast4: originalTx?.accountLast4 ?? "1111",
    accountMasked: masked(originalTx?.accountFirst6 ?? "411111", originalTx?.accountLast4 ?? "1111"),
    gatewayResponseCode: "00", gatewayResponseMessage: "APPROVAL",
  };
}

// ── accountVerify ───────────────────────────────────────────────────────────

export async function accountVerify(params: {
  terminalId: string;
  accountInfo: { accountNumber: string; accountType?: string; accountAccessory?: string };
  accountHolder?: { holderFirstName?: string; holderLastName?: string };
}): Promise<Record<string, unknown>> {
  const pan = params.accountInfo.accountNumber;
  const first6 = pan.slice(0, 6);
  const last4 = pan.slice(-4);
  const accountType = params.accountInfo.accountType ?? detectType(pan);

  if (MODE === "live") {
    return livePost("/accountVerify", {
      terminalId: params.terminalId,
      payment: { cardNumber: pan, accountType, expiryDate: convertExpiry(params.accountInfo.accountAccessory) },
      ...(params.accountHolder ? { accountHolder: params.accountHolder } : {}),
    });
  }

  const failMsg = FAILURE_CARDS[pan];
  if (failMsg) {
    return {
      status: "Error", operation: "AccountVerify", responseTimestamp: ts(),
      transactionId: randomUUID(), gatewayResponseCode: "05", gatewayResponseMessage: failMsg,
      errors: [{ errorSource: "Processing", errorCode: "110", errorMsg: failMsg }],
    };
  }

  return {
    status: "Success", operation: "AccountVerify", responseTimestamp: ts(),
    transactionId: randomUUID(),
    approvalNumber: approvalCode(),
    accountType, accountFirst6: first6, accountLast4: last4,
    accountMasked: masked(first6, last4),
    gatewayResponseCode: "00", gatewayResponseMessage: "APPROVAL",
  };
}

// ── getTransaction ──────────────────────────────────────────────────────────

export async function getTransaction(transactionId: string): Promise<Record<string, unknown>> {
  if (MODE === "live") {
    return liveGet("/transaction", { transactionId });
  }

  // Mock: return a realistic settled Sale record
  const now = new Date();
  const createdAt = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25hrs ago = settled
  return {
    status: "Success", operation: "GetTransaction", responseTimestamp: ts(),
    transactionId,
    type: "Sale",
    transactionStatus: "Approved",
    terminalId: process.env.PYXIS_TERMINAL_ID ?? "mock-terminal-001",
    totalAmount: "2530",
    approvedAmount: "2530",
    feeAmount: "76",
    approvalNumber: approvalCode(),
    accountType: "Visa",
    accountFirst6: "411111",
    accountLast4: "1111",
    accountMasked: "411111******1111",
    isDeclined: false,
    creationTime: createdAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
    settlementDate: createdAt.toISOString().split("T")[0],
    tokenUsedIndicator: "No",
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
  };
}

// ── getSettledTransactions ──────────────────────────────────────────────────

export async function getSettledTransactions(params: {
  terminalId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<Record<string, unknown>> {
  if (MODE === "live") {
    return liveGet("/settledTransactions", {
      ...(params.terminalId ? { terminalId: params.terminalId } : {}),
      ...(params.startDate ? { startDate: params.startDate } : {}),
      ...(params.endDate ? { endDate: params.endDate } : {}),
    });
  }

  const terminalId = params.terminalId ?? process.env.PYXIS_TERMINAL_ID ?? "mock-terminal-001";
  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
  return {
    status: "Success", operation: "GetSettledTransactions", responseTimestamp: ts(),
    transactions: [
      {
        transactionId: randomUUID(),
        type: "Sale",
        status: "Approved",
        terminalId,
        totalAmount: "5000",
        approvedAmount: "5000",
        feeAmount: "150",
        approvalNumber: approvalCode(),
        accountType: "Visa",
        accountFirst6: "411111",
        accountLast4: "1111",
        settlementDate: yesterday.toISOString().split("T")[0],
      },
      {
        transactionId: randomUUID(),
        type: "Sale",
        status: "Approved",
        terminalId,
        totalAmount: "2530",
        approvedAmount: "2530",
        feeAmount: "76",
        approvalNumber: approvalCode(),
        accountType: "MasterCard",
        accountFirst6: "555555",
        accountLast4: "4444",
        settlementDate: yesterday.toISOString().split("T")[0],
      },
    ],
  };
}

// ── convenienceFee ──────────────────────────────────────────────────────────

export async function convenienceFee(params: {
  terminalId: string;
  totalAmount: string;
  accountType: string;
}): Promise<Record<string, unknown>> {
  if (MODE === "live") {
    return livePost("/convenienceFee", {
      terminalId: params.terminalId,
      amount: parseInt(params.totalAmount, 10),
      accountType: params.accountType,
    });
  }

  const amount = parseInt(params.totalAmount, 10);
  const fee = feeFor(amount);
  return {
    status: "Success", operation: "ConvenienceFee", responseTimestamp: ts(),
    terminalId: params.terminalId,
    totalAmount: params.totalAmount,
    feeAmount: fee.toString(),
    totalWithFee: (amount + fee).toString(),
  };
}

// ── binLookup ───────────────────────────────────────────────────────────────

const BIN_DB: Record<string, object> = {
  "411111": { network: "visa",       credit: true,  debit: false, prepaid: false, commercial: false },
  "401288": { network: "visa",       credit: true,  debit: false, prepaid: false, commercial: false },
  "555555": { network: "mastercard", credit: true,  debit: false, prepaid: false, commercial: false },
  "222300": { network: "mastercard", credit: true,  debit: false, prepaid: false, commercial: false },
  "378282": { network: "amex",       credit: true,  debit: false, prepaid: false, commercial: false },
  "601198": { network: "discover",   credit: true,  debit: false, prepaid: false, commercial: false },
  "404163": { network: "visa",       credit: false, debit: true,  prepaid: false, commercial: false },
};

export async function binLookup(accountNumber: string): Promise<Record<string, unknown>> {
  if (MODE === "live") {
    return livePost("/binLookup", { accountNumber });
  }

  const bin = accountNumber.replace(/\s/g, "").slice(0, 6);
  const info = BIN_DB[bin] ?? { network: "Unknown", credit: false, debit: false, prepaid: false, commercial: false };
  return {
    status: "Success", operation: "BinLookup", responseTimestamp: ts(),
    bin,
    cardLength: accountNumber.replace(/\s/g, "").length || 16,
    testCard: true,
    ...info,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert MM.YYYY → YYYY-MM (Pyxis API format) */
function convertExpiry(accessory?: string): string {
  if (!accessory) return "2026-12";
  const [mm, yyyy] = accessory.split(".");
  return `${yyyy}-${mm}`;
}

/** Deterministic UUID from a seed string (for idempotent mock tokenization) */
function deterministicUUID(seed: string): string {
  // Simple but good enough for mock: hash the seed into a UUID-shaped string
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash).toString(16).padStart(8, "0");
  return `${h.slice(0,8)}-${h.slice(0,4)}-4${h.slice(1,4)}-a${h.slice(2,5)}-${h.slice(0,12).padEnd(12,"0")}`;
}

function resolveCard(
  token?: string,
  accountInfo?: { accountNumber?: string; accountType?: string }
): { first6: string; last4: string; resolvedType: string; rawNumber: string } {
  if (token) {
    // In mock mode we don't have a state store here — return generic Visa details
    return { first6: "411111", last4: "1111", resolvedType: "Visa", rawNumber: "4111111111111111" };
  }
  const num = accountInfo?.accountNumber ?? "4111111111111111";
  return {
    first6: num.slice(0, 6),
    last4: num.slice(-4),
    resolvedType: accountInfo?.accountType ?? detectType(num),
    rawNumber: num,
  };
}
