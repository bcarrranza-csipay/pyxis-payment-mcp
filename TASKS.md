# Pyxis Payment MCP — Tasks

Living document tracking implementation progress. Updated as tasks are completed.

**Legend:** `[ ]` remaining, `[x]` done, `[~]` blocked

---

## Phase 1a: Critical Production-Fidelity Guards

> **Completion criteria:** All Phase 1a tasks green. Acceptance test (T1.13c) passes. CI pipeline runs on develop.

### Infrastructure
- [x] **T1.1** Set up Vitest test framework
  - Install `vitest` as dev dependency
  - Create `vitest.config.ts`
  - Add `"test": "vitest run"` to package.json scripts
  - Create `tests/` directory and `tests/helpers.ts` with shared utilities (getTestToken, makeApprovedSale, etc.)
  - Tests: verify framework runs with a trivial test

- [x] **T1.2** Set up CI pipeline (GitHub Actions)
  - Create `.github/workflows/ci.yml` with cross-platform matrix (ubuntu, windows, macos)
  - Steps: checkout → setup-node 18 → npm ci → npm run build → npm test
  - Tests: verify CI runs on push/PR

- [x] **T1.2b** Update `.env.example`
  - Document all env vars: `PYXIS_MCP_USERNAME`, `PYXIS_MCP_PASSWORD`, `PYXIS_AUDIT_LOG`, `PYXIS_FEE_RATE` (Phase 2 placeholder)

- [x] **T1.2c** Verify develop branch setup (already created; confirm CI triggers on develop branch pushes)

### Settlement Fixes
- [x] **T1.3** Fix settlement side-effect in `state.ts`
  - Replaced original `markSettled()` side-effect inside `isSettled()` with `autoSettle()` method
  - `autoSettle()` checks age >24hrs, type Sale/Capture, status Approved → stamps `settledAt`
  - `isSettled()` calls `autoSettle()` transparently, so settlement checks on void/refund paths trigger auto-settlement
  - Tests: query after >24hrs triggers auto-settle; void after >24hrs → error 351 (settled)

- [x] **T1.4** Add settlement check to `simulateRefund` (**panel-approved code modification**)
  - Per DESIGN.md §7.3: add settlement check at step 6 (after amount check). If `settledAt` is null on the target transaction, return error 357
  - This is the ONE modification to existing code behavior
  - Tests: refund on unsettled transaction → error 357; refund on settled transaction → success

### Declined Transaction Guard (error 358)
- [x] **T1.5** Add error 358 to `simulateVoid`
  - Per DESIGN.md §7.2: insert after voided check (350) as step 4. Check `status === "Declined"` → error 358. This runs AFTER exists (302), voided (350), and settlement (351) checks.
  - Tests: void on declined Sale → error 358; void on declined Authorization → error 358

- [x] **T1.6** Add error 358 to `simulateRefund`
  - Per DESIGN.md §7.3: insert after refunded check (353) and amount check (354) as step 5. Check `status === "Declined"` → error 358.
  - Tests: refund on declined Sale → error 358

- [x] **T1.7** Add error 358 to `simulateCapture`
  - Per DESIGN.md §7.4: insert after type check (303) as step 4. Check `status === "Declined"` → error 358. This runs AFTER the Authorization type check.
  - Tests: capture on declined Authorization → error 358

### Failure Cards
- [x] **T1.10** Implement failure card detection in `simulator.ts`
  - Add `FAILURE_CARDS` map: `{ "4000000000000002": "Do Not Honor", "5100000000000008": "Insufficient Funds", "4000000000000069": "Expired Card" }`
  - In `simulateSale`: check failure cards BEFORE amount triggers. If card matches → create Declined transaction, return error 110 with specific message
  - In `simulateAuthorize`: same check
  - Tests: each failure card on Sale → error 110 with correct message; each failure card on Authorize → error 110

### Capture Ceiling (error 356)
- [x] **T1.11** Add capture amount validation in `simulateCapture`
  - After auth status check: if `captureAmount > auth.totalAmount` → error 356
  - Tests: capture $60 on $50 auth → error 356; capture $50 on $50 auth → success; partial capture $30 on $50 → success

### Response Schema Additions
- [x] **T1.11b** Add `accountMasked` field to all transaction responses
  - Add `accountMasked` (e.g., `"411111******1111"`) to Sale, Authorize, Capture, Void, Refund, AccountVerify success responses and GetTransaction response
  - Computed from `accountFirst6 + "******" + accountLast4` (for 16-digit cards)
  - Tests: each response includes `accountMasked` field

- [x] **T1.11c** Add `isDeclined` to GetTransaction response
  - Include `isDeclined: true/false` in the `simulateGetTransaction` return object
  - Tests: get_transaction on declined sale → `isDeclined: true`; on approved → `isDeclined: false`

- [x] **T1.11d** Add `feeAmount` estimate to Authorize response
  - Calculate fee at auth time (3% of totalAmount) and include in Authorize response
  - Store on Authorization Transaction record (currently hardcoded to 0)
  - Tests: authorize for $25.30 → feeAmount "76" in response

### Sandbox Info
- [x] **T1.12** Add `apiVersion` to `pyxis_sandbox_info` output
  - Add `apiVersion: "Pyxis v3 (current)"` to the sandbox_info response object
  - Tests: sandbox_info response includes apiVersion field

### Phase 1a Tests (comprehensive)
- [x] **T1.13** Write tests for all existing happy paths
  - `tests/auth.test.ts`: get_token default mode, hardened mode (701)
  - `tests/tokenize.test.ts`: new card, idempotent return (same card+terminal = same token)
  - `tests/sale.test.ts`: approved sale, amount decline ($0.01, $0.23), saleWithTokenize, recurring First/InTrack
  - `tests/authorize-capture.test.ts`: approve → capture, partial capture
  - `tests/void.test.ts`: void approved sale, void already voided (350), void settled (351)
  - `tests/refund.test.ts`: refund settled, refund voided (352), refund already refunded (353), refund amount exceeded (354)
  - `tests/account-verify.test.ts`: approved verify
  - `tests/queries.test.ts`: get_transaction found/not found (302), get_settled_transactions empty
  - `tests/convenience-fee.test.ts`: fee calculation (3% of amount)
  - `tests/bin-lookup.test.ts`: known BIN, unknown BIN default
  - `tests/sandbox-info.test.ts`: returns expected structure
  - `tests/lifecycle.test.ts`: end-to-end lifecycle test: get_token → tokenize → sale → void in a single test verifying the full chain works

- [x] **T1.13b** Add MCP transport smoke test
  - One test that sends a JSON-RPC CallTool request through the MCP server entry point
  - Verify correct routing to simulator function and response shape
  - Tests: call pyxis_sandbox_info through transport → valid response

- [x] **T1.14** Write tests for Phase 1a additions
  - Settlement: void triggers settlement check; refund requires settlement (357); query does NOT trigger settlement
  - Declined guard: error 358 on void/refund/capture of declined transactions
  - Failure cards: all 3 Phase 1 cards on Sale and Authorize
  - Decline response includes `gatewayResponseCode` and `gatewayResponseMessage` as top-level fields
  - Capture ceiling: error 356
  - Void uncaptured Authorization: valid path (auth → void(auth ID) → success)
  - Sandbox info: apiVersion present

- [x] **T1.13c** Run 15-minute acceptance test (pyxis_get_token → pyxis_tokenize → pyxis_sale → pyxis_void)
  - Validate the end-to-end developer experience against the README quick start
  - This was originally T3.9 — moved to Phase 1a per panel directive

- [x] **T1.14b** Phase 1a completion: verify cross-document consistency between REQUIREMENTS.md, DESIGN.md, and TASKS.md

---

## Phase 1b: Robustness & Input Validation

> **Completion criteria:** All Phase 1b tasks green. All 13 Phase 1 tools fully tested with happy path, error paths, and edge cases.

### Input Validation (error 100)
- [x] **T1.15** Implement error 100 validation framework
  - Add a `validateInput(toolName, args)` function that checks required fields and returns error 100 if missing
  - Required fields per tool defined in DESIGN.md §4.2
  - Tests: missing bearerToken → error 700 (existing auth guard); missing terminalId → error 100; missing totalAmount → error 100

- [x] **T1.16** Implement mutual exclusivity check (accountInfo vs token)
  - If both `accountInfo` AND `token` are provided → error 100
  - If neither is provided (on tools that require one) → error 100
  - Tests: both provided → error 100; neither provided → error 100; each alone → success

- [x] **T1.17** Implement totalAmount > 0 validation
  - For Sale, Authorize, Capture: totalAmount must be positive integer string → error 100 if zero or negative
  - For Refund: totalAmount must be > 0 → error 100
  - For ConvenienceFee: zero accepted (returns zero fee)
  - Tests: totalAmount "0" on Sale → error 100; totalAmount "0" on ConvenienceFee → success with fee "0"

- [x] **T1.18** Reject `recurring` flag on `pyxis_authorize`
  - If `recurring` is passed in args to authorize → error 100 (even though it's not in the schema, validate defensively)
  - Tests: authorize with recurring "First" → error 100

- [x] **T1.19** Reject `token` input on `pyxis_tokenize`
  - If `token` field is provided to tokenize → error 100
  - Tests: tokenize with token UUID → error 100

### Void Robustness
- [x] **T1.20** Add error 304 on void (captured Authorization)
  - If target is an Authorization with status "Captured" → error 304 ("target the Capture record instead")
  - Tests: auth → capture → void(auth ID) → error 304; void(capture ID) → success

- [x] **T1.21** Add error 353 on void (already refunded)
  - If target status is "Refunded" → error 353
  - Tests: sale → settle → refund → void(sale ID) → error 353

- [x] **T1.22** Add type guards on void
  - Only Sale and Capture records can be voided
  - AccountVerify → error 100; Void/Refund/Authorization type → error 100
  - Tests: void(AccountVerify ID) → error 100; void(Void record ID) → error 100

### Recurring Validation (error 305)
- [x] **T1.8** Validate InTrack `recurringScheduleTransId` in `simulateSale`
  - When `recurring === "InTrack"`: look up the referenced transaction by `recurringScheduleTransId`. Validate: (a) transaction exists, (b) it was a First recurring sale (has a populated `recurringScheduleTransId` of its own), (c) status is Approved (not Voided/Refunded)
  - If not found → error 305
  - If found but status is Voided or Refunded → error 305 with message "Recurring schedule is no longer active"
  - If found and status is Approved → proceed
  - Tests: InTrack with valid First → success; InTrack with bogus ID → error 305; InTrack with voided First → error 305

- [x] **T1.9** Reject `First` with `recurringScheduleTransId` in `simulateSale`
  - When `recurring === "First"` AND `recurringScheduleTransId` is provided → error 100 (invalid field combination)
  - Tests: First + recurringScheduleTransId → error 100; First without it → success with generated schedule ID

### Refund Robustness
- [x] **T1.23** Add type guards on refund
  - Only Sale and Capture records can be refunded
  - AccountVerify → error 100; Void/Refund/Authorization type → error 100
  - Tests: refund(AccountVerify ID) → error 100; refund(Refund record ID) → error 100

### Account Verify Enhancements
- [x] **T1.24** Add failure card decline support to `simulateAccountVerify`
  - Check `FAILURE_CARDS` map against the submitted card number
  - If match → create Declined transaction record, return error 110
  - Tests: AccountVerify with Do Not Honor card → error 110; AccountVerify with success card → success

### Sandbox Info Phase-Awareness
- [x] **T1.25** Update `pyxis_sandbox_info` to be phase-aware
  - Only list Phase 1-active triggers (success cards, Phase 1 amount triggers, Phase 1 failure cards)
  - Add note: "Additional triggers available in Phase 2"
  - Tests: sandbox_info does NOT contain Phase 2 triggers ($0.50, $0.51, etc.)

### BIN Lookup Default
- [x] **T1.26** Change unknown BIN default from "visa" to "Unknown"
  - Update `BIN_DB` default fallback: `{ network: "Unknown", credit: false, debit: false, prepaid: false, commercial: false }`
  - Add failure card BINs (400000, 510000) to `BIN_DB`
  - Tests: unknown BIN → network "Unknown"; failure card BIN → correct network

### Phase 1b Tests
- [x] **T1.27** Write tests for all Phase 1b additions
  - Recurring validation: InTrack with valid First → success; InTrack with bogus ID → error 305; InTrack against voided First → error 305; First + recurringScheduleTransId → error 100
  - Input validation: missing required fields, mutual exclusivity, zero amounts, recurring on authorize, token on tokenize
  - Void robustness: error 304 (captured auth), error 353 (refunded), type guards (100)
  - Refund robustness: type guards (100)
  - AccountVerify: failure card declines
  - Sandbox info: phase-aware content
  - BIN lookup: updated default

- [x] **T1.27b** Phase 1b completion: verify cross-document consistency between REQUIREMENTS.md, DESIGN.md, and TASKS.md

---

## Phase 2: Simulation Fidelity

### Auth Failure Simulation
- [x] **T2.1** Implement `expired_user` test credential
  - In `simulateGetToken`: if username is `expired_user`, return a token with `expiresAt` set to 1 second before `issuedAt`
  - Tests: get_token with expired_user → success; use returned token → error 712

- [x] **T2.2** Implement `ratelimit_user` test credential
  - In `simulateGetToken`: if username is `ratelimit_user`, return error 713 immediately (no token issued)
  - Tests: get_token with ratelimit_user → error 713

### Amount Triggers (Phase 2)
- [x] **T2.3** Implement $0.50 network timeout trigger
  - Error 120, gatewayResponseCode "05", message "Network Timeout"
  - Returns immediate error (no delay per NFR-2)
  - Tests: Sale for $0.50 → error 120

- [x] **T2.4** Implement $0.51 processor unavailable trigger
  - Error 121, gatewayResponseCode "05", message "Processor Unavailable"
  - Tests: Sale for $0.51 → error 121

- [x] **T2.5** Implement $0.52 partial approval trigger
  - approvedAmount = floor(totalAmount / 2), feeAmount recalculated against approvedAmount
  - gatewayResponseCode "10", message "PARTIAL APPROVAL", status "Success", isDeclined false
  - Tests: Sale for $0.52 → approvedAmount "26", feeAmount recalculated

- [x] **T2.6** Implement $0.99 duplicate transaction trigger
  - Error 355, no transaction record stored
  - Dedup key: hash of (card token/PAN + totalAmount + terminalId), 60-second window based on createdAt
  - Tests: two identical sales within 60s → second returns error 355; different amount → both succeed

- [x] **T2.7** Implement Phase 2 failure card (Incorrect CVV)
  - Add `"4000000000000127": "Incorrect CVV"` to FAILURE_CARDS map
  - Tests: Sale with 4000000000000127 → error 110 "Incorrect CVV"

### Fee Configuration
- [x] **T2.8** Implement `PYXIS_FEE_RATE` env var
  - Read from `process.env.PYXIS_FEE_RATE`, parse as float, clamp to [0, 1], default 0.03
  - Tests: env var 0.025 → fee = 2.5%; env var 2.0 (clamped to 1.0) → 100% fee; no env var → 3%

### Settlement Control (FR-8)
- [x] **T2.9** Implement `pyxis_settle_transactions` tool
  - Add tool definition to TOOLS array in index.ts
  - Add `simulateSettleTransactions` to simulator.ts
  - View pending: list all unsettled Sale/Capture transactions with age
  - Manual settle by ID or by `olderThanHours` parameter (default 24, 0 = settle all)
  - Exclude AccountVerify from pending list (error 100 if passed explicitly)
  - Error 302 if ID not found, error 358 if declined
  - Tests: settle by ID, settle by age, settle all (olderThanHours: 0), AccountVerify exclusion

- [x] **T2.10** Restore auto-settlement as default, add manual tool as accelerator
  - Remove `checkAndSettleOnWrite()` from void/refund paths (simplified to `autoSettle` triggered on reads)
  - Auto-settlement remains the default: transactions settle automatically after 24hrs when queried via `autoSettle()`
  - Void path uses `isSettled()` which triggers `autoSettle`, preserving error 351 for settled transactions
  - Manual `pyxis_settle_transactions` tool (FR-8) serves as an accelerator for immediate settlement
  - Tests: void after >24hrs auto-settles via `isSettled()` → error 351; manual tool can settle before 24hrs

- [x] **T2.10b** Update Phase 1 settlement tests for Phase 2 behavior
  - Remove references to `checkAndSettleOnWrite`; auto-settlement now happens via `autoSettle()` on reads
  - Error 351 (void settled) and error 357 (refund unsettled) still apply — auto-settlement preserved these guards
  - Verify void after >24hrs triggers auto-settle via `isSettled()` → error 351
  - Tests: regression suite passes with restored auto-settlement model + manual accelerator

### Phase 2 Tests
- [x] **T2.11** Write tests for all Phase 2 additions
  - Auth failure triggers: expired_user, ratelimit_user
  - Amount triggers: $0.50, $0.51, $0.52, $0.99
  - PYXIS_FEE_RATE: valid, invalid, missing
  - Settlement control: all FR-8 behaviors
  - Phase 2 failure card

- [x] **T2.11b** Phase 2 completion: verify cross-document consistency

---

## Phase 3: Documentation & Polish

- [x] **T3.1** Document known divergences in README + sandbox_info
- [x] **T3.2** Improve tool descriptions for AI consumption
- [x] **T3.3** Simplify audit logging (reduce masking complexity)
- [x] **T3.4** Add Contributing section to README
- [x] **T3.4b** Document usage monitoring guidance: track tool invocation counts from audit log to detect adoption drop-off
- [x] **T3.5** Replace Phase 1 lifecycle diagram with Phase 2 version
- [x] **T3.6** Verify §8 divergence rows match Phase 2 behavior
- [x] **T3.7** Reorder §7 error codes numerically
- [x] **T3.8** Renumber FRs sequentially
- [x] **T3.8b** Add API version to MCP server metadata (server name/version in Server constructor)

---

## Phase 4: Architecture

- [x] **T4.1** Split `index.ts` into modules (tools/definitions.ts, router.ts, auth-guard.ts, audit.ts)
- [x] **T4.2** Verify all tests still pass after refactor
- [x] **T4.3** Update DESIGN.md §2 to reflect final project structure
- [x] **T4.4** Document full Git Flow branching model (develop branch created in Phase 1a T1.2c; document release/hotfix workflow in CONTRIBUTING section)

---

## Progress Summary

| Phase | Total Tasks | Done | Remaining |
|-------|-----------|------|-----------|
| 1a | 18 | 18 | 0 |
| 1b | 15 | 15 | 0 |
| 2 | 12 | 12 | 0 |
| 3 | 10 | 10 | 0 |
| 4 | 4 | 4 | 0 |
| **Total** | **59** | **59** | **0** |
