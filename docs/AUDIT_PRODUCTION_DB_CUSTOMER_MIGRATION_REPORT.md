# Production DB Audit & Legacy Customer Identity Migration Report

**Date**: 2026-09-20  
**Environment**: Production / Active VPS (`wanstudio/xentra-core`)  
**Target Database**: `/home/ubuntu/xentra-core/server/database/xentra.db`  
**Database Backup**: `/home/ubuntu/xentra-core/server/database/xentra.db.backup-legacy-customer-migrate-20260919-203747`  
**Authority Reference**:
- `docs/CUSTOMER_IDENTITY_SCOPE_ORGANIZATION_V1.md`
- `docs/CUSTOMER_IDENTITY_REGISTRATION_CONTRACT.md`

---

## 1. Executive Summary

As part of finalizing the transition to **Organization-scoped Customer Identity**, an exhaustive audit and deterministic migration run was performed on the active production database. 

The audit established that:
1. `customer_id` is the canonical customer identity and ownership anchor.
2. `customer_phone` is strictly contact and fulfillment operational metadata, not identity.
3. No Google Customer accounts existed yet in the production database (`customers` table count was 0).
4. All 705 historical orders had `customer_id IS NULL`, with 514 containing contact phone numbers from historical POS cashier and pre-Google guest checkouts.
5. In accordance with `docs/CUSTOMER_IDENTITY_SCOPE_ORGANIZATION_V1.md`, **synthetic customer accounts were not fabricated**. Historical orders are categorized as `ORPHAN` / `UNMIGRATED_LEGACY` until genuine accounts are registered via Google Identity.
6. A migration script with cross-organization verification and ambiguity checks has been added to `scripts/migrate-legacy-customers.js` with comprehensive automated unit tests.

---

## 2. Production Database Audit Snapshot

Direct read-only inspection of the active SQLite database (`xentra.db`):

| Table / Condition | Count | Description / Classification |
|---|---|---|
| `customers` | **0** | No canonical customer records currently registered in DB |
| `customer_auth_providers` | **0** | No OAuth provider records (Google sub) linked yet |
| `customer_addresses` | **0** | No saved customer addresses in DB |
| `orders` (Total) | **705** | Total orders recorded in system |
| `orders` with `customer_id IS NOT NULL` | **0** | Already canonical orders |
| `orders` with `customer_id IS NULL` | **705** | Legacy unlinked orders |
| `orders` (legacy with valid `customer_phone`) | **514** | Contact phone present across 7 brands (pos_cashier, customer_app) |
| `orders` (legacy without `customer_phone`) | **191** | Legacy walk-in / guest orders without phone |

---

## 3. Migration Classification Breakdown

Evaluation of the 514 legacy phone orders against candidate customer records:

| Classification | Count | Action / Rationale |
|---|---|---|
| **ALREADY_CANONICAL** | **0** | Record already has authoritative `customer_id`. |
| **MIGRATABLE** | **0** | Exactly one canonical customer in the same organization matches the phone number. |
| **MIGRATED** | **0** | Successfully linked to canonical customer identity. |
| **AMBIGUOUS** | **0** | Multiple customer records match the phone or conflict across organizations. No arbitrary selection allowed. |
| **ORPHAN / UNMIGRATED LEGACY** | **514** | Phone number has no matching `customers` row. Kept untouched; never guess or synthesize accounts. |
| **FAILED** | **0** | Database update errors. |
| **CROSS-ORG VIOLATIONS PREVENTED** | **0** | No cross-organization customer linking permitted. |

---

## 4. Fallback Architecture & Security Isolation

- **Authenticated Customers (`customer_id` Present)**:
  - All ownership checks (`/customer/orders`, `/orders/:id`, `/orders/:id/cancel`, `/addresses`) strictly mandate matching `customer_id`.
  - Phone matching is completely disabled for authenticated sessions, preventing account takeover or data leakage via identical phone numbers across different customers.
- **Legacy Guest Compatibility (`customer_id IS NULL`)**:
  - Legacy historical orders (514 rows) retain their phone numbers as immutable fulfillment and contact data.
  - A controlled fallback exists only for unlinked historical guest sessions (`customer_id IS NULL AND customer_phone = ?`).
  - Because 514 historical orders exist without canonical IDs, removing this compatibility completely would render legacy historical records permanently inaccessible to unauthenticated guest tracking.

---

## 5. Verification & Test Suite

The migration utility and authorization boundaries were validated with dedicated test runs:

- **Migration Tooling**: `scripts/migrate-legacy-customers.js`
- **Unit & Integration Tests**: `tests/customerLegacyMigration.test.js`
- **Test Suite Command**:
  ```bash
  NODE_ENV=test node --test \
    tests/customerSessionAuth.test.js \
    tests/customerGoogleAuth.test.js \
    tests/customerAddressAuth.test.js \
    tests/customerOrderAuth.test.js \
    tests/customerLegacyMigration.test.js
  ```
- **Result**: **39 passed**, **0 failed** (duration ~3.0s).

---

## 6. Git Commits & Pushes

1. **Implementation & Tests**:
   - Commit: `57137e1` (`fix(customer): migrate legacy phone ownership to customer id`)
   - Added: `scripts/migrate-legacy-customers.js`, `tests/customerLegacyMigration.test.js`
2. **Audit & Migration Report**:
   - Commit: `docs(audit): add production db audit and legacy customer migration report`
   - Added: `docs/AUDIT_PRODUCTION_DB_CUSTOMER_MIGRATION_REPORT.md`
