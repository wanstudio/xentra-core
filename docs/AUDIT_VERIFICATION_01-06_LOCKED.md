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
- Offline reconciliation currently identifies prior synchronization using `orders.order_note LIKE '%[TX_ID:<client_transaction_id>]%'` before normal order placement.
- Concurrent retries can potentially both observe no committed match and create duplicate transactions.
- Implementation gate: define the semantic scope of `client_transaction_id` first, then store/enforce it as an authoritative database identity/constraint.

## F06 — Runtime can fall back to ephemeral memoryStore

- Classification: **OPERATIONAL / PERSISTENCE RISK**
- Severity: **HIGH if production reaches fallback**
- Confidence: **HIGH on code/config mismatch; production impact requires runtime verification**
- **STATUS: CLOSED (Verified)**
- Runtime verified: Node.js `v24.21.0` with built-in native `node:sqlite` in WAL mode (`PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`).
- Fail-fast enforcement:
  - In `NODE_ENV=production`, any failure in directory creation, persistent database file initialization (`DatabaseSync` / `sql.js`), schema initialization (`initSchema`), or statement execution (`prepare` / `exec`) fails fast via `process.exit(1)` / throwing fatal errors, strictly prohibiting silent fallback to ephemeral `memoryStore`.
  - In `server/app.js`, HTTP server startup strictly aborts (`process.exit(1)`) if database readiness promise rejects in production.
- Test environments (`NODE_ENV=test`) retain isolated in-memory execution.
- Regression suite: `tests/databaseProductionFailFast.test.js`.

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
