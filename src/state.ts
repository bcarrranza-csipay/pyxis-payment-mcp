import { randomUUID, createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthToken {
  token: string;
  username: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface TokenizedCard {
  token: string;
  terminalId: string;
  accountNumber: string; // masked after storage: first6 + *** + last4
  accountFirst6: string;
  accountLast4: string;
  accountType: string;
  expires: string; // MM.YYYY
  holderFirstName?: string;
  holderLastName?: string;
}

export type TransactionType =
  | "Sale"
  | "Authorization"
  | "Capture"
  | "Void"
  | "Refund"
  | "Credit"
  | "AccountVerify"
  | "ForceCapture";

export type TransactionStatus =
  | "Approved"
  | "Declined"
  | "Voided"
  | "Refunded"
  | "Captured"
  | "Abandoned"
  | "Pending";

export interface Transaction {
  transactionId: string;
  terminalId: string;
  type: TransactionType;
  status: TransactionStatus;
  totalAmount: number; // cents
  approvedAmount: number; // cents
  feeAmount: number; // cents
  approvalNumber: string;
  accountType?: string;
  accountFirst6?: string;
  accountLast4?: string;
  token?: string;
  externalTransactionId?: string;
  createdAt: Date;
  settledAt?: Date; // set ~24hr after creation in sim; null = not settled yet
  recurringScheduleTransId?: string;
  referencedTransactionId?: string; // for refunds/voids
  gatewayResponseCode: string;
  gatewayResponseMessage: string;
  isDeclined: boolean;
}

// ---------------------------------------------------------------------------
// State store
// ---------------------------------------------------------------------------

class PyxisState {
  private authTokens = new Map<string, AuthToken>();
  // card fingerprint (terminalId + accountNumber) → token UUID
  private cardFingerprints = new Map<string, string>();
  // token UUID → tokenized card details
  private tokenizedCards = new Map<string, TokenizedCard>();
  // transactionId → transaction
  private transactions = new Map<string, Transaction>();

  // ── Auth Tokens ───────────────────────────────────────────────────────────

  issueToken(username: string): AuthToken {
    const token = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 10 * 24 * 60 * 60 * 1000); // +10 days
    const record: AuthToken = { token, username, issuedAt, expiresAt };
    this.authTokens.set(token, record);
    return record;
  }

  validateToken(token: string): { valid: boolean; reason?: string } {
    const record = this.authTokens.get(token);
    if (!record) return { valid: false, reason: "Token not found" };
    if (record.expiresAt < new Date())
      return { valid: false, reason: "The token has expired!" };
    return { valid: true };
  }

  updateTokenExpiry(token: string, expiresAt: Date): void {
    const record = this.authTokens.get(token);
    if (record) {
      record.expiresAt = expiresAt;
    }
  }

  // ── Tokenized Cards ───────────────────────────────────────────────────────

  tokenizeCard(
    terminalId: string,
    accountNumber: string,
    accountType: string,
    expires: string,
    holderFirstName?: string,
    holderLastName?: string
  ): TokenizedCard {
    const fingerprint = createHash("sha256")
      .update(`${terminalId}:${accountNumber}`)
      .digest("hex");

    // Same card + terminal always returns the same token
    let token = this.cardFingerprints.get(fingerprint);
    if (!token) {
      token = randomUUID();
      this.cardFingerprints.set(fingerprint, token);
    }

    const first6 = accountNumber.slice(0, 6);
    const last4 = accountNumber.slice(-4);
    const masked = `${first6}${"*".repeat(accountNumber.length - 10)}${last4}`;

    const card: TokenizedCard = {
      token,
      terminalId,
      accountNumber: masked,
      accountFirst6: first6,
      accountLast4: last4,
      accountType,
      expires,
      holderFirstName,
      holderLastName,
    };
    this.tokenizedCards.set(token, card);
    return card;
  }

  getTokenizedCard(token: string): TokenizedCard | undefined {
    return this.tokenizedCards.get(token);
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  saveTransaction(tx: Transaction): void {
    this.transactions.set(tx.transactionId, tx);
  }

  getTransaction(id: string): Transaction | undefined {
    return this.transactions.get(id);
  }

  findByRecurringScheduleTransId(scheduleId: string): Transaction | undefined {
    for (const [, tx] of this.transactions) {
      if (tx.recurringScheduleTransId === scheduleId) return tx;
    }
    return undefined;
  }

  updateTransaction(id: string, patch: Partial<Transaction>): Transaction | undefined {
    const tx = this.transactions.get(id);
    if (!tx) return undefined;
    const updated = { ...tx, ...patch };
    this.transactions.set(id, updated);
    return updated;
  }

  getPendingSettlement(terminalId?: string): Transaction[] {
    return [...this.transactions.values()].filter(
      (tx) =>
        !tx.settledAt &&
        tx.status === "Approved" &&
        (tx.type === "Sale" || tx.type === "Capture") &&
        (!terminalId || tx.terminalId === terminalId)
    );
  }

  settleTransaction(transactionId: string): boolean {
    const tx = this.transactions.get(transactionId);
    if (!tx) return false;
    if (tx.settledAt) return false; // already settled
    tx.settledAt = new Date();
    return true;
  }

  /**
   * Auto-settle: stamp settledAt on approved Sale/Capture transactions older
   * than 24 hours. Mirrors production batch settlement behavior.
   * Called lazily on reads that care about settlement state.
   */
  private autoSettle(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const [, tx] of this.transactions) {
      if (
        tx.status === "Approved" &&
        !tx.settledAt &&
        tx.createdAt <= cutoff &&
        (tx.type === "Sale" || tx.type === "Capture")
      ) {
        tx.settledAt = new Date();
      }
    }
  }

  getSettledTransactions(terminalId?: string): Transaction[] {
    this.autoSettle();
    const now = new Date();
    return [...this.transactions.values()].filter(
      (tx) =>
        tx.status === "Approved" &&
        tx.settledAt &&
        tx.settledAt <= now &&
        (!terminalId || tx.terminalId === terminalId)
    );
  }

  isSettled(transactionId: string): boolean {
    this.autoSettle();
    const tx = this.transactions.get(transactionId);
    return !!tx?.settledAt;
  }

  newTransactionId(): string {
    return randomUUID();
  }

  findDuplicate(terminalId: string, totalAmount: number, accountFirst6: string, accountLast4: string): Transaction | undefined {
    const cutoff = new Date(Date.now() - 60 * 1000); // 60 second window
    for (const [, tx] of this.transactions) {
      if (
        tx.terminalId === terminalId &&
        tx.totalAmount === totalAmount &&
        tx.accountFirst6 === accountFirst6 &&
        tx.accountLast4 === accountLast4 &&
        tx.createdAt >= cutoff &&
        !tx.isDeclined
      ) {
        return tx;
      }
    }
    return undefined;
  }

  /** Clear all in-memory state. Used by tests to isolate test cases. */
  reset(): void {
    this.authTokens.clear();
    this.cardFingerprints.clear();
    this.tokenizedCards.clear();
    this.transactions.clear();
  }
}

export const state = new PyxisState();
