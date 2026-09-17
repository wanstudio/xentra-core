# Xentra-Core — Verification Audit Findings 01–06

**Status: LOCKED / AUTHORITATIVE AUDIT BASELINE**  
**Decision date:** 2026-09-17

This document locks the verified audit baseline for Findings 01–06. It records verified classifications and implementation boundaries. It is not a blanket implementation mandate; remediation remains subject to the applicable business/architecture contract.

## F01 — Promotion redemption ledger is not consumed

- Classification: **CONFIRMED LOGIC DEFECT**
- Severity: **HIGH**
- Confidence: **HIGH**
- `PromotionEngineService` contains redemption recording, but the verified audit found no authoritative consumption call in the relevant order/payment completion flows.
- Promotion limits such as `max_redemptions_per_customer` can therefore fail to advance as intended.
- Redemption consumption must have one explicitly defined authoritative business event and be duplicate-safe/idempotent.
- Implementation gate: define the consumption boundary first. Cash and online settlement semantics must not be inferred from code alone.

## F02 — Dynamic reward identifier vs final verification

- Classification: **CONFIRMED LOGIC DEFECT**
- Severity: **HIGH business impact**
- Confidence: **HIGH**
- **RESOLVED in current implementation.** Reward intent is resolved through authoritative promotion/reward data rather than a static reward special-case.
- Client identifiers, including `reward_` prefixes, must never become reward authority.
- Preserve: `client reward reference → authoritative promotion/reward record → server-derived benefit → final verification`.

## F03 — Token/session storage is process-memory only

- Classification: **OPERATIONAL / AVAILABILITY RISK**
- Severity: **MEDIUM**
- Confidence: **HIGH**
- Merchant/customer sessions are held in process memory and may be lost across process restart/recycle or multi-worker topology.
- This is an availability/continuity concern, not by itself an authentication bypass.
- Remediation depends on production topology and explicit session-continuity requirements.

## F04 — Deferred transaction vs BEGIN IMMEDIATE

- Classification: **HARDENING OPPORTUNITY**
- Severity: **LOW–MEDIUM**
- Confidence: **HIGH on code fact; lower on exploitability**
- Main food-order placement uses deferred `BEGIN TRANSACTION`; reservation uses `BEGIN IMMEDIATE`.
- The difference is real, but the audit does not establish an automatic production race vulnerability from this fact alone.
- Do not globally replace transaction mode without concurrency evidence or an explicit transaction policy decision.

## F05 — Offline POS idempotency uses order_note substring matching

- Classification: **CONFIRMED DATA-INTEGRITY RISK**
- Severity: **MEDIUM / potentially HIGH under concurrent offline sync duplication**
- Confidence: **HIGH**
- **STATUS: CODE & TEST VERIFIED (F05 Remediated)**
- Code verification:
  - Eliminated `order_note LIKE '%[TX_ID:...%'` matching as identity authority. Identity is strictly defined by the database column `client_transaction_id` scoped to `(branch_id, client_transaction_id)`.
  - Authoritative database identity enforced via partial unique index: `idx_orders_branch_client_tx ON orders(branch_id, client_transaction_id) WHERE client_transaction_id IS NOT NULL`.
  - Normal online/customer orders with NULL `client_transaction_id` remain valid and unconstrained.
  - Safe migration: Inspects existing duplicate rows per `(branch_id, client_transaction_id)` prior to index creation, reporting violations without destructive data repair.
  - Concurrent duplicate safety: Atomic race condition handling in `OrderPlacementService` and `OfflineReconciliationService` catches database unique constraint conflicts and returns the original authoritative order without duplicate order creation, duplicate stock deduction, duplicate shift cash addition, or duplicate promo redemptions.
  - Branch scope authorization: API endpoints (`/pos/offline-sync` and `/pos/offline-sync/batch`) enforce server-authorized branch context for cashier/branch_manager roles, rejecting client-side branch spoofing.
- Test verification:
  - Dedicated test suite `tests/posOfflineIdempotencyF05.test.js` (10/10 passing): covers repeated requests (F05-01), multi-branch isolation (F05-02), true concurrent sync race condition (F05-03), single stock deduction (F05-04), rollback/retry resilience (F05-05), decoupling from order_note (F05-06), NULL tolerance (F05-07), raw database constraint rejection (F05-08), authoritative order return (F05-09), and branch authorization security (F05-10).
  - Regression verified across `tests/domains/pos.test.js`, `tests/domains/promotion.test.js`, and `tests/core/phase6Payment.test.js`.
- VPS runtime verification: PENDING / SEPARATE GATE (requires deployment verification against VPS cPanel/CloudLinux Passenger topology; VPS runtime verification was not available from this execution environment).

## F06 — Runtime can fall back to ephemeral memoryStore

- Classification: **OPERATIONAL / PERSISTENCE RISK**
- Severity: **HIGH if production reaches fallback**
- Confidence: **HIGH on code/config mismatch; production impact requires runtime verification**
- **STATUS: CODE & TEST VERIFIED (F06 Remediated)**
- Code verification:
  - Eliminated silent replacement of corrupt/unreadable persistent DB with new empty DB in `sql.js` adapter. Explicitly distinguishes missing DB (first-run creation) from corrupt/unreadable existing DB.
  - Corrected `sql.js` transaction persistence semantics: `COMMIT` triggers synchronous disk persistence, while `ROLLBACK` clears transaction state and discards pending saves without writing to disk.
  - Eliminated silent swallowing of disk write failures in `saveSqlJsToDisk()`. Persists synchronously on transaction commit and non-transaction writes, failing fast via `process.exit(1)` in production upon write failure.
  - Ensured native `node:sqlite`, `sql.js`, directory creation, schema migrations, and statement preparation fail closed in production without fallback to `memoryStore`.
  - Enforced `server/app.js` aborts (`process.exit(1)`) on database readiness rejection in production.
- Test verification:
  - Suite: `tests/databaseProductionFailFast.test.js` (14/14 passing).
  - Includes deterministic filesystem failure injection verifying the persistence boundary (`fs.writeFileSync` EIO simulation).
  - Includes F06-SQLJS-07 (COMMIT persists across process restarts) and F06-SQLJS-08 (ROLLBACK does not trigger persistence and leaves disk untouched).
  - Subprocess environments sanitize test-runner lifecycle variables while strictly executing under `NODE_ENV=production`.
  - Local runtime: Node.js `v24.21.0` native `node:sqlite` WAL mode & `sql.js` adapter tested via `XENTRA_FORCE_SQLJS=1`.
- VPS runtime verification: PENDING / SEPARATE GATE (requires deployment verification against VPS cPanel/CloudLinux Passenger topology; VPS runtime verification was not available from this execution environment).

## Locked priority

### P0
1. F06 — verify production runtime/persistent DB and eliminate silent production fallback.
2. F01 — define redemption consumption boundary and implement duplicate-safe consumption.
3. F02 — preserve authoritative reward resolution.
4. F05 — define `client_transaction_id` scope and enforce authoritative idempotency.

### P1
5. F03 — persistent/shared session strategy if topology requires continuity.
6. F04 — transaction-mode hardening only when justified by concurrency evidence or explicit policy.

## Audit boundary

This is a **verified audit lock**, not a blanket coding mandate. Preserve the protected invariant and re-verify callers/callees before implementation. A finding is not CLOSED merely because code changed; closure requires verification that the original incorrect state or reproduction path is no longer reachable.

**Core audit principle: Prove before claim.**
