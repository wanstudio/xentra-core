<!-- SNAPSHOT FROM NOTION — source page: 01-architecture-decision-log; fetched 2026-09-04 -->

# 🔒 Branch as Operational Truth Boundary

## Context / Decision
Branch adalah **unit operasional dan operational truth boundary Xentra**, bukan semata-mata mekanisme untuk memenuhi order Customer. Branch menghasilkan fakta operasional realtime yang menjadi dasar sistem dan pihak berwenang untuk mengambil keputusan bisnis.

**Branch adalah sumber fakta operasional, bukan ultimate business-policy authority.**

Fakta pada scope operasional Branch dapat mencakup inventory/stok, product availability, fulfillment capability, operating status, operational activity, dan event operasional lainnya. Xentra Core menjaga state, scope, authority, consistency, idempotency, dan auditability atas fakta tersebut.

## Authority Boundary
- **Branch** menjalankan operasional dan menghasilkan/menyampaikan kondisi aktual lapangan.
- **Branch Manager** memiliki operational authority sesuai scope dan permission.
- **Owner/Brand authority** menentukan business policy dan keputusan lintas-branch sesuai hierarchy dan RBAC.
- **Xentra Core** menegakkan scope, permission, state transition, dan integrity; UI/client bukan authority.
- **Xentra-Reporting** mengubah data operasional menjadi reporting/analytics dan business insight; Reporting bukan pengganti operational source of truth.

## Customer Fulfillment Implication
Branch Matching adalah **salah satu consumer** dari operational truth Branch, bukan tujuan utama keberadaan Branch.

## 🔒 LOCKED — Fulfillment Branch Selection: AUTO vs CUSTOMER_SELECTED

**Decision Date:** 2026-09-04

Xentra Core v1 mempertahankan tepat satu `fulfillment_branch_id` per Order. `AUTO` adalah mekanisme authoritative branch resolution ketika transaksi memang tidak memiliki explicit customer selection. `CUSTOMER_SELECTED` adalah explicit customer selection yang tetap harus divalidasi oleh Core. Split fulfillment prohibited.

Buyer location ≠ Delivery destination ≠ Fulfillment Branch. Client-provided branch identifiers are never authoritative by themselves.

## 🔒 LOCKED — Eligibility ≠ Branch Acceptance

**Decision Date:** 2026-09-04

`ELIGIBLE` tidak berarti order otomatis diterima. Flow: `Order Request → Core Eligibility → ELIGIBLE → Branch Acceptance → ACCEPT / REJECT`. Acceptance/rejection adalah state transition yang dapat diaudit dan tidak boleh bypass canonical eligibility.

## 🔒 LOCKED — Home as Dynamic Container & Branch-Aware Composition

Home adalah container/presentation composition. Tidak ada hardcoded Branch count, Branch ID, catalog, fulfillment authority, eligibility, price, inventory, acceptance, authorization, atau business policy di Home.

## 🔒 LOCKED — Home Discovery Is Fast Presentation, Not Fulfillment Resolution

**Decision Date:** 2026-09-04

This decision supersedes any earlier Home wording that requires Home to wait for authoritative ETA/routing or to perform fulfillment resolution.

- Home first-load priority is **speed**.
- Home performs/consumes a **cheap proximity discovery** based on GPS/destination context. Straight-line geographic distance (or another faster equivalent) is acceptable.
- Home does **not** need ETA, road distance, delivery cost, driver availability, full-cart eligibility, stock verification, pricing verification, or Branch Acceptance before initial render.
- Home may show a simple heading such as **“Cabang terdekat dari tempatmu”** and a data-driven Branch array. ETA does not need to be shown on Home.
- Discovery ordering may change after reload or Customer interaction; this is acceptable because Home ordering is presentation/discovery, not transaction authority.
- Actual operational/transaction calculations are performed when Customer proceeds into Checkout and are freshly validated before payment/commitment.
- Home discovery must never be interpreted as a guarantee that the first displayed Branch will be the final fulfillment Branch.

## 🔒 LOCKED — Multi-Branch Cart, Single-Branch Checkout/Order

**Decision Date:** 2026-09-04

The previous shorthand **“1 Cart → 1 Fulfillment Branch”** is superseded by the more precise boundary below:

- **Cart** is a shopping container and may contain items associated with multiple Branches/brands.
- **Checkout** is a transaction scope and contains items from **one fulfillment Branch only**.
- **Order** has exactly **one fulfillment Branch**.
- Customer completes different Branches as separate Checkout/Order processes.
- Multi-Branch fulfillment within one Checkout/Order is prohibited for v1.
- Failure/rejection/timeout/refund of one Branch/order must not block an independent order for another Branch.

Therefore: **Multi-branch Cart is allowed; multi-branch Checkout/Order is not.**

## 🔒 LOCKED — Branch Acceptance Timeout & Recovery

**Decision Date:** 2026-09-04

- Branch acceptance window is a **platform-controlled Xentra policy of 3 minutes**.
- The 3-minute value is **not Owner-configurable and not Branch Manager-configurable**.
- It is intentionally not an application hardcode that tenants can change; it is platform policy controlled by Xentra backend/platform governance.
- `AWAITING_BRANCH_ACCEPTANCE` → `ACCEPTED` when accepted within the window; explicit rejection ends acceptance; no response after 3 minutes means the Branch is not accepted and the current transaction ends for that Branch.
- After rejection/timeout, Customer is offered explicit recovery: Customer may choose another Branch and start a **new Checkout**. There is no silent rematch of the existing transaction.

## 🔒 LOCKED — Paid Order Rejection/Timeout Financial Recovery

If a paid online order is rejected or times out, the order is not transferred to another Branch. It enters financial recovery according to payment state/provider behavior (for example cancel/void/refund where applicable). The Customer may immediately start a new independent order while the prior refund/recovery remains pending.

A pending refund on one Order must not globally lock the Customer or block an unrelated Branch/order.

## 🔒 LOCKED — Customer Cancellation

Follow the adopted GoFood-style principle: Customer cancellation is allowed before Branch acceptance/confirmation; after Branch acceptance, normal Customer cancellation is not allowed. Core enforces cancellation from authoritative Order state. Branch/system rejection, timeout, or payment failure must not be classified as Customer cancellation.
