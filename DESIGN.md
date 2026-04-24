# Pyxis Payment MCP — Design

> **Code-first principle:** This design describes the existing codebase as the baseline. Features marked ⊕ are planned additions. The codebase is immutable except for one panel-approved modification: adding a settlement check to `simulateRefund` (Phase 1a).

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Desktop / CLI                   │
│                    (MCP Client)                           │
└────────────────────────┬────────────────────────────────┘
                         │ stdio (JSON-RPC)
┌────────────────────────▼────────────────────────────────┐
│                   MCP Server Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  Tools   │  │  Auth    │  │  Audit   │  │ Router  │ │
│  │  Defs    │  │  Guard   │  │  Logger  │  │         │ │
│  └──────────┘  └──────────┘  └──────────┘  └────┬────┘ │
│                                                  │      │
│  ┌───────────────────────────────────────────────▼────┐ │
│  │              Simulator (Business Logic)             │ │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────────┐ │ │
│  │  │  Auth  │ │Tokenize│ │  Txn   │ │  Triggers   │ │ │
│  │  │        │ │        │ │  Ops   │ │ (cards/amt) │ │ │
│  │  └────────┘ └────────┘ └────────┘ └─────────────┘ │ │
│  └────────────────────────┬──────────────────────────┘ │
│                           │                             │
│  ┌────────────────────────▼──────────────────────────┐ │
│  │              State Store (In-Memory)               │ │
│  │  ┌──────────┐ ┌────────────┐ ┌────────────────┐  │ │
│  │  │  Auth    │ │ Tokenized  │ │  Transactions  │  │ │
│  │  │  Tokens  │ │ Cards +    │ │                │  │ │
│  │  │  Map     │ │ Fingerprints│ │                │  │ │
│  │  └──────────┘ └────────────┘ └────────────────┘  │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Key design principles:**
- Single-process, in-memory, stateless-on-restart
- MCP stdio transport only — no HTTP server
- Simulator logic is pure functions operating on state store
- Auth guard is a cross-cutting concern applied before routing
- Audit logging is fire-and-forget (never blocks operations)

---

## 2. Project Structure

### Current (Phase 1 target — refactored from existing monolith in Phase 4)

```
pyxis-mcp/
├── src/
│   ├── index.ts              # MCP server entry, tool defs, routing, audit
│   ├── simulator.ts          # All business logic (auth, txn, triggers)
│   └── state.ts              # In-memory state store (types + PyxisState class)
├── tests/                    # Phase 1: test suite
│   ├── auth.test.ts
│   ├── tokenize.test.ts
│   ├── sale.test.ts
│   ├── authorize-capture.test.ts
│   ├── void.test.ts
│   ├── refund.test.ts
│   ├── account-verify.test.ts
│   ├── queries.test.ts
│   ├── convenience-fee.test.ts
│   ├── bin-lookup.test.ts
│   ├── sandbox-info.test.ts
│   └── helpers.ts            # Shared test utilities (get token, make sale, etc.)
├── dist/                     # Compiled output
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts          # Phase 1: test config
├── CLAUDE.md
├── REQUIREMENTS.md
├── DESIGN.md
├── TASKS.md
└── README.md
```

### Phase 4 target (after refactoring index.ts)

```
src/
├── index.ts                  # Entry point — creates server, connects transport
├── server.ts                 # MCP server setup, tool registration
├── tools/                    # Tool definitions (JSON Schema per tool)
│   ├── definitions.ts        # TOOLS array export
│   └── index.ts              # Re-export
├── router.ts                 # CallTool request handler (switch/case)
├── auth-guard.ts             # requireValidToken() helper
├── audit.ts                  # Audit logging (sanitize, log)
├── simulator.ts              # Business logic (unchanged)
└── state.ts                  # State store (unchanged)
```

---

## 3. Module Design

### 3.1 State Store (`state.ts`)

The state store is the single source of truth for all in-memory data. It exposes a class `PyxisState` with methods for each data domain.

**Storage maps:**

| Map | Key | Value | Purpose |
|-----|-----|-------|---------|
| `authTokens` | token UUID | `AuthToken` | Active bearer tokens |
| `cardFingerprints` | SHA256 hash | token UUID | Idempotent tokenization lookup |
| `tokenizedCards` | token UUID | `TokenizedCard` | Stored card details |
| `transactions` | transaction UUID | `Transaction` | All transaction records |

**Key methods:**

```typescript
class PyxisState {
  // Auth
  issueToken(username: string): AuthToken
  validateToken(token: string): { valid: boolean; reason?: string }

  // Tokenization
  tokenizeCard(terminalId, rawPAN, accountType, expires, firstName?, lastName?): TokenizedCard
  getTokenizedCard(token: string): TokenizedCard | undefined

  // Transactions
  saveTransaction(tx: Transaction): void
  getTransaction(id: string): Transaction | undefined
  updateTransaction(id: string, patch: Partial<Transaction>): Transaction | undefined
  newTransactionId(): string

  // Settlement
  isSettled(transactionId: string): boolean               // Calls autoSettle(), then checks tx.settledAt
  getSettledTransactions(terminalId?: string): Transaction[] // Calls autoSettle(), filters by settledAt
  settleById(transactionId: string): boolean              // Immediate settlement of a specific transaction
  private autoSettle(): void                              // Lazy batch: stamps settledAt on qualifying txns
}
```

**Settlement model:**

Auto-settlement is the default mechanism. Manual settlement via `pyxis_settle_transactions` is an accelerator for testing convenience.

- **`autoSettle()`** is a private method that scans all transactions and stamps `settledAt = new Date()` on any transaction where: `createdAt` is >24hrs ago, status is `Approved` or `Captured`, and `settledAt` is not already set.
- **`isSettled(id)`** calls `autoSettle()` first, then returns `!!tx.settledAt`. This means any call to `isSettled()` may settle other qualifying transactions as a side effect.
- **`getSettledTransactions(terminalId?)`** calls `autoSettle()` first, then filters for transactions with `settledAt` set and status `Approved`.
- **`settleById(id)`** provides immediate single-transaction settlement (used by the manual settle tool).

**Settlement trigger paths:**

| Code path | Triggers autoSettle? | How settlement is checked |
|-----------|---------------------|--------------------------|
| `simulateVoid` | Yes — calls `state.isSettled()` | `isSettled()` → `autoSettle()` → check `settledAt` |
| `simulateRefund` | No — checks `tx.settledAt` directly | `if (!tx.settledAt)` → error 357 |
| `simulateGetTransaction` | No | Reads `settledAt` for `settlementDate` field |
| `simulateGetSettledTransactions` | Yes — calls `state.getSettledTransactions()` | `getSettledTransactions()` → `autoSettle()` → filter |
| `simulateSettleTransactions` | No — settles explicitly | Direct `settledAt` stamping |

**Refund settlement implications:** Because `simulateRefund` checks `tx.settledAt` directly without calling `autoSettle()`, a transaction older than 24hrs will NOT be auto-settled by the refund path. The developer must either: (a) call a query operation first (e.g., `pyxis_get_settled_transactions`) which triggers `autoSettle()` as a side effect, or (b) use `pyxis_settle_transactions` to manually settle before refunding. A typical developer flow is: sale → query transaction → refund (the query triggers auto-settle) or: sale → settle via tool → refund.

> **Status enum alignment:** The code's `TransactionStatus` does not include `Settled`. Settlement is tracked via the `settledAt` Date field. `Abandoned` and `Pending` remain in the code but are unused.

### 3.2 Simulator (`simulator.ts`)

Pure business logic functions. Each function receives validated inputs and returns a response object. Functions call `state.*` methods for persistence.

**Operation value mapping** (per REQUIREMENTS.md §2.3):

| Tool | `operation` field value |
|------|----------------------|
| `pyxis_get_token` | `"Security"` |
| `pyxis_tokenize` | `"Tokenize"` |
| `pyxis_sale` | `"Sale"` |
| `pyxis_authorize` | `"Authorize"` |
| `pyxis_capture` | `"Capture"` |
| `pyxis_void` | `"Void"` |
| `pyxis_refund` | `"Refund"` |
| `pyxis_account_verify` | `"AccountVerify"` |
| `pyxis_get_transaction` | `"GetTransaction"` |
| `pyxis_get_settled_transactions` | `"GetSettledTransactions"` |
| `pyxis_convenience_fee` | `"ConvenienceFee"` |
| `pyxis_bin_lookup` | `"BinLookup"` |
| `pyxis_sandbox_info` | `"SandboxInfo"` |
| `pyxis_settle_transactions` | `"SettleTransactions"` |

**Failure card map** (Phase 1):

```typescript
const FAILURE_CARDS: Record<string, string> = {
  "4000000000000002": "Do Not Honor",
  "5100000000000008": "Insufficient Funds",
  "4000000000000069": "Expired Card",
  // Phase 2:
  // "4000000000000127": "Incorrect CVV",
};
```

> ⊕ Phase 1 addition. The current codebase does not implement failure cards (`isBadCard()` always returns `false`). This map will be added during Phase 1.

**Card resolution priority:**
1. If `token` is provided → look up `TokenizedCard` from state
2. If `accountInfo` is provided → use raw card details
3. If neither → error 100

**Recurring InTrack validation:**
1. `recurringScheduleTransId` must reference an existing transaction
2. Referenced transaction must have `recurring: "First"` (i.e., have a populated `recurringScheduleTransId` and be the originating First sale)
3. Referenced First transaction must have status Approved (whether or not `settledAt` is stamped). If Voided or Refunded, return error 305 with errorMsg: 'Recurring schedule is no longer active'

**Decline check order** (for Sale, Authorize, AccountVerify):
1. Check failure cards (§4.4) → error 110 with specific message
2. Check amount triggers (§4.2) → error 110 with specific message
3. If no triggers fire → approve

**Fee calculation:**
```typescript
function calculateFee(amount: number): number {
  // Phase 1: hardcoded 3%
  // Phase 2: read from PYXIS_FEE_RATE env var
  const rate = 0.03;
  return Math.round(amount * rate);
}
```

### 3.3 Auth Guard (`index.ts` → `auth-guard.ts` in Phase 4)

```typescript
function requireValidToken(token: string | undefined):
  | { valid: true }
  | { valid: false; response: ErrorResponse }
```

- Skipped for: `pyxis_get_token`, `pyxis_sandbox_info`
- Missing token → error 700
- Invalid/expired token → error 712

### 3.4 Audit Logger (`index.ts` → `audit.ts` in Phase 4)

JSON-lines format to `PYXIS_AUDIT_LOG` (default: `pyxis-audit.log`).

**Entry format:**
```json
{
  "ts": "2026-03-15T14:30:00.000Z",
  "tool": "pyxis_sale",
  "args": { "terminalId": "...", "totalAmount": "2530", "bearerToken": "abc12345..." },
  "status": "Success",
  "durationMs": 2
}
```

**Sanitization rules:**
- `password` → `"[redacted]"`
- `pyxisAccess` → `"[redacted]"`
- `bearerToken` → first 8 chars + `"..."`
- Any field named `accountNumber`, `pan`, or `cardNumber` at any nesting depth → `first6****last4`

---

## 4. Input Schemas

### 4.1 Common fields (all authenticated tools)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `bearerToken` | string | Yes | UUID from `pyxis_get_token`. Validated by auth guard |
| `terminalId` | string | Yes (except query tools and BIN lookup) | Any non-empty string. Not required on `pyxis_get_transaction`, `pyxis_get_settled_transactions`, or `pyxis_bin_lookup` |

### 4.2 Tool-specific input schemas

**`pyxis_get_token`** (no auth required)

| Field | Type | Required |
|-------|------|----------|
| `username` | string | Yes |
| `password` | string | Yes |
| `pyxisAccess` | string | No |

**`pyxis_tokenize`**

| Field | Type | Required |
|-------|------|----------|
| `bearerToken` | string | Yes |
| `terminalId` | string | Yes |
| `accountInfo` | object | Yes |
| `accountInfo.accountNumber` | string | Yes |
| `accountInfo.accountType` | string | Yes (per current code schema; auto-detected from BIN in simulator logic if value is generic) |
| `accountInfo.accountAccessory` | string | No (expiry MM.YYYY, defaults to "12.2026") |
| `accountHolder` | object | No |
| `accountHolder.holderFirstName` | string | No |
| `accountHolder.holderLastName` | string | No |

> **Field name mapping:** The MCP tool input uses `accountInfo.accountAccessory` for card expiry (matching production Pyxis API field names) while REQUIREMENTS.md uses `expires`. Internally, the simulator maps `accountAccessory` → `expires`. The `accountHolder` wrapper object is a separate top-level input (matching production Pyxis), not nested inside `accountInfo` as simplified in REQUIREMENTS.md. REQUIREMENTS.md Card Input Fields section should be updated to reflect the production field structure.

> Note: `token` input is rejected with error 100 (FR-2 accepts raw cards only).

**`pyxis_sale`**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `bearerToken` | string | Yes | |
| `terminalId` | string | Yes | |
| `token` | string | No | Mutually exclusive with `accountInfo` |
| `accountInfo` | object | No | See Card Input Fields (REQUIREMENTS.md) |
| `accountHolder` | object | No | |
| `totalAmount` | string | Yes | Cents as string |
| `externalTransactionId` | string | No | |
| `saleWithTokenize` | boolean | No | |
| `recurring` | string | No | `"First"` or `"InTrack"` trigger recurring behavior. `"None"` and `"NoTrack"` are accepted as no-ops (equivalent to omitting the field) |
| `recurringScheduleTransId` | string | No | Required when `recurring = "InTrack"` |

**`pyxis_authorize`**

| Field | Type | Required |
|-------|------|----------|
| `bearerToken` | string | Yes |
| `terminalId` | string | Yes |
| `token` | string | No |
| `accountInfo` | object | No |
| `totalAmount` | string | Yes |
| `externalTransactionId` | string | No |

> Note: `recurring` flag rejected with error 100.

**`pyxis_capture`**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `bearerToken` | string | Yes | |
| `terminalId` | string | Yes | |
| `transactionId` | string | Yes | Authorization's transactionId |
| `totalAmount` | string | No | Defaults to auth amount if omitted |

**`pyxis_void`**

| Field | Type | Required |
|-------|------|----------|
| `bearerToken` | string | Yes |
| `terminalId` | string | Yes |
| `transactionToVoidId` | string | Yes |

**`pyxis_refund`**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `bearerToken` | string | Yes | |
| `terminalId` | string | Yes | |
| `transactionToRefundId` | string | Yes | |
| `totalAmount` | string | No | Defaults to full amount if omitted |

**`pyxis_account_verify`**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `bearerToken` | string | Yes | |
| `terminalId` | string | Yes | |
| `accountInfo` | object | Yes | Raw card details (required — token input not currently supported) |
| `accountHolder` | object | No | |

> Note: The current codebase requires `accountInfo` and does not accept `token` or `externalTransactionId` for account verify. These may be added as Phase 1 enhancements per FR-9.

**`pyxis_get_transaction`**

| Field | Type | Required |
|-------|------|----------|
| `bearerToken` | string | Yes |
| `transactionId` | string | Yes |

**`pyxis_get_settled_transactions`**

| Field | Type | Required |
|-------|------|----------|
| `bearerToken` | string | Yes |
| `terminalId` | string | No |
| `startDate` | string | No |
| `endDate` | string | No |

**`pyxis_convenience_fee`**

| Field | Type | Required |
|-------|------|----------|
| `bearerToken` | string | Yes |
| `terminalId` | string | Yes |
| `totalAmount` | string | Yes |
| `accountType` | string | Yes (accepted without validation) |

**`pyxis_bin_lookup`**

| Field | Type | Required |
|-------|------|----------|
| `bearerToken` | string | Yes |
| `accountNumber` | string | Yes |

**`pyxis_sandbox_info`** (no auth, no inputs)

---

## 5. Response Schemas

All responses follow the §2.3 envelope. Below are the tool-specific success response fields (beyond `status`, `operation`, `responseTimestamp`).

> **Note:** Response schemas below describe the Phase 1 TARGET state (after all Phase 1 tasks are complete). Fields marked with ⊕ are Phase 1 additions not present in the current codebase. Fields match existing code output unless noted.

### 5.1 `pyxis_get_token` — Success

```json
{
  "status": "Success",
  "operation": "Security",
  "responseTimestamp": "2026-03-15 14:30:00",
  "token": "uuid-...",
  "expiresAt": "2026-03-25 14:30:00",
  "issueAt": "2026-03-15 14:30:00",
  "issuer": "CSIPAY"
}
```

### 5.2 `pyxis_tokenize` — Success

```json
{
  "status": "Success",
  "operation": "Tokenize",
  "responseTimestamp": "...",
  "terminalId": "term-001",
  "token": "uuid-...",
  "accountType": "Visa",
  "accountFirst6": "411111",
  "accountLast4": "1111"
}
```

### 5.3 `pyxis_sale` — Success

```json
{
  "status": "Success",
  "operation": "Sale",
  "responseTimestamp": "...",
  "transactionId": "uuid-...",
  "externalTransactionId": "merchant-ref-123",
  "approvalNumber": "A1B2C3",
  "approvedAmount": "2530",
  "feeAmount": "76",
  "accountType": "Visa",
  "accountFirst6": "411111",
  "accountLast4": "1111",
  "accountMasked": "411111******1111",  // ⊕ Phase 1 addition
  "gatewayResponseCode": "00",
  "gatewayResponseMessage": "APPROVAL",
  "recurringScheduleTransId": "uuid-...",
  "generatedToken": "uuid-..."
}
```

Fields `recurringScheduleTransId` and `generatedToken` are included only when applicable.

### 5.4 `pyxis_authorize` — Success

```json
{
  "status": "Success",
  "operation": "Authorize",
  "responseTimestamp": "...",
  "transactionId": "uuid-...",
  "externalTransactionId": "...",
  "approvalNumber": "A1B2C3",
  "approvedAmount": "2530",
  "feeAmount": "76",  // ⊕ Phase 1 addition (estimate — see note below)
  "accountType": "Visa",
  "accountFirst6": "411111",
  "accountLast4": "1111",
  "accountMasked": "411111******1111",  // ⊕ Phase 1 addition
  "gatewayResponseCode": "00",
  "gatewayResponseMessage": "APPROVAL"
}
```

`feeAmount` in the Authorize response is an estimate only — not charged. The `feeAmount` in the Capture response (§5.5) is the authoritative charged fee. Callers implementing financial reporting must use the Capture record's fee only.

### 5.5 `pyxis_capture` — Success

```json
{
  "status": "Success",
  "operation": "Capture",
  "responseTimestamp": "...",
  "transactionId": "uuid-...",
  "referencedTransactionId": "auth-uuid-...",
  "approvalNumber": "D4E5F6",
  "approvedAmount": "2530",
  "feeAmount": "76",
  "accountType": "Visa",
  "accountFirst6": "411111",
  "accountLast4": "1111",
  "accountMasked": "411111******1111",  // ⊕ Phase 1 addition
  "gatewayResponseCode": "00",
  "gatewayResponseMessage": "APPROVAL"
}
```

> Note: The Capture transaction record is stored with `status: "Captured"` (not `"Approved"`), matching the existing codebase. The original Authorization record also transitions to `"Captured"`.

### 5.6 `pyxis_void` — Success

```json
{
  "status": "Success",
  "operation": "Void",
  "responseTimestamp": "...",
  "transactionId": "uuid-...",
  "referencedTransactionId": "original-uuid-...",
  "accountType": "Visa",
  "accountFirst6": "411111",
  "accountLast4": "1111",
  "accountMasked": "411111******1111",  // ⊕ Phase 1 addition
  "gatewayResponseCode": "00",  // ⊕ Phase 1 addition (not in current void response)
  "gatewayResponseMessage": "APPROVAL"  // ⊕ Phase 1 addition (code stores "APPROVAL" on void records)
}
```

> Note: The Void transaction record is stored with `status: "Voided"` (matching the existing codebase), not `"Approved"` as initially specified in REQUIREMENTS.md. Void records mirror the original `totalAmount` with `approvedAmount: 0`.

### 5.7 `pyxis_refund` — Success

```json
{
  "status": "Success",
  "operation": "Refund",
  "responseTimestamp": "...",
  "transactionId": "uuid-...",
  "referencedTransactionId": "original-uuid-...",
  "approvedAmount": "1500",
  "accountType": "Visa",
  "accountFirst6": "411111",
  "accountLast4": "1111",
  "accountMasked": "411111******1111",  // ⊕ Phase 1 addition
  "gatewayResponseCode": "00",
  "gatewayResponseMessage": "APPROVAL"
}
```

> Note: Refund records generate their own `approvalNumber` (6-character code), matching the existing codebase. REQUIREMENTS.md secondary record fields have been updated to reflect this. The code returns `gatewayResponseMessage: "APPROVAL"` for refund responses (not `"REFUND"` as originally specified). This matches the existing codebase.

### 5.8 `pyxis_account_verify` — Success

```json
{
  "status": "Success",
  "operation": "AccountVerify",
  "responseTimestamp": "...",
  "transactionId": "uuid-...",
  "approvalNumber": "G7H8I9",
  "accountType": "Visa",
  "accountFirst6": "411111",
  "accountLast4": "1111",
  "accountMasked": "411111******1111",  // ⊕ Phase 1 addition
  "gatewayResponseCode": "00",
  "gatewayResponseMessage": "APPROVAL"
}
```

### 5.9 `pyxis_get_transaction` — Success

```json
{
  "status": "Success",
  "operation": "GetTransaction",
  "responseTimestamp": "...",
  "transactionId": "uuid-...",
  "type": "Sale",
  "transactionStatus": "Approved",
  "terminalId": "term-001",
  "totalAmount": "2530",
  "approvedAmount": "2530",
  "feeAmount": "76",
  "approvalNumber": "A1B2C3",
  "accountType": "Visa",
  "accountFirst6": "411111",
  "accountLast4": "1111",
  "accountMasked": "411111******1111",  // ⊕ Phase 1 addition
  "externalTransactionId": "merchant-ref-123",
  "creationTime": "2026-03-15 14:30:00",
  "settlementDate": "2026-03-16",
  "tokenUsedIndicator": "Yes",
  "recurringScheduleTransId": "uuid-...",
  "referencedTransactionId": "uuid-...",
  "gatewayResponseCode": "00",
  "gatewayResponseMessage": "APPROVAL",
  "isDeclined": false  // ⊕ Phase 1 addition
}
```

> **Field name mapping:** `transactionStatus` is the production Pyxis field name in query responses, distinct from `status` used in transaction operation responses. `creationTime` maps to internal `createdAt`. `settlementDate` is the date portion of `settledAt` (YYYY-MM-DD, time dropped to match production batch settlement convention). `tokenUsedIndicator` is a derived field (`"Yes"` if `token` is set, `"No"` otherwise). These mappings match production Pyxis API conventions.

`settlementDate` is omitted if unsettled. Optional fields omitted if null.

### 5.10 `pyxis_get_settled_transactions` — Success

```json
{
  "status": "Success",
  "operation": "GetSettledTransactions",
  "responseTimestamp": "...",
  "transactions": [
    {
      "transactionId": "uuid-...",
      "type": "Sale",
      "status": "Approved",
      "terminalId": "term-001",
      "totalAmount": "2530",
      "approvedAmount": "2530",
      "feeAmount": "76",
      "approvalNumber": "A1B2C3",
      "accountType": "Visa",
      "accountFirst6": "411111",
      "accountLast4": "1111",
      "settlementDate": "2026-03-16",
      "externalTransactionId": "..."
    }
  ]
}
```

### 5.11 `pyxis_convenience_fee` — Success

```json
{
  "status": "Success",
  "operation": "ConvenienceFee",
  "responseTimestamp": "...",
  "terminalId": "term-001",
  "totalAmount": "2530",
  "feeAmount": "76",
  "totalWithFee": "2606"
}
```

### 5.12 `pyxis_bin_lookup` — Success

```json
{
  "status": "Success",
  "operation": "BinLookup",
  "responseTimestamp": "...",
  "bin": "411111",
  "cardLength": 16,
  "testCard": true,
  "network": "visa",
  "credit": true,
  "debit": false,
  "prepaid": false,
  "commercial": false
}
```

For unknown BINs (current code): `network: "visa"`, `credit: true`. Phase 1 target: `network: "Unknown"` with all flags `false`.

### 5.13 `pyxis_sandbox_info` — Success

Phase-aware static response. Includes:
- `testCards`: array of success card objects (number, type, result)
- `failureCards`: array of failure card objects (number, type, declineReason) — Phase 1 active only
- `amountTriggers`: array of amount trigger objects (amountCents, amountDisplay, result) — Phase 1 active only
- `conventions`: object with amount format, card expiry format, date format, flag format
- `keyReminders`: array of string tips for developers
- `apiVersion`: string identifying the Pyxis API version being simulated
- `divergences`: array of known simulator-vs-production differences
- `firstUseGuide`: suggested operation sequence for new developers
- `phase2Note`: string noting additional triggers available in Phase 2

Full JSON schema defined by implementation. The content must match §4 test data and §8 divergences at the time of each release.

> **Developer experience note:** The `firstUseGuide` field is the most important entry point for new developers. The tool description for `pyxis_sandbox_info` and the README quick-start section should prominently direct developers to call this tool first and follow the guide.

---

## 6. Error Response Schema

All errors follow the §2.3 envelope:

```json
{
  "status": "Error",
  "operation": "<operation>",
  "responseTimestamp": "...",
  "errors": [
    {
      "errorSource": "Validation | Security | Processing",
      "errorCode": "<string>",
      "errorMsg": "<human-readable message>"
    }
  ]
}
```

**Decline responses** add a top-level `transactionId`:

```json
{
  "status": "Error",
  "operation": "Sale",
  "responseTimestamp": "...",
  "transactionId": "uuid-...",
  "errors": [{ "errorSource": "Processing", "errorCode": "110", "errorMsg": "Do Not Honor" }]
}
```

Declined transaction responses also include `gatewayResponseCode` and `gatewayResponseMessage` as top-level fields (matching the stored Transaction record values). These are in addition to the `errors` array.

**Error source mapping:**
- 100 → `"Validation"`
- 110, 120, 121, 302–358 → `"Processing"`
- 700, 701, 712, 713 → `"Security"`

---

## 7. Validation Logic

### 7.1 Input validation (error 100)

> **Note:** Validation sequences below describe the Phase 1 TARGET state. The current codebase implements basic checks only (exists, voided, settled for void; exists, voided, refunded, amount for refund). Phase 1 tasks add: type guards, declined guards, error 100 input validation, and capture ceiling.

Applied to every tool call before business logic:

1. Required fields present and non-empty
2. `accountInfo` and `token` are mutually exclusive
3. `token` input rejected on `pyxis_tokenize` (FR-2 accepts raw only)
4. `recurring` flag rejected on `pyxis_authorize` (FR-4)
5. `recurring: "First"` with `recurringScheduleTransId` rejected (FR-3)
6. `totalAmount` is a valid positive integer string for Sale, Authorize, and Capture (zero or negative returns error 100). For Refund: totalAmount must be greater than 0. For ConvenienceFee: zero is accepted and returns zero fee

### 7.2 Transaction validation order (Void)

```
1. Transaction exists?                    → 302 (current code)
2. Status is Voided?                      → 350 (current code)
3. Check settlement via `state.isSettled()` → 351 if settled (triggers `autoSettle()` — may settle other qualifying transactions as a side effect)
⊕ Phase 1a additions:
4. Status is Declined?                    → 358
⊕ Phase 1b additions:
5. Type is Sale or Capture?               → 100 (invalid operation)
6. Status is Refunded?                    → 353
7. Status is Captured (Authorization)?    → 304
8. Proceed with void
```

### 7.3 Transaction validation order (Refund)

```
1. Transaction exists?                    → 302 (current code)
2. Status is Voided?                      → 352 (current code)
3. Status is Refunded?                    → 353 (current code)
4. Amount > approvedAmount?               → 354 (current code)
⊕ Phase 1a additions:
5. Status is Declined?                    → 358
6. settledAt is null?                     → 357 (not yet settled — checks `tx.settledAt` directly, does NOT call `autoSettle()`; dev must trigger settlement via query or manual settle tool first)
⊕ Phase 1b additions:
7. Type is Sale or Capture?               → 100 (invalid operation)
8. Proceed with refund
```

### 7.4 Transaction validation order (Capture)

```
1. Transaction exists?                    → 302 (current code)
2. Type is Authorization?                 → 303 (current code)
3. Status is Approved?                    → 304 if not (current code)
⊕ Phase 1a additions:
4. Status is Declined?                    → 358 (checked before 304)
5. Capture amount > auth amount?          → 356
⊕ Phase 1b additions:
6. Input validation                       → 100
7. Proceed with capture
```

---

## 8. BIN Database

Built-in mapping for all test cards (success + failure):

| BIN | Network | Credit | Debit | Prepaid | Commercial |
|-----|---------|--------|-------|---------|------------|
| 411111 | visa | true | false | false | false |
| 401288 | visa | true | false | false | false |
| 555555 | mastercard | true | false | false | false |
| 222300 | mastercard | true | false | false | false |
| 378282 | amex | true | false | false | false |
| 601198 | discover | true | false | false | false |
| 404163 | visa | false | true | false | false |
| 400000 | visa ⊕ | true | false | false | false |
| 510000 | mastercard ⊕ | true | false | false | false |

Default for unknown BINs: `{ network: "visa", credit: true, debit: false, prepaid: false, commercial: false }` (matches current codebase fallback). Phase 1 target: change default to `network: "Unknown"` with all flags false.

---

## 9. Test Strategy

### 9.1 Framework

**Vitest** — chosen for:
- Native ESM support (project uses `"type": "module"`)
- TypeScript support out of the box
- Fast execution (in-memory tests)
- Compatible with Node.js 18+

### 9.2 Test architecture

Tests call simulator functions directly (not through MCP transport). Each test file resets state via a `beforeEach` that creates a fresh `PyxisState` instance.

**Shared helpers** (`tests/helpers.ts`):
```typescript
export function getTestToken(state: PyxisState): string
export function tokenizeTestCard(state: PyxisState, terminalId: string): string
export function makeApprovedSale(state: PyxisState, terminalId: string, amount: number): Transaction
export function makeDeclinedSale(state: PyxisState, terminalId: string): Transaction
```

### 9.3 Test coverage matrix

| Tool | Happy path | Error codes | Failure cards | Amount triggers | Edge cases |
|------|-----------|-------------|---------------|-----------------|------------|
| `pyxis_get_token` | Default creds | 701 (hardened) | — | — | Env var override |
| `pyxis_tokenize` | New card | 100 (token input) | — | — | Idempotent return |
| `pyxis_sale` | Approved | 100, 110, 305 | 3 Phase 1 cards | $0.01, $0.23 | saleWithTokenize (raw card + token ref variants), recurring First/InTrack, InTrack against voided First (error 305) |
| `pyxis_authorize` | Approved | 100, 110 | 3 Phase 1 cards | $0.01, $0.23 | Recurring rejected |
| `pyxis_capture` | Full + partial | 302, 303, 304, 356, 358 | — | — | Amount ceiling |
| `pyxis_void` | Sale void | 100, 302, 304, 350, 351, 353, 358 | — | — | AccountVerify rejected, Captured auth rejected, void uncaptured Authorization (valid path) |
| `pyxis_refund` | Full + partial | 100, 302, 352, 353, 354, 357, 358 | — | — | AccountVerify rejected, single-refund rule |
| `pyxis_account_verify` | Approved | 100, 110 | 3 Phase 1 cards | — | Zero amounts |
| `pyxis_get_transaction` | Found | 302 | — | — | Declined txn queryable |
| `pyxis_get_settled_transactions` | With results | — | — | — | Empty results, auto-settle triggered on call (txns >24hrs auto-stamped) |
| `pyxis_convenience_fee` | Calculated | 100 | — | — | Zero amount |
| `pyxis_bin_lookup` | Known BIN | 100 | — | — | Unknown BIN default |
| `pyxis_sandbox_info` | Returns data | — | — | — | Phase-aware content |

---

## 10. CI Pipeline (GitHub Actions)

```yaml
name: CI
on:
  push:
    branches: [develop, main]
  pull_request:
jobs:
  test-ubuntu:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm test
  test-matrix:
    if: github.event_name == 'pull_request'
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm test
```

---

## 11. Environment Variables

| Variable | Default | Phase | Description |
|----------|---------|-------|-------------|
| `PYXIS_MCP_USERNAME` | *(none — any creds accepted)* | 1 | Hardened mode: required username |
| `PYXIS_MCP_PASSWORD` | *(none — any creds accepted)* | 1 | Hardened mode: required password |
| `PYXIS_AUDIT_LOG` | `pyxis-audit.log` | 1 | Audit log file path |
| `PYXIS_FEE_RATE` | `0.03` | 2 | Convenience fee rate (decimal). Parsed as float, clamped to [0, 1], default 0.03 |

**Hardened mode activation:** Both `PYXIS_MCP_USERNAME` AND `PYXIS_MCP_PASSWORD` must be set for hardened mode. If only one is set, the server logs a startup warning ('Incomplete hardened mode config — running in open mode') and falls back to accepting any credentials.

---

## 12. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Existing codebase is immutable for Phase 1–4 | The current Pyxis MCP codebase field names, response shapes, and type enums are the source of truth. REQUIREMENTS.md and DESIGN.md are aligned to the code, not the other way around. New features are additive only |
| In-memory state, no persistence | Clean sandbox — each restart is a fresh environment. No migration complexity |
| Simulator functions are pure (stateless except via state store) | Testable without MCP transport. State store is the only side-effect boundary |
| Decline creates a stored Transaction record | Matches production Pyxis behavior. Callers can query declined transactions |
| Settlement tracked via `settledAt` timestamp, not status | The code has no `Settled` status. Transactions stay `Approved`/`Captured` and get `settledAt` stamped. Auto-settlement is the default: `autoSettle()` is a private lazy method on `PyxisState` that stamps `settledAt` on Approved/Captured transactions older than 24hrs, triggered by `isSettled()` and `getSettledTransactions()`. The `pyxis_settle_transactions` tool is an accelerator for testing (immediate settlement by ID, age, or all). Refund checks `tx.settledAt` directly (no auto-settle trigger), so devs must settle via query side-effect or manual tool before refunding |
| Single refund per transaction | Simplification. Documented in §8 as a known divergence |
| Auth fee is an estimate, Capture fee is authoritative | Handles partial capture cleanly. Documented in FR-4 |
| Void/Refund target Sale and Capture records only | Prevents nonsensical operations (voiding a void). Other types return error 100 |
| `isDeclined` stored on secondary records as `false` | Void, Refund, Capture records are never declined — they operate on existing transactions |
| `terminalId` accepted as any string | No format validation. DESIGN.md defers format definition to production Pyxis API spec |
| Partial capture remainder silently discarded | After a partial capture, the remaining auth hold disappears. Production requires explicit void of the Authorization to release the remaining hold (expires based on network rules, typically 7–30 days). Documented in §8 divergence note |

---

## 13. DESIGN.md-Deferred Items from REQUIREMENTS.md

Items explicitly noted in REQUIREMENTS.md as "defined in DESIGN.md":

| Item | Section | Resolution |
|------|---------|------------|
| `operation` field values per tool | §2.3 | §3.2 operation value mapping table |
| Full input schemas per tool | §2.3 | §4 Input Schemas |
| Success response field lists | §2.3 | §5 Response Schemas |
| BIN lookup response field names | FR-11 | §5.12 + §8 BIN Database |
| Non-empty `get_settled_transactions` response shape | FR-7 | §5.10 |
| `terminalId` format | Deferred from REQUIREMENTS.md | Any non-empty string (no format validation) |
| `isDeclined` on secondary records | Deferred | Always `false` for Capture, Void, Refund records |
| `fingerprint` field on TokenizedCard | REQUIREMENTS.md §6 | The fingerprint is stored in a separate `cardFingerprints` Map in the state store, not on the `TokenizedCard` interface. REQUIREMENTS.md §6 lists it on the interface for documentation clarity but the code stores it separately. No code change needed |
| Recurring schedule query | Known limitation | No query-by-schedule-ID tool. Developers must track individual transaction IDs |
