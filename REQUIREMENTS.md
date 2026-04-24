# Pyxis Payment MCP — Requirements

## 1. Vision & Purpose

**Pyxis Payment MCP is the official testing and certification tool for Pyxis Payment API integrations.** It provides a local, in-memory sandbox simulation of the Pyxis Payment API that developers can run instantly — no cloud accounts, no credential provisioning, no shared environments. It targets the latest Pyxis API (v3/current) and integrates natively with Claude Desktop and Claude Code CLI via the Model Context Protocol.

**Success criterion:** A developer with zero Pyxis experience can install the MCP server, run a complete payment lifecycle (auth → tokenize → sale → void/refund), and understand the Pyxis response model — all within 15 minutes.

**Acceptance test (Phase 3):** A developer following the README quick start completes `pyxis_get_token → pyxis_tokenize → pyxis_sale → pyxis_void` in under 15 minutes. This is validated as part of the Phase 3 documentation tasks — the quick start guide must be tested against this benchmark.

### Target Users
- **Internal CPP developers** building and maintaining Pyxis integrations
- **Partner developers** integrating their platforms with Pyxis Payment API
- **QA engineers** validating payment flows without touching production

### Pain Points Addressed
- **Slow sandbox provisioning** — Getting access to a live Pyxis sandbox takes too long; this runs instantly
- **Flaky test environments** — Shared sandbox environments are unreliable; this is local and deterministic
- **Developer onboarding** — New developers struggle to understand the Pyxis transaction lifecycle; this makes it interactive and explorable

### Constraints
- **Runtime**: Local on developer machines (Windows, macOS, Linux)
- **Transport**: MCP stdio protocol — consumed by Claude Desktop or Claude Code CLI
- **State**: In-memory only — resets on server restart (intentional for clean sandbox)
- **Cost**: $0 — no paid dependencies, no cloud infrastructure
- **API Target**: Latest Pyxis Payment API (v3/current)

**Code-first principle:** REQUIREMENTS.md describes current code behavior as the baseline. Planned additions are marked with ⊕ and their target phase. No aspirational behavior is presented as current.

---

## 2. Pyxis API Coverage

### 2.1 Transaction Lifecycle

The simulator must faithfully reproduce the Pyxis transaction lifecycle. All transaction types, status transitions, settlement, and reversal paths are shown below.

```
┌─────────────┐     ┌─────────────┐
│  Get Token   │────▶│  Tokenize   │
│  (auth)      │     │  (store card)│
└─────────────┘     └──────┬──────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
       ┌───────────┐ ┌───────────┐  ┌──────────────┐
       │   Sale    │ │ Authorize │  │Account Verify│
       │(auth+cap) │ │  (hold)   │  │ ($0 check)   │
       └─────┬─────┘ └─────┬─────┘  └──────────────┘
             │              │
             │              ▼
             │        ┌───────────┐
             │        │  Capture  │  partial: $0.52 trigger
             │        │ (collect) │  approves floor(amt/2)
             │        └─────┬─────┘
             │              │
             ├──────────────┘
             ▼
       ┌───────────────────────────────────────┐
       │          Settlement Window             │
       │  Auto: ~24hrs after creation           │
       │  Manual: pyxis_settle_transactions     │
       └──────────────┬────────────────────────┘
             ┌────────┴────────┐
             ▼                 ▼
       ┌───────────┐    ┌───────────┐
       │   Void    │    │  Refund   │
       │(unsettled)│    │ (settled) │
       └───────────┘    └───────────┘
```

> **Note:** Settlement is dual-model: transactions auto-settle after ~24hrs (lazy — `settledAt` stamped when settlement state is checked), or developers can settle immediately via `pyxis_settle_transactions` (FR-8). The void/refund boundary is the settlement point: void works only before settlement, refund works only after. `pyxis_settle_transactions` bypasses the 24hr wait for testing convenience.

**Alternative flow — Authorize / Capture:**
```
Get Token → Tokenize → Authorize → Capture → Settle → Void or Refund
```

**Recurring flow:**
```
Get Token → Tokenize → Sale (recurring: "First") → Sale (recurring: "InTrack", recurringScheduleTransId)
```

### 2.2 Operations

| Operation | Pyxis Endpoint | Simulator Tool | Priority |
|-----------|---------------|----------------|----------|
| Authentication | POST /token | `pyxis_get_token` | P0 |
| Tokenize card | POST /tokenize | `pyxis_tokenize` | P0 |
| Sale (auth + capture) | POST /sale | `pyxis_sale` | P0 |
| Authorize | POST /authorize | `pyxis_authorize` | P0 |
| Capture | POST /capture | `pyxis_capture` | P0 |
| Void | POST /void | `pyxis_void` | P0 |
| Refund | POST /refund | `pyxis_refund` | P0 |
| Account verify | POST /accountVerify | `pyxis_account_verify` | P1 |
| Get transaction | GET /transaction | `pyxis_get_transaction` | P1 |
| Get settled txns | GET /settledTransactions | `pyxis_get_settled_transactions` | P1 |
| Convenience fee | POST /convenienceFee | `pyxis_convenience_fee` | P1 |
| BIN lookup | POST /binLookup | `pyxis_bin_lookup` | P2 |
| Settlement accelerator | (simulator-only) | `pyxis_settle_transactions` | Phase 2 |
| Sandbox info | (simulator-only) | `pyxis_sandbox_info` | P0 |

### 2.3 Response Model

All responses must follow the Pyxis response envelope:

```json
{
  "status": "Success | Error",
  "operation": "<operation_name>",
  "responseTimestamp": "YYYY-MM-DD HH:MM:SS",
  "errors": [
    {
      "errorSource": "Validation | Security | Processing",
      "errorCode": "<3-digit code>",
      "errorMsg": "<human-readable message>"
    }
  ]
}
```

**Key conventions:**
- On success (`status: "Success"`), the `errors` array is omitted from the response. On error (`status: "Error"`), the `errors` array contains one or more error objects
- **Declined transactions** are a special case. A Transaction record is stored with `status: "Declined"`, `isDeclined: true`, `approvalNumber: null`, and `feeAmount: 0` (fee is not applied on declines). The response returns `status: "Error"` with error 110, plus the `transactionId` as a top-level field so the caller can look it up. Declined transactions are queryable but cannot be voided, refunded, or captured (error 358). Example decline response:
```json
{
  "status": "Error",
  "operation": "Sale",
  "responseTimestamp": "2026-03-15 14:30:00",
  "transactionId": "abc-123-...",
  "errors": [{ "errorSource": "Processing", "errorCode": "110", "errorMsg": "Do Not Honor" }]
}
```
- HTTP status is always 200 — check `status` field in body
- Amounts are in cents as strings (e.g., `"2530"` for $25.30)
- Error codes are strings in API responses (e.g., `"110"`, not `110`)
- Card expiry format: `MM.YYYY`
- Timestamps: `YYYY-MM-DD HH:MM:SS` (no milliseconds)
- The `operation` field value for each tool is defined in DESIGN.md and must match production Pyxis API operation names exactly
- Full input schemas (required/optional fields per tool, including `bearerToken` and `terminalId`) and success response field lists are defined in DESIGN.md

---

## 3. Functional Requirements

### FR-1: Authentication

| Requirement | Detail |
|------------|--------|
| Issue Bearer tokens | 10-day TTL, UUID format |
| Default mode | Accept any username/password (sandbox convenience) |
| Hardened mode | Enforce credentials via `PYXIS_MCP_USERNAME` / `PYXIS_MCP_PASSWORD` env vars |
| Auth guard | All tools except `pyxis_get_token` and `pyxis_sandbox_info` require valid Bearer token |
| Error codes | 700 (missing token), 701 (invalid credentials), 712 (expired/invalid token) |
| Auth failure simulation | Phase 2: Provide test credentials that trigger specific failures (see §4.3). Not required for Phase 1 |

### FR-2: Tokenization

| Requirement | Detail |
|------------|--------|
| Store card | Return reusable token UUID. ACH tokenization is deferred to a future phase (see §8 Known Divergences) |
| Idempotent | Same card + terminalId always returns the same token. Fingerprint = SHA256(terminalId + rawPAN). The raw PAN is used only for fingerprint computation and is never stored. Expiry and CVV are excluded — re-tokenizing after card renewal with the same PAN returns the same token |
| Token data | Store first6, last4, accountType, expiry, holder name |
| Masked account | Return `first6***last4` format |
| Error codes | 700/712 (auth — current code). ⊕ Phase 1b: 100 (missing/invalid fields). Current code has no input validation |

### Card Input Fields (shared by FR-2, FR-3, FR-4, FR-9)

All tools that accept raw card details use the `accountInfo` object with an optional `accountHolder` wrapper. Tools that accept a tokenized card reference use the `token` field (UUID string). `accountInfo` and `token` are mutually exclusive — providing both returns error 100.

**`accountInfo` object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| accountNumber | string | Yes | Full card PAN (e.g., `"4111111111111111"`) |
| accountType | string | No | Card network. Auto-detected from BIN if omitted. Values: `Visa`, `MasterCard`, `Discover`, `Amex`, `DinersClub`, `DebitCard`, `JCB`, `Checking`, `Savings` |
| accountAccessory | string | No | Card expiry in `MM.YYYY` format (e.g., `"05.2026"`). Defaults to `"12.2026"` if omitted |

**`accountHolder` object** (separate from `accountInfo`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| holderFirstName | string | No | Cardholder first name |
| holderLastName | string | No | Cardholder last name |
| holderStreet | string | No | Cardholder street address (not validated — see §8 AVS) |
| holderPostal | string | No | Cardholder postal code (not validated — see §8 AVS) |

> Note: CVV is not a separate field in the simulator. The simulator does not validate CVV values (see §8).

**Token reference alternative:** Instead of `accountInfo`, pass `token: "<UUID>"` from a prior `pyxis_tokenize` call. Token reference is accepted by FR-3, FR-4, and FR-9 only. FR-2 (`pyxis_tokenize`) accepts raw `accountInfo` only — passing a `token` reference to tokenize returns error 100.

### FR-3: Sale (Auth + Capture)

| Requirement | Detail |
|------------|--------|
| One-step charge | Auth and capture in a single call |
| Input flexibility | Accept raw card details OR tokenized card reference |
| Sale with tokenize | Optional `saleWithTokenize` flag to auto-tokenize the card and return the token UUID as a top-level `generatedToken` field in the sale response (alongside `transactionId`, `approvedAmount`, etc.). If the card was already tokenized, returns the existing token. If `saleWithTokenize: true` is passed with a `token` reference instead of raw card details, return the same token UUID in `generatedToken` without creating a new TokenizedCard record |
| Recurring support | `recurring: "First"` generates `recurringScheduleTransId`; `recurring: "InTrack"` uses it |
| Recurring validation | `InTrack` must validate that `recurringScheduleTransId` references a real "First" transaction. Error 305 if invalid. `First` with a `recurringScheduleTransId` is rejected with error 100 (invalid field combination) |
| Convenience fee | Automatically calculated and included in every Sale response. Fee = `PYXIS_FEE_RATE` (default 3%) × totalAmount, rounded to nearest cent. The caller does NOT need to invoke `pyxis_convenience_fee` first — it is applied automatically. `pyxis_convenience_fee` (FR-10) exists as a standalone pre-transaction estimate tool |
| Decline triggers | Specific amounts trigger specific declines (see §4 Test Data) |
| Error codes | 110 (declined — current code via amount triggers), ⊕ Phase 1a additions: 305 (recurring validation). ⊕ Phase 1b additions: 100 (input validation). ⊕ Phase 2: 355 (duplicate detection), 700/712 (auth) |

### FR-4: Authorize & Capture

| Requirement | Detail |
|------------|--------|
| Authorize | Create auth hold, store as type="Authorization". ⊕ Phase 1: Fee will be calculated at auth time and stored on the Authorization record (current code stores feeAmount: 0). Response includes transactionId, approvalNumber, approvedAmount, feeAmount. The Authorization's feeAmount is an estimate calculated at auth time. The Capture's feeAmount is the authoritative charged fee — callers should use the Capture record's feeAmount for financial reporting |
| Capture | Collect funds from auth hold. Creates a new Capture transaction record. Fee is recalculated against the capture amount (relevant for partial capture). Response includes the new Capture transactionId, approvalNumber, approvedAmount, feeAmount, and referencedTransactionId (the Authorization's ID for correlation). Error 303 if the referenced transaction is not type=Authorization. Error 304 if the Authorization is not status=Approved (e.g., already Captured, Voided, or Declined) |
| Partial capture | Capture amount can differ from auth amount but must not exceed it. Error 356 if capture amount > authorized amount |
| Validation | Capture only works on approved Authorization transactions |
| Recurring | NOT supported with auth/capture — if `recurring` flag is passed, reject with error 100 (invalid field). Use Sale only for recurring |
| Error codes | 302 (not found), 303 (not an authorization), 304 (auth not in approvable state — current code), ⊕ Phase 1a additions: 358 (declined — checked before 304), 356 (capture ceiling). ⊕ Phase 1b additions: 100 (input validation, recurring rejection), 700/712 (auth) |

### FR-5: Void

| Requirement | Detail |
|------------|--------|
| Cancel unsettled | Only works on transactions not yet settled. Void calls `isSettled()` which triggers auto-settlement first — any approved transaction older than 24hrs gets `settledAt` stamped lazily at that moment. If the transaction is settled (either via auto-settlement or manually via `pyxis_settle_transactions` FR-8), void returns error 351 |
| Validation | Transaction must exist, not already voided, not settled, not declined. ⊕ Phase 1b: AccountVerify transactions cannot be voided (error 100 — invalid operation for this transaction type). Current code does not check transaction type |
| Success response | Returns the new Void transaction's transactionId, referencedTransactionId (the voided transaction's ID), operation, and responseTimestamp. The original transaction's status is updated to Voided |
| Error codes | 302 (not found), 350 (already voided), 351 (already settled — use refund — current code), ⊕ Phase 1a additions: 100 (invalid input), 304 (captured auth), 353 (already refunded), 358 (declined), type guards. Current code only checks: exists → voided → settled, 700/712 (auth). See DESIGN.md §7.2 for the complete validation sequence |

### FR-6: Refund

| Requirement | Detail |
|------------|--------|
| Reverse settled | Only works on settled transactions. Refund checks `tx.settledAt` directly — if null, returns error 357 (use void instead). Transactions become settled either via auto-settlement (~24hrs) or manually via `pyxis_settle_transactions` (FR-8) |
| Partial refund | Refund amount can be less than original. Only one refund (partial or full) is allowed per transaction. The original transaction status changes to Refunded immediately. To simulate multiple partial refunds, use separate Sale transactions |
| Validation | Transaction must exist, not voided, not already refunded. Current code checks these three. ⊕ Phase 1a: not declined (error 358), settlement required (error 357). ⊕ Phase 1b: AccountVerify cannot be refunded (error 100), type guards |
| Amount check | Refund amount must not exceed approved amount |
| Success response | Returns the new Refund transaction's transactionId, approvedAmount (refund amount), and referencedTransactionId. The original transaction's status is updated to Refunded |
| Error codes | 302 (not found), 352 (voided transaction), 353 (already refunded), 354 (amount exceeds original — current code), ⊕ Phase 1a additions: 100 (invalid input), 357 (not yet settled), 358 (declined), type guards. Current code checks: exists → voided → refunded → amount, 700/712 (auth). See DESIGN.md §7.3 for the complete validation sequence |

### FR-7: Transaction Queries

| Requirement | Detail |
|------------|--------|
| Get by ID | Lookup single transaction by transactionId |
| Get settled | List settled transactions, optional terminalId filter |
| No side-effects | Querying settlement status must NOT change settlement state |
| Empty results | `pyxis_get_settled_transactions` returns `status: "Success"` with an empty transactions array if no matches found. `pyxis_get_transaction` returns error 302 if ID not found |
| Settlement behavior | `pyxis_get_settled_transactions` returns transactions with `settledAt` set. Auto-settlement stamps `settledAt` lazily — when void or `get_settled_transactions` checks settlement state, transactions older than 24hrs are stamped at that moment. Developers can also use `pyxis_settle_transactions` (FR-8) to settle transactions immediately without waiting |
| Error codes | 100 (invalid input), 302 (transaction not found — `get_transaction` only), 700/712 (auth) |
| Referenced transactions | `pyxis_get_transaction` returns the record itself with `referencedTransactionId` as a field. The caller must look up the original separately if needed — no inline expansion |
| Non-empty results | `pyxis_get_settled_transactions` returns full Transaction objects in the response array. Response shape for non-empty results defined in DESIGN.md |

### FR-8: Settlement Control — Manual Settlement Accelerator

Manual settlement accelerator — settle transactions immediately without waiting for auto-settlement. The `pyxis_settle_transactions` tool complements the default 24-hour auto-settlement by letting developers settle transactions on demand for testing.

| Requirement | Detail |
|------------|--------|
| View pending | List all unsettled transactions with their age |
| Manual settle | Settle specific transactions by ID, or all transactions older than N hours where N is a tool call parameter (e.g., `olderThanHours: 2`). Default: 24. `olderThanHours: 0` is valid and settles all pending transactions regardless of age |
| Settlement clock | Report the current simulated settlement threshold (default: exactly 24 hours) |
| Complements auto-settle | Auto-settlement (24hrs) remains the default. This tool provides an accelerator for developers who need transactions settled immediately (e.g., to test refund flows without waiting). Both settlement paths stamp `settledAt` on the transaction |
| Error codes | 100 (invalid input), 302 (transaction ID not found when settling by ID), 358 (cannot settle a declined transaction), 700/712 (auth) |
| AccountVerify exclusion | AccountVerify transactions are excluded from the pending list and cannot be settled — error 100 if an AccountVerify transaction ID is passed explicitly |

### FR-9: Account Verify

A zero-dollar card validation that confirms the card is valid without charging it.

| Requirement | Detail |
|------------|--------|
| Zero-dollar auth | Validates card without a charge. Transaction type = `AccountVerify`, totalAmount = 0, approvedAmount = 0, feeAmount = 0 |
| Inputs | bearerToken, terminalId, accountInfo (raw card details) OR token reference |
| Success response | Returns transactionId, approvalNumber, accountType, accountFirst6, accountLast4 |
| Decline triggers | Failure cards (§4.4) trigger declines with error 110. Amount-based triggers do not apply (amount is always 0). AccountVerify declines follow the same decline response pattern as Sale declines — `status: "Error"`, error 110, and `transactionId` as a top-level field |
| Error codes | 700/712 (auth — current code). ⊕ Phase 1a: 110 (failure card declines — not yet implemented for AccountVerify). ⊕ Phase 1b: 100 (input validation) |

### FR-10: Convenience Fee Calculation

| Requirement | Detail |
|------------|--------|
| Inputs | bearerToken, terminalId, totalAmount (cents as string), accountType (card network — accepted without validation; any string value passes. Currently unused; reserved for per-network rate schedules in a future version) |
| Pre-transaction | Calculate fee before charging. Fee is calculated against totalAmount for normal transactions; for partial approvals (Phase 2), fee is recalculated against approvedAmount after the approval decision. Applicable as a pre-estimate for Sale (FR-3), Authorize, and Capture (FR-4) operations — all three auto-apply the fee at execution time |
| Configurable rate | Default 3% (hardcoded in Phase 1). Phase 2: overridable via `PYXIS_FEE_RATE` env var (decimal, e.g., `0.025` for 2.5%). Valid range: 0.000–0.999; values outside this range log a warning and default to 0.03 |
| Output | Return feeAmount and totalWithFee |
| Error codes | 100 (invalid input — missing amount, non-numeric), 700/712 (auth) |

### FR-11: BIN Lookup

| Requirement | Detail |
|------------|--------|
| Inputs | bearerToken, accountNumber (full card number or first 6 digits) |
| Card metadata | Return network, credit/debit/prepaid/commercial flags, card length. Response field names defined in DESIGN.md |
| Built-in database | Mappings for all test card BINs plus failure card BINs (§4.4). Unknown BINs return a default response (network: "visa", credit: true) matching the current code fallback. ⊕ Phase 1: change default to network: "Unknown" with all flags false |
| Error codes | 100 (invalid input — non-numeric or fewer than 6 digits), 700/712 (auth) |

### FR-12: Sandbox Info

| Requirement | Detail |
|------------|--------|
| No auth required | Available without Bearer token |
| Test data | Surface all of §4: success cards (§4.1), amount-based decline triggers (§4.2), auth failure triggers (§4.3), failure cards (§4.4), and card expiry format (§4.5). Only list triggers that are active in the current phase — Phase 2 triggers should not appear in Phase 1 output. Include a note that additional triggers are available in Phase 2 |
| API version | ⊕ Phase 1a: Include Pyxis API version the simulator targets (not in current code) |
| Divergences | ⊕ Phase 3: List known differences between simulator and production (not in current code) |
| First-use guide | ⊕ Phase 3: Suggest a sequence of operations for new developers (current code has `keyReminders` array which partially covers this) |

### FR-13: Failure Mode Simulation

| Requirement | Detail |
|------------|--------|
| Amount-based declines | Specific cent amounts trigger specific decline reasons (see §4.2) |
| Card-based failures | Specific test card numbers trigger specific decline reasons (see §4.4) |
| Auth failures | Phase 2: Test credentials that simulate expired tokens, rate limiting (see §4.3) |
| Deterministic | All failure triggers are deterministic (specific input → specific failure), never random |
| Documented | All triggers listed in `pyxis_sandbox_info` and README |

---

## 4. Test Data & Decline Triggers

### 4.1 Success Cards

| Card Number | Type | Notes |
|------------|------|-------|
| 4111111111111111 | Visa | Standard test card |
| 4012888888881881 | Visa | Alternate |
| 5555555555554444 | MasterCard | Standard test card |
| 2223000000000023 | MasterCard | 2-series BIN |
| 378282246310005 | Amex | 4-digit CVV |
| 6011989578768275 | Discover | Standard test card |
| 4041639099002469 | Visa Debit | Debit card |

### 4.2 Amount-Based Decline Triggers

Amount-based triggers apply to Sale and Authorize operations. For partial approval ($0.52), Authorize sets `approvedAmount` = floor(totalAmount / 2) on the Authorization record; subsequent Capture must not exceed `approvedAmount` per FR-4.

| Amount (cents) | Decline Reason | Phase |
|---------------|----------------|-------|
| 1 ($0.01) | Exceeds Approval Amount Limit. Error 110, `gatewayResponseCode: "05"`, `gatewayResponseMessage: "Exceeds Approval Amount Limit"` | Phase 1 (existing) |
| 23 ($0.23) | Network Error. Error 110, `gatewayResponseCode: "05"`, `gatewayResponseMessage: "Network Error"` | Phase 1 (existing) |

**Reserved for Phase 2 — additional triggerable failure modes:**

| Amount (cents) | Scenario | Phase |
|---------------|----------|-------|
| 50 ($0.50) | Network timeout. Error 120, `gatewayResponseCode: "05"`, `gatewayResponseMessage: "Network Timeout"`. Returns immediate error response — no actual delay (see NFR-2) | Phase 2 |
| 51 ($0.51) | Processor unavailable. Error 121, `gatewayResponseCode: "05"`, `gatewayResponseMessage: "Processor Unavailable"` | Phase 2 |
| 52 ($0.52) | Partial approval (approves half the requested amount). Response: `status: "Success"`, Transaction.status = `Approved`, `isDeclined: false`, `approvedAmount` = floor(totalAmount / 2), `feeAmount` recalculated against approvedAmount (not original totalAmount), `gatewayResponseCode: "10"`, `gatewayResponseMessage: "PARTIAL APPROVAL"`. Distinguishing signal: `approvedAmount < totalAmount` | Phase 2 |
| 99 ($0.99) | Duplicate transaction detected (same card token/PAN + same amount + same terminalId within 60 seconds, based on `createdAt` wall-clock timestamps). Error 355. No transaction record is stored — the duplicate is rejected before record creation | Phase 2 |

### 4.3 Auth Failure Triggers (Phase 2)

| Credential | Failure |
|-----------|---------|
| `expired_user` / any password | Returns token with `expiresAt` set to 1 second before `issuedAt` (immediately expired). First call using this token returns error 712 |
| `ratelimit_user` / any password | Returns `status: "Error"` with error code 713, source "Security", message "Rate limit exceeded". No token issued |

### 4.4 Failure Cards

⊕ Phase 1a: All failure cards below are Phase 1 additions — the current code does not implement failure card detection (`isBadCard()` always returns `false`). All failure cards trigger their decline based on the card number alone, regardless of CVV, expiry, or other inputs. The simulator does not validate CVV values.

| Card Number | Type | Decline Reason | Phase |
|------------|------|----------------|-------|
| 4000000000000002 | Visa | Do Not Honor | Phase 1 |
| 5100000000000008 | MasterCard | Insufficient Funds | Phase 1 |
| 4000000000000069 | Visa | Expired Card | Phase 1 |
| 4000000000000127 | Visa | Incorrect CVV | Phase 2 |

### 4.5 Card Expiry Format

`MM.YYYY` (e.g., `"12.2027"`)

---

## 5. Non-Functional Requirements

### NFR-1: Security (Operating Rule #1)
- No API keys or credentials in the repo — use `.env` (gitignored)
- `.env.example` with placeholder values committed for reference
- Sensitive data in audit logs must be masked (card numbers, tokens)

### NFR-2: Performance
- Tool response time < 50ms for all operations (in-memory, no I/O)
- Server startup < 2 seconds

### NFR-3: Compatibility
- Must run on Windows, macOS, and Linux
- Node.js 18+ required
- MCP stdio transport (Claude Desktop, Claude Code CLI)

### NFR-4: Fidelity
- Response formats must match production Pyxis API exactly (field names, types, envelope structure)
- Production error codes are matched where applicable. Codes 110, 302, 303, 304, 350, 351, 700, 701, 712 match production Pyxis. Simulator-specific codes (100, 120, 121, 305, 352, 353, 354, 355, 356, 357, 358, 713) are defined in §7 and documented as simulator-only in `pyxis_sandbox_info`
- Document all known divergences from production behavior

### NFR-5: Cost Awareness (Operating Rule #8)
- Zero paid dependencies — no cloud services required
- Core dependency: `@modelcontextprotocol/sdk`
- Small zero-cost utility dependencies are allowed (e.g., `dotenv` for `.env` parsing) but must be explicitly listed and justified
- Prefer Node.js built-ins where available (e.g., `crypto.randomUUID()` for UUIDs — Node 18+)

### NFR-6: Unit Tests (Operating Rule #17)
- Every tool must have corresponding tests
- Cover: happy path, error cases, edge cases
- Tests run before commits and must pass
- Test framework: Vitest or Jest

### NFR-7: Documentation (Operating Rule #18)
- README with quick start, tool reference, typical flows
- REQUIREMENTS.md (this document)
- DESIGN.md (technical architecture)
- Known Limitations & Divergences section
- Contributing section in README

### NFR-8: Git Flow (Operating Rule #20)
- `main` → `develop` → `feature/<name>`
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- No direct commits to `main`

---

## 6. Data Model (In-Memory)

**Amount representation:** All amount fields (`totalAmount`, `approvedAmount`, `feeAmount`) are stored as integers (cents) internally. They are serialized as strings in API responses per §2.3 conventions (e.g., internal `2530` → response `"2530"`).

**Void and Refund record amounts:** Void records mirror the original transaction's `totalAmount` with `approvedAmount: 0` and `feeAmount: 0` (they are reversals, not charges — the original transaction's amounts are the financial record). Refund records store `totalAmount` and `approvedAmount` as the refund amount (which may be less than the original for partial refunds), and `feeAmount: 0`.

### AuthToken

| Field | Type | Description |
|-------|------|-------------|
| token | string (UUID) | Bearer token value |
| username | string | Issuing username |
| issuedAt | Date | Token creation time |
| expiresAt | Date | Token expiry (10 days from issue) |

> Note: The API response field is `issueAt` (not `issuedAt`) matching the production Pyxis API convention.

### TokenizedCard

| Field | Type | Description |
|-------|------|-------------|
| token | string (UUID) | Reusable token reference |
| terminalId | string | Terminal that tokenized the card |
| accountNumber | string | Masked: `first6******last4` (6 asterisks for 16-digit cards; asterisk count = PAN length - 10) |
| accountFirst6 | string | First 6 digits (BIN) |
| accountLast4 | string | Last 4 digits |
| accountType | string | Visa, MasterCard, Discover, Amex, DinersClub, DebitCard, JCB, Checking, Savings |
| expires | string | `MM.YYYY` format |
| holderFirstName | string? | Optional cardholder first name |
| holderLastName | string? | Optional cardholder last name |

> Note: The idempotent token lookup fingerprint (SHA256 of terminalId + rawPAN) is stored in a separate `cardFingerprints` Map in the state store, not on the TokenizedCard record itself.

### Transaction

| Field | Type | Description |
|-------|------|-------------|
| transactionId | string (UUID) | Unique transaction ID |
| terminalId | string | Processing terminal |
| type | enum | Sale, Authorization, Capture, Void, Refund, Credit, AccountVerify, ForceCapture. Note: Credit and ForceCapture are defined in code but unused in current phases |
| status | enum | Approved, Declined, Voided, Refunded, Captured, Abandoned, Pending. Note: settlement is tracked via the `settledAt` Date field — there is no `Settled` status value. `Abandoned` and `Pending` are defined in code but unused in current phases |
| totalAmount | number | Amount in cents |
| approvedAmount | number | Approved amount in cents |
| feeAmount | number | Convenience fee in cents |
| approvalNumber | string | 6-character approval code. Generated for all transaction records including Void and Refund. Empty string for declined transactions |
| accountType | string? | Card type |
| accountFirst6 | string? | BIN |
| accountLast4 | string? | Last 4 |
| token | string? | Token reference if tokenized |
| externalTransactionId | string? | Optional merchant reference ID. Accepted as input on Sale and Authorize tools. Not accepted on Capture, Void, or Refund — those operations reference an existing transaction by ID. Stored on the transaction record; returned in queries. Not used for any internal logic |
| createdAt | Date | Transaction creation time |
| settledAt | Date? | Settlement time (null = unsettled) |
| recurringScheduleTransId | string? | Populated on `First` sales (auto-generated UUID, distinct from transactionId) and `InTrack` sales (references the First's schedule ID). Null for all other transaction types |
| referencedTransactionId | string? | For voids/refunds/captures — original txn |
| gatewayResponseCode | string | `"00"` = success, `"05"` = decline, `"10"` = partial approval. Extensible — see §4 for additional scenario-specific codes |
| gatewayResponseMessage | string | `"APPROVAL"` or decline reason |
| isDeclined | boolean | Decline flag |

> Note: A `dedupKey` field (Phase 2) will be added to the Transaction model when duplicate detection (T2.6) is implemented.

### Transaction Status Transitions

Each operation creates a new Transaction record and may mutate the original transaction's status. The convention is: **new records are created for Capture, Void, and Refund, AND the original transaction's status is updated**.

| Operation | New Record Type | New Record Status | Original Transaction Status Change |
|-----------|----------------|-------------------|-------------------------------------|
| Sale (approved) | Sale | Approved | — (no original) |
| Sale (declined) | Sale | Declined | — (no original) |
| Sale (settlement) | — | — | Status stays Approved; `settledAt` is stamped (via auto-settlement after ~24hrs, or manually via `pyxis_settle_transactions` FR-8) |
| Authorize | Authorization | Approved | — (no original) |
| Capture | Capture | Captured | Authorization: Approved → Captured |
| Void | Void | Voided | Target: Sale (Approved) or Capture (Captured) record → Voided. ⊕ Phase 1: type guard, declined guard, captured-auth guard |
| Refund | Refund | Approved | Original must have `settledAt` set (⊕ Phase 1: settlement check). Status → Refunded |
| AccountVerify | AccountVerify | Approved or Declined | — (no original) |

**Valid void/refund targets by type:** Void (FR-5) targets Sale and Capture records only. Refund (FR-6) targets Sale and Capture records only. AccountVerify cannot be voided (error 100) or refunded (error 357 — never settles). Void, Refund, and Authorization records cannot themselves be voided or refunded — attempting this returns error 100 (invalid operation for this transaction type).

**Terminal states:** Declined, Voided, Refunded, Captured (for Authorization records only). No further transitions are possible from terminal states. ⊕ Phase 1: Attempting to void, refund, or capture a transaction in a terminal state returns the appropriate error (350, 353, 304, or 358 for Declined).

**Settlement applies to:** Sale (Approved) transaction records only. Note: the current code's `markSettled()` filter checks `status === "Approved"` AND `type === "Sale" || type === "Capture"`. Since Capture records have `status: "Captured"` (not `"Approved"`), they do NOT match the settlement filter. This is a known code behavior — Capture records are never auto-settled in the current implementation. The original Authorization remains at status=Captured permanently.

**Secondary record fields:** Capture records carry their own `approvalNumber` (6-character code) and `gatewayResponseCode: "00"`. Void and Refund records carry their own generated `approvalNumber` (6-character code) and `gatewayResponseCode: "00"` — they reference the original transaction for approval details. All secondary records (Capture, Void, Refund) use `gatewayResponseCode: "00"` and `gatewayResponseMessage: "APPROVAL"` — matching the existing codebase. Note: Void success responses in the current code do not include gateway fields in the API response (they are stored on the Transaction record only).

---

## 7. Error Codes

| Code | Source | Scope | Meaning | Referenced by |
|------|--------|-------|---------|---------------|
| 100 | Validation | Simulator | ⊕ Phase 1b: Missing or invalid required field | All tools |
| 110 | Processing | Production | Transaction declined (all failure card declines use this code with specific errorMsg per §4.4) | FR-3, FR-4, FR-13, FR-9 |
| 120 | Processing | Simulator | ⊕ Phase 2: Network timeout | FR-13 (Phase 2) |
| 121 | Processing | Simulator | ⊕ Phase 2: Processor unavailable | FR-13 (Phase 2) |
| 302 | Processing | Production | Transaction not found | FR-4, FR-5, FR-6, FR-7, FR-8 |
| 303 | Processing | Production | Referenced transaction is not an authorization | FR-4 |
| 304 | Processing | Production | Authorization not in approvable state | FR-4, FR-5 |
| 305 | Processing | Simulator | ⊕ Phase 1b: Referenced recurring schedule transaction not found | FR-3 |
| 350 | Processing | Production | Transaction already voided | FR-5 |
| 351 | Processing | Production | Transaction already settled (use refund) | FR-5 |
| 352 | Processing | Simulator | Cannot refund a voided transaction | FR-6 |
| 353 | Processing | Simulator | Transaction already refunded | FR-5, FR-6 |
| 354 | Processing | Simulator | Refund amount exceeds original | FR-6 |
| 355 | Processing | Simulator | ⊕ Phase 2: Duplicate transaction — same card + amount + terminalId within 60 seconds | FR-3, FR-13 (Phase 2) |
| 356 | Processing | Simulator | ⊕ Phase 1a: Capture amount exceeds authorized amount | FR-4 |
| 357 | Processing | Simulator | ⊕ Phase 1a: Transaction not yet settled — use void | FR-6 |
| 358 | Processing | Simulator | ⊕ Phase 1a: Cannot operate on a declined transaction | FR-4, FR-5, FR-6, FR-8 |
| 700 | Security | Production | Missing Bearer token | FR-1 |
| 701 | Security | Production | Invalid credentials | FR-1 |
| 712 | Security | Production | Token expired or invalid | FR-1 |
| 713 | Security | Simulator | ⊕ Phase 2: Rate limit exceeded — too many requests | FR-1 (Phase 2) |

---

## 8. Known Divergences from Production Pyxis

The simulator makes the following simplifying assumptions. Developers must be aware of these when moving to production:

| Area | Simulator Behavior | Production Behavior |
|------|-------------------|---------------------|
| Fees | Configurable flat % via `PYXIS_FEE_RATE` env var (default 3%, valid range 0–100%). Single rate applied uniformly to all card types | Complex fee schedules per merchant, card type, volume tier |
| Settlement | Dual model: auto-settles after ~24hrs (lazy — `settledAt` stamped when settlement state is checked, not at exactly `createdAt` + 24hrs), or manually via `pyxis_settle_transactions` (FR-8) for immediate settlement. Both paths stamp `settledAt`. Developers testing time-sensitive logic against `settledAt` will see variable offsets with auto-settlement | Batch settlement via processor, timing varies |
| Card validation | BIN lookup from built-in test database only | Real-time processor validation |
| Network failures | Only triggered by specific test amounts/cards | Real network timeouts, partial responses, retries |
| Partial approvals | Simulated via amount trigger $0.52 only (see §4.2): approves floor(totalAmount/2), fee recalculated against approvedAmount. Production supports partial approvals for any amount on eligible card types | Supported for certain card types and amounts |
| Multi-currency | Not supported (USD only) | Supported |
| Address verification (AVS) | Not simulated | AVS checks on production |
| 3D Secure | Not simulated | Required for certain card-not-present flows |
| Batch processing | Not supported | Batch settlement, batch refunds |
| Webhooks/callbacks | Not supported | Real-time transaction notifications |
| Idempotency keys | Transaction-level idempotency keys not supported. Duplicate detection is limited to the $0.99 amount trigger (same card + amount + terminalId within 60 seconds, error 355). All other duplicate submissions create separate transactions. Token-level idempotency IS implemented (FR-2: same card + terminalId = same token) | Production likely supports both token and transaction-level idempotency keys |
| Token vault expiry | Tokenized cards have no token-level expiry (only card expiry in `expires` field) | Production may enforce token vault TTL or revocation policies |
| CVV validation | Not validated — declines are card-number-based only (§4.4). Omitting CVV does not cause an error | Production performs real CVV verification; missing or incorrect CVV may cause decline |
| Card expiry validation | Not validated — the "Expired Card" decline is triggered by card number, not actual expiry date. A card with a past expiry date will still approve if using a success card | Production rejects cards with expired dates |
| ACH / bank account | Not supported — tokenization and transactions are card-only. Deferred to a future phase | Production supports ACH debits and credits |
| Partial capture remainder | After partial capture, remaining auth hold is silently discarded. Production requires explicit void of the original Authorization to release the remaining hold, or it expires based on network rules (7–30 days) | Remaining auth hold must be explicitly released or it expires per network rules |
| Terminal matching on capture | Any terminal can capture any Authorization. Production requires the capturing terminal to match the authorizing terminal | Capture must originate from the same terminal that created the Authorization |
| Bearer token entropy | Simulator uses UUID-format tokens (122 bits via `crypto.randomUUID()`). Production tokens use cryptographically secure random values with higher entropy | Production tokens are high-entropy opaque strings, not UUIDs |
| Multiple partial refunds | Not supported — only one refund (partial or full) per transaction (FR-6). To test multiple refunds, use separate Sale transactions | Production allows multiple partial refunds up to the approved amount |

---

## 9. Implementation Phases

### Phase 1a: Critical Production-Fidelity Guards
- ⊕ Add settlement check to `simulateRefund` (error 357 if `settledAt` is null) — panel-approved code modification
- ⊕ Implement lazy auto-settlement: `isSettled()` triggers `markSettled()` to stamp `settledAt` on transactions older than 24hrs. This runs when void checks settlement and when `get_settled_transactions` queries are made
- ⊕ Implement error 358 (declined transaction guard) on void, refund, and capture
- ⊕ Implement error 305 (recurring schedule validation: InTrack must reference real First in Approved status; voided/refunded First returns 305)
- ⊕ Implement Phase 1 failure cards (§4.4): Do Not Honor, Insufficient Funds, Expired Card
- ⊕ Implement error 356 (capture amount ceiling)
- ⊕ Add `apiVersion` to `pyxis_sandbox_info` output
- Set up test framework (Vitest)
- Add tests for Phase 1a additions + all existing happy paths
- Set up CI pipeline (GitHub Actions — cross-platform matrix)

### Phase 1b: Robustness & Input Validation
- ⊕ Implement error 100 (input validation) for all tools: required fields, mutual exclusivity (accountInfo vs token), recurring flag on authorize, totalAmount > 0
- ⊕ Implement error 304 on void (Authorization in Captured terminal state)
- ⊕ Implement error 353 on void (already refunded transaction)
- ⊕ Implement type guards on void/refund (only Sale/Capture targets; AccountVerify → error 100 for void)
- ⊕ Formalize `pyxis_account_verify` per FR-9 (add failure card decline support)
- ⊕ Update `pyxis_sandbox_info` to be phase-aware (list only active triggers; note Phase 2 availability)
- ⊕ Change BIN lookup unknown default from "visa" to "Unknown"
- Fee rate is hardcoded at 3% in Phase 1 — `PYXIS_FEE_RATE` env var support is added in Phase 2
- Add tests for all Phase 1b additions
- All 13 Phase 1 tools fully tested: pyxis_get_token, pyxis_tokenize, pyxis_sale, pyxis_authorize, pyxis_capture, pyxis_void, pyxis_refund, pyxis_account_verify, pyxis_get_transaction, pyxis_get_settled_transactions, pyxis_convenience_fee, pyxis_bin_lookup, pyxis_sandbox_info

> **Panel override:** The settlement check on refund (Phase 1a, first item) is the ONE modification to existing code behavior approved by the mastermind panel. All other Phase 1 changes are additive only.

### Phase 2: Simulation Fidelity
- Add auth failure simulation (test credentials per §4.3)
- Add triggerable failure modes (reserved amount triggers per §4.2)
- Implement `PYXIS_FEE_RATE` env var support (FR-10) with validation bounds
- Implement `pyxis_settle_transactions` tool (FR-8) — manual settlement accelerator complementing auto-settlement
- Add tests for all Phase 2 additions: `pyxis_settle_transactions` (FR-8), Phase 2 amount triggers (§4.2), auth failure triggers (§4.3), `PYXIS_FEE_RATE` validation bounds (FR-10), and Phase 2 failure card (§4.4)

### Phase 3: Documentation & Polish
- Document known divergences (section in README + `pyxis_sandbox_info` output)
- Improve tool descriptions for AI consumption
- Add API version tracking to server metadata and `pyxis_sandbox_info`
- Simplify audit logging (reduce masking complexity)
- Add Contributing section to README
- Update ASCII lifecycle diagram to reflect dual settlement model (auto-settle + manual accelerator)
- Verify §8 divergence rows match implemented Phase 2 behavior (partial approvals, settlement)
- Reorder §7 error codes numerically
- Renumber FRs sequentially for external readability

### Phase 4: Architecture (after tests are green)
- Split `index.ts` into focused modules (tool defs, routing, audit, auth)
- Set up Git Flow branching (`develop` branch)

---

## 10. Operating Rules Checklist

All 20 operating rules evaluated. **Bold = active for this project.**

| # | Rule | Applies? | How |
|---|------|----------|-----|
| **1** | **No secrets in repos** | **Yes** | **`.env` for credentials, `.gitignore`** |
| 2 | PCI + SOC2 | No | Sandbox simulator, no real payment data |
| 3 | Everything as code | No | Local dev tool |
| 4 | Pipeline security | No | CI planned but no cloud deploy |
| 5 | Internal vs customer facing | No | Local tool |
| 6 | Centralized SSO | No | Local tool |
| 7 | Change control | No | In-memory state, no migrations |
| **8** | **Optimize costs** | **Yes** | **Zero paid dependencies, free-tier only** |
| 9 | DB snapshots | No | In-memory state |
| 10 | Event-driven | No | Single-process MCP server |
| **11** | **Final compliance review** | **Yes** | **Check against active rules before every commit** |
| 12 | Tenant config | No | Single-user dev tool |
| 13 | Headless API | No | MCP protocol is the interface |
| 14 | Cost-to-serve | No | Local tool, zero cost |
| 15 | Least privilege IAM | No | No cloud IAM |
| **16** | **Repos private** | **Yes** | **Private GitHub repo** |
| **17** | **Unit tests** | **Yes** | **Every tool has tests, run before commits** |
| **18** | **Documentation** | **Yes** | **README + REQUIREMENTS.md + DESIGN.md** |
| **19** | **Req → Design → Tasks → Panel → Build** | **Yes** | **Full delivery workflow with mastermind-panel** |
| **20** | **Git Flow** | **Yes** | **`main` → `develop` → `feature/<name>`, conventional commits** |

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Simulator diverges from production Pyxis as API evolves | API version tracking + divergence documentation. Divergence table (§8) is reviewed when the Pyxis API version changes. §9 Phase 3 task T3.6 is re-executed after each version bump |
| Developers build false confidence from happy-path-only testing | Triggerable failure modes ensure developers test error handling |
| Single developer bus factor | Contributing guide, clean architecture, comprehensive tests |
| Partners use simulator as source of truth instead of docs | Clear "Known Divergences" section; sandbox_info tool warns about limitations |
| Recurring payment bugs masked by lax validation | Validate `recurringScheduleTransId` references; test coverage for recurring flows |

### Pre-Mortem: How This Tool Fails

1. **Simulator falls behind the real API.** Pyxis ships v4, the simulator still simulates v3. Developers test against stale behavior. Early warning: divergence log grows without updates.
2. **Tests give false green.** Tests pass but don't match real Pyxis responses because someone hardcoded expected values instead of matching the actual API spec. Early warning: production integration failures despite all-green simulator tests.
3. **Nobody uses it.** Developers find it easier to test against the live sandbox. The tool atrophies. Early warning: no commits for 3+ months, no new tool invocations in audit logs.
4. **Partners trust it too much.** A partner skips production testing because "it worked in the simulator." Early warning: partner-reported bugs that the simulator would have caught with better fidelity.
