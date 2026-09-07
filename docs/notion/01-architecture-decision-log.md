<!-- SNAPSHOT FROM NOTION — source page: 01-architecture-decision-log; fetched 2026-09-05 -->

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

## 🔒 LOCKED — Master Catalog vs Branch Catalog Ownership & Snapshot Boundary

### Decision
**Master Catalog dan Branch Catalog adalah dua ownership/context yang berbeda. Catalog milik Owner/Brand berfungsi sebagai master product library. Branch memiliki kewenangan operasional untuk memilih product dari master catalog dan membentuk Branch Catalog sendiri. Branch Catalog bukan live mirror dari Master Catalog.**

### Master Catalog owns
- master product identity dan product library milik Brand;
- master product metadata sesuai contract Catalog;
- daftar product yang dapat dipilih/adopt oleh Branch;
- master catalog lifecycle.

Master Catalog adalah **source/library**, bukan operational selling configuration setiap Branch.

### Branch Catalog owns
- product yang sudah dipilih/adopt oleh Branch;
- category/menu structure milik Branch;
- branch-level availability, stock, dan operational selling configuration sesuai domain contract;
- keputusan category/menu placement di Branch.

**Category Branch adalah kewenangan Branch.** Category pada Branch tidak harus sama dengan category Master Catalog. Branch boleh membuat, rename, atau mengatur category sendiri. Product dari Master Catalog dapat ditempatkan ke category Branch mana pun; Xentra tidak mengoreksi keputusan merchandising Branch hanya karena category tersebut berbeda dari category Master Catalog.

### Adoption / Save Point
Ketika Branch memilih product dari Master Catalog untuk dijual, proses tersebut adalah **adoption/copy ke Branch Catalog**, bukan ketergantungan live yang membuat Branch otomatis mengikuti perubahan Master Catalog.

Conceptual flow:
**Master Catalog → Branch memilih product → Adoption / Save Point → Branch Catalog**

Branch Catalog harus tetap memiliki operational record setelah product di-adopt. Perubahan Master Catalog di kemudian hari tidak boleh secara otomatis menghapus atau menonaktifkan product yang sudah ada di Branch Catalog.

### Master change ≠ automatic Branch mutation
Jika Owner menonaktifkan atau mengubah product pada Master Catalog yang sudah pernah di-adopt oleh Branch:
- Branch Catalog **tidak otomatis dihapus**;
- Branch Catalog **tidak otomatis menjadi disabled hanya karena master berubah**;
- perubahan Master menjadi event/communication yang nantinya dapat diberitahukan kepada Branch;
- penyelesaian transaksi yang sedang berjalan dan keputusan disable pada Branch mengikuti workflow operasional yang akan dikunci kemudian.

Contoh future communication:
**"Owner menonaktifkan product ini mulai hari ini. Selesaikan transaksi jika ada yang sedang berjalan. Jika tidak ada transaksi, silakan nonaktifkan product ini di Branch Settings."**

Workflow komunikasi Owner → Branch ini adalah **future capability** dan belum mengunci schema/rule implementasinya sekarang.

### Database relationship direction
Model konseptual yang dikunci:

```text
Master Catalog (Brand-owned)
        │
        │ product available for adoption
        ▼
Branch Manager
        │
        │ adopt / copy
        ▼
Branch Catalog (Branch-owned)
        ├── Branch Product
        │     ├── stock
        │     ├── availability
        │     ├── branch price/configuration
        │     └── branch operational state
        │
        └── Branch Category
              └── Branch-controlled menu grouping
```

Ini **bukan** model live-reference sederhana:
**Branch → Master Product → Master Category**.

### Category independence
Master Category dan Branch Category tidak boleh diperlakukan sebagai satu identity hanya karena nama/category_id-nya sama.

Contoh valid:
- Master Catalog memiliki category `Makanan`, `Mie`, `Minuman`.
- Branch A boleh memiliki `Menu Favorit`, `Mie`, `Minuman`.
- Branch B boleh memiliki `Paket Hemat`, `Minuman Dingin` dan tidak menjual Mie.
- Branch C bahkan dapat menempatkan product Ayam ke category Branch bernama `Menu Ikan` jika Manager memilih demikian.

Business responsibility berada pada Branch; Xentra menjaga integrity dan contract, bukan mengoreksi merchandising decision yang tidak dilarang oleh business rule.

### Catalog ↔ Branch boundary
Catalog dan Branch tetap domain yang dapat berkolaborasi tetapi tidak saling mengambil authority.
- Catalog menyediakan master product library dan contract adoption.
- Branch memiliki operational context dan kewenangan branch-level selling configuration.
- Branch Catalog menjadi save point untuk product yang sudah di-adopt.
- Home/customer UI harus membaca **Branch Catalog** ketika berada dalam Branch Context, bukan menganggap Master Catalog sebagai live operational catalog Branch.

### Schema implication
Schema saat ini **tidak boleh diasumsikan sudah merepresentasikan keputusan ini sepenuhnya**. `branch_products` yang hanya menyimpan reference ke `products` belum otomatis berarti sudah memiliki snapshot/copy semantics atau Branch-owned category structure.

Karena itu:
- jangan menambahkan schema secara ad-hoc;
- jangan membuat `branch_categories`, `categories.branch_id`, `products.branch_id`, atau `branch_catalog` tanpa kontrak schema yang dikunci;
- perubahan schema berikutnya harus dirancang sebagai keputusan architecture/data-model terpisah sebelum implementasi.

### Invariants
- **Master Catalog mutation must not silently mutate an already-adopted Branch Catalog.**
- **Branch Category is Branch-owned and independent from Master Category.**
- **Product adoption is a save point, not a live dependency for Branch selling configuration.**

> **IMPLEMENTATION NOTE (2026-09-07 — SUPERSEDES snapshot implementation):**
> The "save point = snapshot columns" implementation has been replaced by
> **Master Product Default + Branch Optional Override**.
> - Adoption no longer copies `product_name`/`product_description`/`product_image_url`.
> - Override columns (`name_override`, `description_override`, `image_override`) default to NULL.
> - NULL override = Branch inherits live Master value (propagation).
> - Non-NULL override = Branch value wins via `COALESCE` at query time.
> - Legacy snapshot columns are retained for backward compatibility but are not the resolution path.
> - The business invariant "adoption ≠ live dependency" is preserved: branches explicitly set overrides;
>   master propagation only applies when no override is present.
> - Endpoint: `PATCH /api/v1/admin/branches/:id/products/:productId/override`

- **Branch may choose which master products it sells.**
- **A product can exist in Master Catalog without being sold by a Branch.**
- **Different Branches may sell different subsets of the same Master Catalog.**
- **Different Branches may organize the same product under different Branch Categories.**
- **No global/master catalog fallback is allowed when the UI is presenting an established Branch Catalog context.**

### Scope / future work
This decision locks the ownership and relationship model. It does **not yet** lock the exact physical database schema, versioning fields, synchronization/version policy, conflict resolution, notification transport, or Owner → Branch communication workflow. Those require separate explicit decisions before implementation.
