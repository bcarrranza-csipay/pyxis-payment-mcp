# Codebase Changes Required

**Constraint:** The existing Pyxis codebase cannot be modified at this time. REQUIREMENTS.md and DESIGN.md must align to the existing code, not the other way around. Changes listed below are ONLY additions/fixes needed to implement REQUIREMENTS.md features that don't exist yet.

**Panel override (one exception):** The mastermind panel unanimously approved ONE modification to existing code behavior: adding a settlement check to `simulateRefund` (error 357 if `settledAt` is null). This prevents the simulator from teaching incorrect refund behavior. All other changes are additive only.

## Code is Source of Truth — Docs Must Match

These items are NOT code changes — they are cases where REQUIREMENTS.md needs to be updated to match existing code behavior:

| Existing Code | REQUIREMENTS.md Says | Resolution |
|--------------|---------------------|------------|
| `accountInfo.accountAccessory` for expiry | `expires` in Card Input Fields | Update REQUIREMENTS.md to use `accountAccessory` |
| `accountHolder` as separate top-level object | Holder names inside `accountInfo` | Update REQUIREMENTS.md to use `accountHolder` wrapper |
| `issueAt` in token response | `issuedAt` in AuthToken model | Update REQUIREMENTS.md to use `issueAt` (production field name) |
| `transactionStatus` in get_transaction response | `status` in data model | Already documented in DESIGN.md as production field mapping |
| `creationTime` in get_transaction response | `createdAt` in data model | Already documented in DESIGN.md as production field mapping |
| `tokenUsedIndicator` in get_transaction response | Not in REQUIREMENTS.md | Already documented in DESIGN.md as derived production field |
| Capture record `status: "Captured"` | REQUIREMENTS.md says `status: "Approved"` | Update REQUIREMENTS.md — code uses Captured for the new record |
| Void record `totalAmount: tx.totalAmount` | REQUIREMENTS.md says `totalAmount: 0` | Update REQUIREMENTS.md — code mirrors original amount |
| Refund record `approvalNumber: approvalCode()` | REQUIREMENTS.md says `approvalNumber: null` | Update REQUIREMENTS.md — code generates approval code for refunds |
| Void record `status: "Voided"` | REQUIREMENTS.md says `status: "Approved"` for new records | Update REQUIREMENTS.md — code uses Voided for void records |
| `accountInfo.accountType` enum includes `Checking`, `Savings`, `DinersClub`, `JCB` | REQUIREMENTS.md only lists Visa, MasterCard, Amex, Discover | Update REQUIREMENTS.md to include full enum |

## Additions Needed (new features, not changes to existing behavior)

### Phase 1: Missing Validation Logic (add to existing code)

| Feature | File | Description |
|---------|------|-------------|
| Failure card detection | `simulator.ts` | Add `FAILURE_CARDS` map, check before amount triggers in Sale/Authorize/AccountVerify |
| Input validation (error 100) | `simulator.ts` | Validate required fields, mutual exclusivity, recurring flag on authorize |
| Recurring schedule validation (error 305) | `simulator.ts` | Validate `recurringScheduleTransId` references real First txn in Approved/Settled status |
| Capture ceiling (error 356) | `simulator.ts` | Reject if capture amount > authorized amount |
| Declined transaction guard (error 358) | `simulator.ts` | Check `status === "Declined"` on void/refund/capture before other validation |
| Void type guard (error 100) | `simulator.ts` | Only allow void on Sale/Capture records; reject AccountVerify, Void, Refund, Authorization types |
| Refund type guard (error 100/357) | `simulator.ts` | Only allow refund on Sale/Capture; AccountVerify returns 357 |
| Captured Authorization guard (error 304) | `simulator.ts` | Return 304 when voiding an Authorization in Captured state |
| Refunded transaction guard (error 353) | `simulator.ts` | Return 353 when voiding a Refunded transaction |
| Not-settled refund guard (error 357) | `simulator.ts` | Return 357 when refunding an unsettled transaction |
| Zero-dollar amount validation | `simulator.ts` | Reject Sale/Authorize/Capture with totalAmount ≤ 0 |

### Phase 1: Settlement Side-Effect Fix

| Feature | File | Description |
|---------|------|-------------|
| Remove `markSettled()` from `isSettled()` | `state.ts` | `isSettled()` currently calls `markSettled()` which mutates state on read — violates FR-7 |
| Add `checkAndSettleOnWrite()` | `state.ts` | Called by void/refund only. Checks age, marks settled if >24hrs |

### Phase 1: Missing Features (add to existing code)

| Feature | File | Description |
|---------|------|-------------|
| Failure cards (3 Phase 1 cards) | `simulator.ts` | Add to SUCCESS_CARDS check: Do Not Honor, Insufficient Funds, Expired Card |
| AccountVerify decline support | `simulator.ts` | Check failure cards in `simulateAccountVerify` |
| Phase-aware `pyxis_sandbox_info` | `index.ts` | Only show Phase 1-active triggers; note Phase 2 availability |
| Fee on Authorize | `simulator.ts` | Calculate fee at auth time (currently sets `feeAmount: 0`) |

### Phase 1: State.ts Type Updates (additive only)

| Change | Description |
|--------|-------------|
| Add `fingerprint` to `TokenizedCard` interface | `fingerprint: string` — SHA256 hash for idempotent lookup (already computed but not stored on the interface) |
| Add `Settled` to `TransactionStatus` union | Currently missing from the type — needed for settlement status |
| Make `approvalNumber` optional | `approvalNumber?: string` — null for declined transactions |
| Add `dedupKey` to `Transaction` interface | `dedupKey?: string` — Phase 2 field, null in Phase 1 |

> Note: Do NOT remove `Credit`, `ForceCapture`, `Abandoned`, `Pending` from the existing types — the codebase cannot be modified. These unused types remain in the code but are not referenced by REQUIREMENTS.md.

### Phase 1: Test Infrastructure (new files only)

| Item | Description |
|------|-------------|
| `npm install -D vitest` | Add test framework |
| `vitest.config.ts` | Test configuration |
| `"test": "vitest run"` in package.json | Test script |
| `tests/` directory | All test files per DESIGN.md §9 |
| `.github/workflows/ci.yml` | CI pipeline per DESIGN.md §10 |

### Phase 1: New Files

| File | Description |
|------|-------------|
| `.env.example` | Placeholder env vars (if not already present) |
| `TASKS.md` | Implementation task list |

## REQUIREMENTS.md Updates Needed

Based on the "code is source of truth" constraint, REQUIREMENTS.md Card Input Fields section needs these updates:

1. Rename `expires` → `accountAccessory` (or add mapping note)
2. Move `holderFirstName`/`holderLastName` from `accountInfo` to `accountHolder` wrapper
3. Add `accountType` enum values: `DinersClub`, `JCB`, `Checking`, `Savings` (even though ACH is deferred, the enum exists in the code)
4. Update `issueAt`/`issuedAt` — use `issueAt` to match code
5. Update Void record: `status: "Voided"` (not `"Approved"`), amounts mirror original (not zero)
6. Update Refund record: `approvalNumber` is generated (not null)
7. Update Capture record: `status: "Captured"` (not `"Approved"`)
8. Update Transaction status transitions table to match code behavior
