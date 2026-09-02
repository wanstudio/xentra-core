# Xentra-Core — Verification Audit Findings 01–06

**Purpose:** Persistent audit context for Antigravity and future engineering/audit passes.

**Audit mode:** Read-only verification. No source-code changes were made for the findings below.

## Audit methodology

This document records verified conclusions from the candidate audit findings 01–06. It is not a frozen implementation specification. Implementation may evolve when the business/security/data invariants remain satisfied.

For each finding, verify:

- exact current source and call chain;
- database schema/constraints;
- transaction/concurrency behavior;
- authorization/tenant boundaries where relevant;
- applicable Notion business decisions;
- realistic exploit/reproduction path;
- actual impact and confidence.

Do **not** call a behavior vulnerable merely because it differs from a generic best practice. Distinguish vulnerability, logic defect, data-integrity risk, operational risk, hardening, and false positive.

---

## F01 — Promotion redemption ledger is not consumed

**Classification:** CONFIRMED LOGIC DEFECT

**Severity:** HIGH

**Confidence:** HIGH

### Evidence

`PromotionEngineService.evaluate()` reads `promotion_redemptions` to calculate per-customer redemption count. `recordRedemptions()` is implemented in the same service, but the verified audit found no call site in the relevant order/payment completion flows.

### Impact

Promotions that depend on `max_redemptions_per_customer` can remain permanently at zero recorded redemptions. A customer may therefore receive a promotion repeatedly when the business rule intends a limit.

### Important remediation constraint

Do **not** simply call `recordRedemptions()` from multiple paths without an idempotency rule. The redemption operation itself must be protected against duplicate execution, e.g. an authoritative `(promotion_id, order_id)` uniqueness invariant or equivalent business key plus idempotent insert behavior.

### Required business decision

Define the authoritative **redemption consumption point**:

- Cash: determine whether order confirmation/acceptance is the consumption event.
- Online payment: settlement is the likely consumption event.

Do not infer the final rule from implementation alone.

### Recommended design direction

`Eligibility` and `Redemption Consumption` are separate concepts.

`promotion eligible -> promotion applied -> authoritative consumption event -> redemption ledger`

The ledger must be immutable/auditable and duplicate-safe.

---

## F02 — Dynamic reward identifier conflicts with final verification gate

**Classification:** CONFIRMED LOGIC DEFECT

**Severity:** HIGH business impact

**Confidence:** HIGH

### Evidence

The customer PWA can construct a dynamic reward identifier such as `reward_<promotion-id>`, while `PrePaymentVerificationGate` still contains a static zero-price special case for `promo-es-teh-gratis` and otherwise expects the identifier to resolve to a real `products` row.

### Impact

A valid dynamic promotion reward can reach checkout but be rejected as an unavailable product, breaking a legitimate checkout flow.

### Security constraint

Do **not** fix this by accepting every identifier with a `reward_` prefix. A client-supplied reward identifier must not become an authority over reward semantics.

### Recommended design direction

Resolve:

`client reward reference -> authoritative promotion/reward record -> server-derived benefit -> final verification`

The server must determine whether the customer is eligible and what the reward actually means.

---

## F03 — Token/session storage is process-memory only

**Classification:** OPERATIONAL / AVAILABILITY RISK

**Severity:** MEDIUM

**Confidence:** HIGH

### Evidence

`TokenSessionStore` keeps merchant/customer sessions in a JavaScript `Map` in process memory. Restart/recycle of the process removes the sessions.

### Impact

Operator/customer sessions can be lost during deploys, Passenger process recycle, or multi-worker routing. This is a continuity/availability problem, not an authentication bypass by itself.

### Decision status

Treat as an infrastructure/production readiness concern unless production requirements explicitly require session continuity across process restarts/workers.

### Possible implementations

- persistent session table;
- Redis/session store;
- stateless signed tokens where appropriate.

Implementation choice is conditional on topology, operational constraints, and security requirements.

---

## F04 — Deferred transaction vs BEGIN IMMEDIATE

**Classification:** HARDENING OPPORTUNITY

**Severity:** LOW–MEDIUM

**Confidence:** HIGH on code fact; lower on exploitability

### Evidence

Main food-order placement currently uses `BEGIN TRANSACTION`, while reservation uses `BEGIN IMMEDIATE`. Native SQLite is configured with WAL mode and `busy_timeout = 5000`.

### Verified conclusion

The difference is real, but the previous claim that this is automatically a race-condition vulnerability is not established.

`BEGIN TRANSACTION` alone does not prove a production exploit. Actual behavior depends on read/write sequencing, concurrency, runtime topology, busy handling, retries, and workload.

### Guidance

Do not replace all transactions with `BEGIN IMMEDIATE` merely for consistency. Validate with concurrency tests/load evidence first. If an explicit write-reservation policy is later chosen, document the reason and the affected transaction classes.

---

## F05 — Offline POS idempotency relies on order_note substring matching

**Classification:** CONFIRMED DATA-INTEGRITY RISK

**Severity:** MEDIUM / potentially HIGH under offline sync duplication

**Confidence:** HIGH

### Evidence

`OfflineReconciliationService` checks for a previously synchronized transaction using:

`orders.order_note LIKE '%[TX_ID:<client_transaction_id>]%'`

then calls the normal order placement flow if none is found.

### Impact

Two concurrent sync requests can both observe no committed matching order and both create an order for the same offline transaction, duplicating sales/inventory effects.

The deeper defect is that the idempotency identity is stored as free-form text rather than an authoritative database identity/constraint.

### Required business decision

Define the semantic scope of `client_transaction_id`. Possible scopes include:

- globally unique UUID;
- branch + terminal/device + client_transaction_id;
- another explicitly defined device/session scope.

Do not invent the scope from the current code.

### Recommended design direction

Store the idempotency identity in a dedicated column (or equivalent authoritative record) and enforce uniqueness at the database layer where appropriate. The exact unique key depends on the business decision above.

Retries must converge to exactly one authoritative transaction.

---

## F06 — Runtime can fall back to ephemeral memoryStore

**Classification:** OPERATIONAL / PERSISTENCE RISK

**Severity:** HIGH if the fallback can execute in production

**Confidence:** HIGH on code/config mismatch; production impact requires runtime verification

### Evidence

`server/database/db.js` attempts to load `node:sqlite` / `DatabaseSync` and, on failure, falls back to a memory-only store. The committed Passenger configuration points to a Node.js 20 runtime path, while the native `node:sqlite` path used by the implementation requires a newer Node runtime for the normal built-in API.

### Impact

If the configured runtime actually reaches the fallback in production, persisted business data can become process-memory state and disappear on process restart/recycle. For orders, products, inventory, payment and POS this can become catastrophic data loss.

### Important distinction

The repository evidence proves the **unsafe fallback path exists**. It does not, by itself, prove that the production deployment is currently running in that fallback mode.

### Required verification

On the actual target runtime, verify:

```bash
node -v
node -e "require('node:sqlite')"
```

and verify application startup reports that the authoritative persistent database engine is active.

### Recommended design direction

Production should fail fast if the authoritative persistent database cannot initialize. A memory-only fallback may be acceptable for explicitly isolated test/deploy/health contexts, but must not silently serve as the production source of truth.

---

# Priority

## P0 — verify/fix first

1. **F06** — prove actual production/dev runtime and eliminate silent memory-store fallback from production.
2. **F01** — define redemption consumption boundary and implement duplicate-safe redemption recording.
3. **F02** — make reward resolution authoritative on the server instead of static/client-derived reward identity.
4. **F05** — define `client_transaction_id` semantic scope and enforce authoritative idempotency.

## P1 — conditional infrastructure hardening

5. **F03** — persistent/shared session strategy if production topology requires continuity across worker/process lifecycle.
6. **F04** — only change transaction mode if concurrency evidence/requirements justify it.

---

# Antigravity instructions

When using this document:

- Treat these as **verified audit conclusions**, not direct coding commands.
- Before implementation, read the related Notion business contract and current Git implementation.
- Preserve the invariant, not necessarily the current mechanism.
- Re-verify surrounding callers/callees before changing a finding.
- Add regression tests for confirmed logic/data-integrity findings where technically appropriate.
- Do not mark a finding CLOSED merely because a code edit was made; verify that the original exploit/incorrect state is no longer reachable.
- If later evidence contradicts a finding, reclassify it rather than preserving the old severity.

## Core audit principle

**Prove before claim.**

A suspicious pattern is not automatically a vulnerability. A confirmed security finding requires a credible reachable attack path and meaningful impact or a clearly violated protected security invariant.
