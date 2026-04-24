import { randomUUID } from "crypto";
import { state, Transaction, TransactionType } from "./state.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Test cards that always succeed
const SUCCESS_CARDS = new Set([
  "4111111111111111",
  "4012888888881881",
  "5555555555554444",
  "2223000000000023",
  "378282246310005",
  "6011989578768275",
  "4041639099002469",
]);

// Card → account type mapping for known test cards
const CARD_TYPE_MAP: Record<string, string> = {
  "4111111111111111": "Visa",
  "4012888888881881": "Visa",
  "5555555555554444": "MasterCard",
  "2223000000000023": "MasterCard",
  "378282246310005": "Amex",
  "6011989578768275": "Discover",
  "4041639099002469": "Visa",
};

// Payrix amount-based triggers (amount in cents)
const AMOUNT_TRIGGERS: Record<number, { errorCode: string; gatewayCode: string; message: string }> = {
  1:  { errorCode: "110", gatewayCode: "05", message: "Exceeds Approval Amount Limit" },   // $0.01
  23: { errorCode: "110", gatewayCode: "05", message: "Network Error" },                    // $0.23
  50: { errorCode: "120", gatewayCode: "05", message: "Network Timeout" },                  // $0.50
  51: { errorCode: "121", gatewayCode: "05", message: "Processor Unavailable" },            // $0.51
};

// Test cards that always fail
const FAILURE_CARDS: Record<string, string> = {
  "4000000000000002": "Do Not Honor",
  "5100000000000008": "Insufficient Funds",
  "4000000000000069": "Expired Card",
  "4000000000000127": "Incorrect CVV",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function approvalCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function feeForAmount(amount: number): number {
  const envRate = process.env.PYXIS_FEE_RATE;
  let rate = 0.03; // default 3%
  if (envRate !== undefined) {
    const parsed = parseFloat(envRate);
    if (!isNaN(parsed)) {
      rate = Math.max(0, Math.min(1, parsed)); // clamp to [0, 1]
    }
  }
  return Math.round(amount * rate);
}

function accountMasked(first6: string, last4: string): string {
  return `${first6}******${last4}`;
}

function detectCardType(accountNumber: string): string {
  if (CARD_TYPE_MAP[accountNumber]) return CARD_TYPE_MAP[accountNumber];
  const n = accountNumber.replace(/\s/g, "");
  if (n.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return "MasterCard";
  if (/^3[47]/.test(n)) return "Amex";
  if (n.startsWith("6")) return "Discover";
  return "Visa";
}

function isBadCard(accountNumber: string): boolean {
  // Any unknown card number that isn't in the success set is treated as decline
  // (in sandbox: unknown cards succeed by default unless amount triggers kick in)
  return false;
}

function resolveCardDetails(
  terminalId: string,
  token?: string,
  accountNumber?: string,
  accountType?: string,
  expires?: string
): {
  first6: string;
  last4: string;
  resolvedType: string;
  resolvedExpires: string;
  rawNumber: string;
} {
  if (token) {
    const card = state.getTokenizedCard(token);
    if (card) {
      return {
        first6: card.accountFirst6,
        last4: card.accountLast4,
        resolvedType: card.accountType,
        resolvedExpires: card.expires,
        rawNumber: card.accountFirst6 + "**********" + card.accountLast4,
      };
    }
  }
  const num = accountNumber ?? "411111111111111";
  return {
    first6: num.slice(0, 6),
    last4: num.slice(-4),
    resolvedType: accountType ?? detectCardType(num),
    resolvedExpires: expires ?? "12.2026",
    rawNumber: num,
  };
}

function checkAmountTrigger(
  amount: number
): { declined: boolean; message: string; errorCode: string; gatewayCode: string } {
  const trigger = AMOUNT_TRIGGERS[amount];
  if (trigger) return { declined: true, message: trigger.message, errorCode: trigger.errorCode, gatewayCode: trigger.gatewayCode };
  return { declined: false, message: "", errorCode: "", gatewayCode: "" };
}

function checkFailureCard(accountNumber: string): { declined: boolean; message: string } {
  const msg = FAILURE_CARDS[accountNumber];
  if (msg) return { declined: true, message: msg };
  return { declined: false, message: "" };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface GetTokenResult {
  status: "Success" | "Error";
  operation: "Security";
  responseTimestamp: string;
  token?: string;
  expiresAt?: string;
  issueAt?: string;
  issuer?: string;
  errors?: Array<{ errorSource: string; errorCode: string; errorMsg: string }>;
}

export function simulateGetToken(
  username: string,
  _password: string
): GetTokenResult {
  // In sandbox mode any credentials succeed. Override by setting
  // PYXIS_MCP_USERNAME / PYXIS_MCP_PASSWORD env vars.
  const expectedUser = process.env.PYXIS_MCP_USERNAME;
  const expectedPass = process.env.PYXIS_MCP_PASSWORD;
  if (
    expectedUser &&
    expectedPass &&
    (username !== expectedUser || _password !== expectedPass)
  ) {
    return {
      status: "Error",
      operation: "Security",
      responseTimestamp: timestamp(),
      errors: [
        {
          errorSource: "Security",
          errorCode: "701",
          errorMsg: "Incorrect Credentials",
        },
      ],
    };
  }

  // Test credential: expired_user — issues a token that is already expired
  if (username === "expired_user") {
    const expiredRecord = state.issueToken(username);
    const expiredAt = new Date(expiredRecord.issuedAt.getTime() - 1000);
    state.updateTokenExpiry(expiredRecord.token, expiredAt);
    return {
      status: "Success",
      operation: "Security",
      responseTimestamp: timestamp(),
      token: expiredRecord.token,
      expiresAt: expiredAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
      issueAt: expiredRecord.issuedAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
      issuer: "CSIPAY",
    };
  }

  // Test credential: ratelimit_user — always returns rate limit error
  if (username === "ratelimit_user") {
    return {
      status: "Error",
      operation: "Security",
      responseTimestamp: timestamp(),
      errors: [
        {
          errorSource: "Security",
          errorCode: "713",
          errorMsg: "Rate limit exceeded. Try again later.",
        },
      ],
    };
  }

  const record = state.issueToken(username);
  return {
    status: "Success",
    operation: "Security",
    responseTimestamp: timestamp(),
    token: record.token,
    expiresAt: record.expiresAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
    issueAt: record.issuedAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
    issuer: "CSIPAY",
  };
}

// ---------------------------------------------------------------------------
// Tokenize
// ---------------------------------------------------------------------------

export function simulateTokenize(params: {
  terminalId: string;
  accountHolder?: { holderFirstName?: string; holderLastName?: string };
  accountInfo: {
    accountNumber: string;
    accountType: string;
    accountAccessory?: string; // expiry MM.YYYY
  };
}) {
  const { terminalId, accountHolder, accountInfo } = params;
  const card = state.tokenizeCard(
    terminalId,
    accountInfo.accountNumber,
    accountInfo.accountType,
    accountInfo.accountAccessory ?? "12.2026",
    accountHolder?.holderFirstName,
    accountHolder?.holderLastName
  );

  return {
    status: "Success",
    operation: "Tokenize",
    responseTimestamp: timestamp(),
    terminalId,
    token: card.token,
    accountType: card.accountType,
    accountFirst6: card.accountFirst6,
    accountLast4: card.accountLast4,
  };
}

// ---------------------------------------------------------------------------
// Sale
// ---------------------------------------------------------------------------

export function simulateSale(params: {
  terminalId: string;
  token?: string;
  accountInfo?: {
    accountNumber?: string;
    accountType?: string;
    accountAccessory?: string;
  };
  accountHolder?: { holderFirstName?: string; holderLastName?: string };
  totalAmount: string; // cents as string
  externalTransactionId?: string;
  recurring?: "None" | "NoTrack" | "First" | "InTrack";
  recurringScheduleTransId?: string;
  saleWithTokenize?: boolean;
}) {
  const amount = parseInt(params.totalAmount, 10);
  const { first6, last4, resolvedType, rawNumber } = resolveCardDetails(
    params.terminalId,
    params.token,
    params.accountInfo?.accountNumber,
    params.accountInfo?.accountType,
    params.accountInfo?.accountAccessory
  );

  const failureCheck = checkFailureCard(rawNumber);
  if (failureCheck.declined) {
    const txId = state.newTransactionId();
    const tx: Transaction = {
      transactionId: txId,
      terminalId: params.terminalId,
      type: "Sale",
      status: "Declined",
      totalAmount: amount,
      approvedAmount: 0,
      feeAmount: 0,
      approvalNumber: "",
      accountType: resolvedType,
      accountFirst6: first6,
      accountLast4: last4,
      token: params.token,
      externalTransactionId: params.externalTransactionId,
      createdAt: new Date(),
      gatewayResponseCode: "05",
      gatewayResponseMessage: failureCheck.message,
      isDeclined: true,
    };
    state.saveTransaction(tx);
    return {
      status: "Error",
      operation: "Sale",
      responseTimestamp: timestamp(),
      transactionId: txId,
      gatewayResponseCode: "05",
      gatewayResponseMessage: failureCheck.message,
      errors: [{ errorSource: "Processing", errorCode: "110", errorMsg: failureCheck.message }],
    };
  }

  // Duplicate detection trigger ($0.99 = 99 cents)
  if (amount === 99) {
    const dup = state.findDuplicate(params.terminalId, amount, first6, last4);
    if (dup) {
      return {
        status: "Error",
        operation: "Sale",
        responseTimestamp: timestamp(),
        errors: [{ errorSource: "Processing", errorCode: "355", errorMsg: "Duplicate transaction detected" }],
      };
    }
  }

  const trigger = checkAmountTrigger(amount);

  // Partial approval trigger: $0.52 approves for half the amount
  if (amount === 52) {
    const approvedAmt = Math.floor(amount / 2); // 26
    const partialFee = feeForAmount(approvedAmt);
    const partialTxId = state.newTransactionId();
    const partialApproval = approvalCode();
    const partialTx: Transaction = {
      transactionId: partialTxId,
      terminalId: params.terminalId,
      type: "Sale",
      status: "Approved",
      totalAmount: amount,
      approvedAmount: approvedAmt,
      feeAmount: partialFee,
      approvalNumber: partialApproval,
      accountType: resolvedType,
      accountFirst6: first6,
      accountLast4: last4,
      token: params.token,
      externalTransactionId: params.externalTransactionId,
      createdAt: new Date(),
      gatewayResponseCode: "10",
      gatewayResponseMessage: "PARTIAL APPROVAL",
      isDeclined: false,
    };
    state.saveTransaction(partialTx);
    return {
      status: "Success",
      operation: "Sale",
      responseTimestamp: timestamp(),
      transactionId: partialTxId,
      approvalNumber: partialApproval,
      approvedAmount: approvedAmt.toString(),
      feeAmount: partialFee.toString(),
      accountType: resolvedType,
      accountFirst6: first6,
      accountLast4: last4,
      accountMasked: accountMasked(first6, last4),
      gatewayResponseCode: "10",
      gatewayResponseMessage: "PARTIAL APPROVAL",
    };
  }

  const fee = feeForAmount(amount);
  const txId = state.newTransactionId();
  const approval = approvalCode();

  let recurringScheduleTransId: string | undefined;
  if (params.recurring === "First") {
    if (params.recurringScheduleTransId) {
      return errorResponse("Sale", "Do not provide recurringScheduleTransId with recurring='First'. It will be generated.", "100");
    }
    recurringScheduleTransId = randomUUID();
  } else if (params.recurring === "InTrack") {
    if (!params.recurringScheduleTransId) {
      return errorResponse("Sale", "recurringScheduleTransId is required for InTrack recurring", "305");
    }
    const firstTx = state.findByRecurringScheduleTransId(params.recurringScheduleTransId);
    if (!firstTx) {
      return errorResponse("Sale", "Recurring schedule transaction not found", "305");
    }
    if (firstTx.status === "Voided" || firstTx.status === "Refunded") {
      return errorResponse("Sale", "Recurring schedule is no longer active", "305");
    }
    recurringScheduleTransId = params.recurringScheduleTransId;
  }

  let generatedToken: string | undefined;
  if (params.saleWithTokenize && params.accountInfo?.accountNumber) {
    const card = state.tokenizeCard(
      params.terminalId,
      params.accountInfo.accountNumber,
      params.accountInfo.accountType ?? detectCardType(params.accountInfo.accountNumber),
      params.accountInfo.accountAccessory ?? "12.2026",
      params.accountHolder?.holderFirstName,
      params.accountHolder?.holderLastName
    );
    generatedToken = card.token;
  }

  const tx: Transaction = {
    transactionId: txId,
    terminalId: params.terminalId,
    type: "Sale",
    status: trigger.declined ? "Declined" : "Approved",
    totalAmount: amount,
    approvedAmount: trigger.declined ? 0 : amount,
    feeAmount: trigger.declined ? 0 : fee,
    approvalNumber: trigger.declined ? "" : approval,
    accountType: resolvedType,
    accountFirst6: first6,
    accountLast4: last4,
    token: params.token,
    externalTransactionId: params.externalTransactionId,
    createdAt: new Date(),
    recurringScheduleTransId,
    gatewayResponseCode: trigger.declined ? trigger.gatewayCode : "00",
    gatewayResponseMessage: trigger.declined ? trigger.message : "APPROVAL",
    isDeclined: trigger.declined,
  };
  state.saveTransaction(tx);

  if (trigger.declined) {
    return {
      status: "Error",
      operation: "Sale",
      responseTimestamp: timestamp(),
      transactionId: txId,
      errors: [
        {
          errorSource: "Processing",
          errorCode: trigger.errorCode,
          errorMsg: trigger.message,
        },
      ],
    };
  }

  return {
    status: "Success",
    operation: "Sale",
    responseTimestamp: timestamp(),
    transactionId: txId,
    externalTransactionId: params.externalTransactionId,
    approvalNumber: approval,
    approvedAmount: amount.toString(),
    feeAmount: fee.toString(),
    accountType: resolvedType,
    accountFirst6: first6,
    accountLast4: last4,
    accountMasked: accountMasked(first6, last4),
    ...(recurringScheduleTransId ? { recurringScheduleTransId } : {}),
    ...(generatedToken ? { generatedToken } : {}),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
  };
}

// ---------------------------------------------------------------------------
// Account Verify
// ---------------------------------------------------------------------------

export function simulateAccountVerify(params: {
  terminalId: string;
  accountInfo: {
    accountNumber: string;
    accountType: string;
    accountAccessory?: string;
  };
  accountHolder?: { holderFirstName?: string; holderLastName?: string };
}) {
  const { accountInfo, terminalId } = params;
  const trigger = checkAmountTrigger(0); // verify never has amount
  const txId = state.newTransactionId();
  const first6 = accountInfo.accountNumber.slice(0, 6);
  const last4 = accountInfo.accountNumber.slice(-4);

  const failureCheck = checkFailureCard(accountInfo.accountNumber);
  if (failureCheck.declined) {
    const declinedTx: Transaction = {
      transactionId: txId,
      terminalId,
      type: "AccountVerify",
      status: "Declined",
      totalAmount: 0,
      approvedAmount: 0,
      feeAmount: 0,
      approvalNumber: "",
      accountType: accountInfo.accountType,
      accountFirst6: first6,
      accountLast4: last4,
      createdAt: new Date(),
      gatewayResponseCode: "05",
      gatewayResponseMessage: failureCheck.message,
      isDeclined: true,
    };
    state.saveTransaction(declinedTx);
    return {
      status: "Error",
      operation: "AccountVerify",
      responseTimestamp: timestamp(),
      transactionId: txId,
      gatewayResponseCode: "05",
      gatewayResponseMessage: failureCheck.message,
      errors: [{ errorSource: "Processing", errorCode: "110", errorMsg: failureCheck.message }],
    };
  }

  const tx: Transaction = {
    transactionId: txId,
    terminalId,
    type: "AccountVerify",
    status: "Approved",
    totalAmount: 0,
    approvedAmount: 0,
    feeAmount: 0,
    approvalNumber: approvalCode(),
    accountType: accountInfo.accountType,
    accountFirst6: first6,
    accountLast4: last4,
    createdAt: new Date(),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
    isDeclined: false,
  };
  state.saveTransaction(tx);

  return {
    status: "Success",
    operation: "AccountVerify",
    responseTimestamp: timestamp(),
    transactionId: txId,
    approvalNumber: tx.approvalNumber,
    accountType: accountInfo.accountType,
    accountFirst6: first6,
    accountLast4: last4,
    accountMasked: accountMasked(first6, last4),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
  };
}

// ---------------------------------------------------------------------------
// Authorize
// ---------------------------------------------------------------------------

export function simulateAuthorize(params: {
  terminalId: string;
  token?: string;
  accountInfo?: {
    accountNumber?: string;
    accountType?: string;
    accountAccessory?: string;
  };
  totalAmount: string;
  externalTransactionId?: string;
}) {
  const amount = parseInt(params.totalAmount, 10);
  const { first6, last4, resolvedType, rawNumber } = resolveCardDetails(
    params.terminalId,
    params.token,
    params.accountInfo?.accountNumber,
    params.accountInfo?.accountType,
    params.accountInfo?.accountAccessory
  );

  const failureCheck = checkFailureCard(rawNumber);
  if (failureCheck.declined) {
    const txId = state.newTransactionId();
    const tx: Transaction = {
      transactionId: txId,
      terminalId: params.terminalId,
      type: "Authorization",
      status: "Declined",
      totalAmount: amount,
      approvedAmount: 0,
      feeAmount: 0,
      approvalNumber: "",
      accountType: resolvedType,
      accountFirst6: first6,
      accountLast4: last4,
      token: params.token,
      externalTransactionId: params.externalTransactionId,
      createdAt: new Date(),
      gatewayResponseCode: "05",
      gatewayResponseMessage: failureCheck.message,
      isDeclined: true,
    };
    state.saveTransaction(tx);
    return {
      status: "Error",
      operation: "Authorize",
      responseTimestamp: timestamp(),
      transactionId: txId,
      gatewayResponseCode: "05",
      gatewayResponseMessage: failureCheck.message,
      errors: [{ errorSource: "Processing", errorCode: "110", errorMsg: failureCheck.message }],
    };
  }

  // Duplicate detection trigger ($0.99 = 99 cents)
  if (amount === 99) {
    const dup = state.findDuplicate(params.terminalId, amount, first6, last4);
    if (dup) {
      return {
        status: "Error",
        operation: "Authorize",
        responseTimestamp: timestamp(),
        errors: [{ errorSource: "Processing", errorCode: "355", errorMsg: "Duplicate transaction detected" }],
      };
    }
  }

  const trigger = checkAmountTrigger(amount);

  // Partial approval trigger: $0.52 approves for half the amount
  if (amount === 52) {
    const approvedAmt = Math.floor(amount / 2); // 26
    const partialFee = feeForAmount(approvedAmt);
    const partialTxId = state.newTransactionId();
    const partialApproval = approvalCode();
    const partialTx: Transaction = {
      transactionId: partialTxId,
      terminalId: params.terminalId,
      type: "Authorization",
      status: "Approved",
      totalAmount: amount,
      approvedAmount: approvedAmt,
      feeAmount: partialFee,
      approvalNumber: partialApproval,
      accountType: resolvedType,
      accountFirst6: first6,
      accountLast4: last4,
      token: params.token,
      externalTransactionId: params.externalTransactionId,
      createdAt: new Date(),
      gatewayResponseCode: "10",
      gatewayResponseMessage: "PARTIAL APPROVAL",
      isDeclined: false,
    };
    state.saveTransaction(partialTx);
    return {
      status: "Success",
      operation: "Authorize",
      responseTimestamp: timestamp(),
      transactionId: partialTxId,
      approvalNumber: partialApproval,
      approvedAmount: approvedAmt.toString(),
      feeAmount: partialFee.toString(),
      accountType: resolvedType,
      accountFirst6: first6,
      accountLast4: last4,
      accountMasked: accountMasked(first6, last4),
      gatewayResponseCode: "10",
      gatewayResponseMessage: "PARTIAL APPROVAL",
    };
  }

  const txId = state.newTransactionId();
  const approval = approvalCode();

  const tx: Transaction = {
    transactionId: txId,
    terminalId: params.terminalId,
    type: "Authorization",
    status: trigger.declined ? "Declined" : "Approved",
    totalAmount: amount,
    approvedAmount: trigger.declined ? 0 : amount,
    feeAmount: trigger.declined ? 0 : feeForAmount(amount),
    approvalNumber: trigger.declined ? "" : approval,
    accountType: resolvedType,
    accountFirst6: first6,
    accountLast4: last4,
    token: params.token,
    externalTransactionId: params.externalTransactionId,
    createdAt: new Date(),
    gatewayResponseCode: trigger.declined ? trigger.gatewayCode : "00",
    gatewayResponseMessage: trigger.declined ? trigger.message : "APPROVAL",
    isDeclined: trigger.declined,
  };
  state.saveTransaction(tx);

  if (trigger.declined) {
    return {
      status: "Error",
      operation: "Authorize",
      responseTimestamp: timestamp(),
      transactionId: txId,
      errors: [
        { errorSource: "Processing", errorCode: trigger.errorCode, errorMsg: trigger.message },
      ],
    };
  }

  return {
    status: "Success",
    operation: "Authorize",
    responseTimestamp: timestamp(),
    transactionId: txId,
    externalTransactionId: params.externalTransactionId,
    approvalNumber: approval,
    approvedAmount: amount.toString(),
    feeAmount: feeForAmount(amount).toString(),
    accountType: resolvedType,
    accountFirst6: first6,
    accountLast4: last4,
    accountMasked: accountMasked(first6, last4),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
  };
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export function simulateCapture(params: {
  terminalId: string;
  transactionId: string;
  totalAmount?: string;
}) {
  const auth = state.getTransaction(params.transactionId);
  if (!auth) {
    return errorResponse("Capture", "Transaction not found", "302");
  }
  if (auth.type !== "Authorization") {
    return errorResponse("Capture", "Transaction is not an authorization", "303");
  }
  if (auth.status === "Declined") {
    return errorResponse("Capture", "Cannot capture a declined authorization", "358");
  }
  if (auth.status !== "Approved") {
    return errorResponse("Capture", "Authorization is not in an approvable state", "304");
  }

  const captureAmount = params.totalAmount
    ? parseInt(params.totalAmount, 10)
    : auth.totalAmount;

  if (captureAmount > auth.totalAmount) {
    return errorResponse("Capture", "Capture amount exceeds authorized amount", "356");
  }

  const fee = feeForAmount(captureAmount);
  const txId = state.newTransactionId();

  const captureTx: Transaction = {
    transactionId: txId,
    terminalId: params.terminalId,
    type: "Capture",
    status: "Captured",
    totalAmount: captureAmount,
    approvedAmount: captureAmount,
    feeAmount: fee,
    approvalNumber: auth.approvalNumber,
    accountType: auth.accountType,
    accountFirst6: auth.accountFirst6,
    accountLast4: auth.accountLast4,
    token: auth.token,
    externalTransactionId: auth.externalTransactionId,
    createdAt: new Date(),
    referencedTransactionId: params.transactionId,
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
    isDeclined: false,
  };
  state.saveTransaction(captureTx);
  state.updateTransaction(params.transactionId, { status: "Captured" });

  return {
    status: "Success",
    operation: "Capture",
    responseTimestamp: timestamp(),
    transactionId: txId,
    referencedTransactionId: params.transactionId,
    approvalNumber: auth.approvalNumber,
    approvedAmount: captureAmount.toString(),
    feeAmount: fee.toString(),
    accountType: auth.accountType,
    accountFirst6: auth.accountFirst6,
    accountLast4: auth.accountLast4,
    accountMasked: accountMasked(auth.accountFirst6 ?? "", auth.accountLast4 ?? ""),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
  };
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

export function simulateVoid(params: {
  terminalId: string;
  transactionToVoidId: string;
}) {
  const tx = state.getTransaction(params.transactionToVoidId);
  if (!tx) {
    return errorResponse("Void", "Transaction not found", "302");
  }
  if (tx.status === "Voided") {
    return errorResponse("Void", "Transaction is already voided", "350");
  }
  if (state.isSettled(params.transactionToVoidId)) {
    return errorResponse(
      "Void",
      "Transaction has already settled. Use refund instead.",
      "351"
    );
  }
  if (tx.status === "Declined") {
    return errorResponse("Void", "Cannot void a declined transaction", "358");
  }
  if (tx.type === "Authorization" && tx.status === "Captured") {
    return errorResponse("Void", "Authorization has been captured. Void the Capture record instead.", "304");
  }
  if (tx.status === "Refunded") {
    return errorResponse("Void", "Transaction has already been refunded", "353");
  }
  if (tx.type === "AccountVerify" || tx.type === "Void" || tx.type === "Refund") {
    return errorResponse("Void", `Cannot void a ${tx.type} transaction`, "100");
  }

  state.updateTransaction(params.transactionToVoidId, { status: "Voided" });
  const txId = state.newTransactionId();

  const voidTx: Transaction = {
    transactionId: txId,
    terminalId: params.terminalId,
    type: "Void",
    status: "Voided",
    totalAmount: tx.totalAmount,
    approvedAmount: 0,
    feeAmount: 0,
    approvalNumber: approvalCode(),
    accountType: tx.accountType,
    accountFirst6: tx.accountFirst6,
    accountLast4: tx.accountLast4,
    referencedTransactionId: params.transactionToVoidId,
    createdAt: new Date(),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
    isDeclined: false,
  };
  state.saveTransaction(voidTx);

  return {
    status: "Success",
    operation: "Void",
    responseTimestamp: timestamp(),
    transactionId: txId,
    referencedTransactionId: params.transactionToVoidId,
    accountType: tx.accountType,
    accountFirst6: tx.accountFirst6,
    accountLast4: tx.accountLast4,
    accountMasked: accountMasked(tx.accountFirst6 ?? "", tx.accountLast4 ?? ""),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
  };
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

export function simulateRefund(params: {
  terminalId: string;
  transactionToRefundId: string;
  totalAmount?: string;
}) {
  const tx = state.getTransaction(params.transactionToRefundId);
  if (!tx) {
    return errorResponse("Refund", "Transaction not found", "302");
  }
  if (tx.status === "Voided") {
    return errorResponse("Refund", "Cannot refund a voided transaction", "352");
  }
  if (tx.status === "Refunded") {
    return errorResponse("Refund", "Transaction is already refunded", "353");
  }

  const refundAmount = params.totalAmount
    ? parseInt(params.totalAmount, 10)
    : tx.approvedAmount;

  if (refundAmount > tx.approvedAmount) {
    return errorResponse(
      "Refund",
      `Refund amount (${refundAmount}) exceeds original amount (${tx.approvedAmount})`,
      "354"
    );
  }

  if (!tx.settledAt) {
    return errorResponse("Refund", "Transaction has not settled yet. Use void for unsettled transactions.", "357");
  }
  if (tx.status === "Declined") {
    return errorResponse("Refund", "Cannot refund a declined transaction", "358");
  }
  if (tx.type !== "Sale" && tx.type !== "Capture") {
    return errorResponse("Refund", `Cannot refund a ${tx.type} transaction`, "100");
  }

  state.updateTransaction(params.transactionToRefundId, { status: "Refunded" });
  const txId = state.newTransactionId();

  const refundTx: Transaction = {
    transactionId: txId,
    terminalId: params.terminalId,
    type: "Refund",
    status: "Approved",
    totalAmount: refundAmount,
    approvedAmount: refundAmount,
    feeAmount: 0,
    approvalNumber: approvalCode(),
    accountType: tx.accountType,
    accountFirst6: tx.accountFirst6,
    accountLast4: tx.accountLast4,
    referencedTransactionId: params.transactionToRefundId,
    createdAt: new Date(),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
    isDeclined: false,
  };
  state.saveTransaction(refundTx);

  return {
    status: "Success",
    operation: "Refund",
    responseTimestamp: timestamp(),
    transactionId: txId,
    referencedTransactionId: params.transactionToRefundId,
    approvedAmount: refundAmount.toString(),
    accountType: tx.accountType,
    accountFirst6: tx.accountFirst6,
    accountLast4: tx.accountLast4,
    accountMasked: accountMasked(tx.accountFirst6 ?? "", tx.accountLast4 ?? ""),
    gatewayResponseCode: "00",
    gatewayResponseMessage: "APPROVAL",
  };
}

// ---------------------------------------------------------------------------
// Get Transaction
// ---------------------------------------------------------------------------

export function simulateGetTransaction(id: string) {
  const tx = state.getTransaction(id);
  if (!tx) {
    return errorResponse("GetTransaction", "Transaction not found", "302");
  }

  return {
    status: "Success",
    operation: "GetTransaction",
    responseTimestamp: timestamp(),
    transactionId: tx.transactionId,
    type: tx.type,
    transactionStatus: tx.status,
    terminalId: tx.terminalId,
    totalAmount: tx.totalAmount.toString(),
    approvedAmount: tx.approvedAmount.toString(),
    feeAmount: tx.feeAmount.toString(),
    approvalNumber: tx.approvalNumber,
    accountType: tx.accountType,
    accountFirst6: tx.accountFirst6,
    accountLast4: tx.accountLast4,
    accountMasked: accountMasked(tx.accountFirst6 ?? "", tx.accountLast4 ?? ""),
    isDeclined: tx.isDeclined,
    externalTransactionId: tx.externalTransactionId,
    creationTime: tx.createdAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
    settlementDate: tx.settledAt
      ? tx.settledAt.toISOString().split("T")[0]
      : undefined,
    tokenUsedIndicator: tx.token ? "Yes" : "No",
    recurringScheduleTransId: tx.recurringScheduleTransId,
    referencedTransactionId: tx.referencedTransactionId,
    gatewayResponseCode: tx.gatewayResponseCode,
    gatewayResponseMessage: tx.gatewayResponseMessage,
  };
}

// ---------------------------------------------------------------------------
// Settled Transactions
// ---------------------------------------------------------------------------

export function simulateGetSettledTransactions(params: {
  terminalId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const settled = state.getSettledTransactions(params.terminalId);
  return {
    status: "Success",
    operation: "GetSettledTransactions",
    responseTimestamp: timestamp(),
    transactions: settled.map((tx) => ({
      transactionId: tx.transactionId,
      type: tx.type,
      status: tx.status,
      terminalId: tx.terminalId,
      totalAmount: tx.totalAmount.toString(),
      approvedAmount: tx.approvedAmount.toString(),
      feeAmount: tx.feeAmount.toString(),
      approvalNumber: tx.approvalNumber,
      accountType: tx.accountType,
      accountFirst6: tx.accountFirst6,
      accountLast4: tx.accountLast4,
      settlementDate: tx.settledAt?.toISOString().split("T")[0],
      externalTransactionId: tx.externalTransactionId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Convenience Fee
// ---------------------------------------------------------------------------

export function simulateConvenienceFee(params: {
  terminalId: string;
  totalAmount: string;
  accountType: string;
}) {
  const amount = parseInt(params.totalAmount, 10);
  const fee = feeForAmount(amount);
  return {
    status: "Success",
    operation: "ConvenienceFee",
    responseTimestamp: timestamp(),
    terminalId: params.terminalId,
    totalAmount: params.totalAmount,
    feeAmount: fee.toString(),
    totalWithFee: (amount + fee).toString(),
  };
}

// ---------------------------------------------------------------------------
// BIN Lookup
// ---------------------------------------------------------------------------

const BIN_DB: Record<string, object> = {
  "411111": { network: "visa", credit: true, debit: false, prepaid: false, commercial: false },
  "401288": { network: "visa", credit: true, debit: false, prepaid: false, commercial: false },
  "555555": { network: "mastercard", credit: true, debit: false, prepaid: false, commercial: false },
  "222300": { network: "mastercard", credit: true, debit: false, prepaid: false, commercial: false },
  "378282": { network: "amex", credit: true, debit: false, prepaid: false, commercial: false },
  "601198": { network: "discover", credit: true, debit: false, prepaid: false, commercial: false },
  "404163": { network: "visa", credit: false, debit: true, prepaid: false, commercial: false },
  "400000": { network: "visa", credit: true, debit: false, prepaid: false, commercial: false },
  "510000": { network: "mastercard", credit: true, debit: false, prepaid: false, commercial: false },
};

export function simulateBinLookup(accountNumber: string) {
  const bin = accountNumber.replace(/\s/g, "").slice(0, 6);
  const info = BIN_DB[bin] ?? {
    network: "Unknown",
    credit: false,
    debit: false,
    prepaid: false,
    commercial: false,
  };

  return {
    status: "Success",
    operation: "BinLookup",
    responseTimestamp: timestamp(),
    bin,
    cardLength: accountNumber.replace(/\s/g, "").length || 16,
    testCard: SUCCESS_CARDS.has(accountNumber.replace(/\s/g, "")),
    ...info,
  };
}

// ---------------------------------------------------------------------------
// Settle Transactions
// ---------------------------------------------------------------------------

export function simulateSettleTransactions(params: {
  terminalId?: string;
  transactionId?: string;
  olderThanHours?: number;
}) {
  // Settle by specific ID
  if (params.transactionId) {
    const tx = state.getTransaction(params.transactionId);
    if (!tx) {
      return errorResponse("SettleTransactions", "Transaction not found", "302");
    }
    if (tx.status === "Declined") {
      return errorResponse("SettleTransactions", "Cannot settle a declined transaction", "358");
    }
    if (tx.type === "AccountVerify") {
      return errorResponse("SettleTransactions", "Cannot settle an AccountVerify transaction", "100");
    }
    if (tx.settledAt) {
      return {
        status: "Success",
        operation: "SettleTransactions",
        responseTimestamp: timestamp(),
        message: "Transaction already settled",
        settled: 0,
        transactions: [],
      };
    }
    state.settleTransaction(params.transactionId);
    return {
      status: "Success",
      operation: "SettleTransactions",
      responseTimestamp: timestamp(),
      message: "Transaction settled",
      settled: 1,
      transactions: [{
        transactionId: tx.transactionId,
        type: tx.type,
        totalAmount: tx.totalAmount.toString(),
        settlementDate: new Date().toISOString().split("T")[0],
      }],
    };
  }

  // Settle by age
  const hours = params.olderThanHours ?? 24;
  const cutoff = hours === 0
    ? new Date() // settle all
    : new Date(Date.now() - hours * 60 * 60 * 1000);

  const pending = state.getPendingSettlement(params.terminalId);
  const toSettle = pending.filter(tx => tx.createdAt <= cutoff);

  for (const tx of toSettle) {
    state.settleTransaction(tx.transactionId);
  }

  return {
    status: "Success",
    operation: "SettleTransactions",
    responseTimestamp: timestamp(),
    message: `Settled ${toSettle.length} transaction(s)`,
    settled: toSettle.length,
    transactions: toSettle.map(tx => ({
      transactionId: tx.transactionId,
      type: tx.type,
      totalAmount: tx.totalAmount.toString(),
      settlementDate: new Date().toISOString().split("T")[0],
    })),
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function errorResponse(operation: string, msg: string, code: string) {
  return {
    status: "Error",
    operation,
    responseTimestamp: timestamp(),
    errors: [{ errorSource: "Processing", errorCode: code, errorMsg: msg }],
  };
}
