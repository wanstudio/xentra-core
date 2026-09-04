## [Unreleased] - 2026-09-04
### R10/R11/R12 — Commerce integrity audit (defects fixed)
- **R11 TOCTOU guard**: `OrderStateMachine.transition` now accepts an optional
  `expected_current_status` re-validated INSIDE the transaction. The R7
  customer-cancel endpoint passes `'pending'`, closing a real race: customer
  cancel racing branch ACCEPT could previously cancel an ACCEPTED order
  (machine allowed `confirmed → cancelled` for managers, and the endpoint's
  pre-check ran outside the lock). Loser now fails `[STATE_CHANGED]`, order
  stays ACCEPTED, no audit row. (+2 machine tests)
- **R11 late-settlement guard**: Midtrans settlement previously force-`UPDATE`d
  `orders.status='confirmed'` unconditionally — a settlement arriving after
  branch REJECT/BRANCH_TIMEOUT (or racing the timeout worker) would silently
  revive a terminal order and start fulfillment. Confirmation is now a CAS
  from `'pending'`; when the order already left AWAITING, money is still
  settled but the order is routed to `fulfillment_exception` with a structured
  `[Perlu Refund]` note and ZERO stock/promo side effects (deterministic with
  the timeout worker via BEGIN IMMEDIATE serialization). Gateway
  cancel/deny/expire and the gateway-404 reconciliation path got the same CAS
  so they never overwrite a terminal BRANCH_TIMEOUT/REJECT. (+2 payment tests)
- Audit output: R10 no-silent-rematch scan (clean), R11 race matrix, R12
  contract regression map, and security findings are documented in the task
  report (no other code changes).

### R6/R7 — Acceptance timeout + customer cancellation
- **R6 timeout state**: new terminal `orders.status = 'timeout'` (BRANCH_TIMEOUT),
  valid only from `pending` (AWAITING_BRANCH_ACCEPTANCE). Applied EXCLUSIVELY
  by the new server-authoritative `AcceptanceTimeoutService`
  (`ACCEPTANCE_TIMEOUT_SECONDS = 180` — fixed Xentra platform policy, NOT
  Owner/Branch configurable, no browser timer involvement). A 15s unref'd
  worker runs inside the Core process (alongside the payment reconciliation
  worker); each transition is atomic + idempotent via OrderStateMachine
  (BEGIN IMMEDIATE + CAS + audit), so ACCEPT-vs-TIMEOUT races resolve
  deterministically (first valid transition wins; loser fails cleanly). A
  timed-out order stays on its ORIGINAL transaction/branch — never silently
  transferred or rematched. Settled-payment orders are never auto-timed-out.
- **R7 customer cancellation**: new `POST /orders/:id/cancel`
  (requireCustomerAuth). Customer may cancel ONLY while `pending`;
  ACCEPTED/rejected/timed-out/cancelled orders return
  `CUSTOMER_CANCEL_NOT_ALLOWED` (server-enforced — UI restrictions are
  insufficient). Ownership enforced via the authenticated OTP phone (403
  otherwise); the actor is NEVER client-classified — audit records
  `actor_type='customer'`, the session phone, and a `[CUSTOMER_CANCEL]` note
  so CUSTOMER_CANCEL stays distinct from BRANCH_REJECT, BRANCH_TIMEOUT,
  SYSTEM_CANCEL, and PAYMENT_FAILURE. Settled-payment orders require a refund
  flow (`ORDER_ALREADY_PAID`). Duplicate cancellation is a deterministic no-op
  (no second audit row).
- **Recovery**: branch rejection/timeout/cancellation never rematches,
  transfers, or mutates the old Order — the customer explicitly starts a NEW
  Checkout/Order (existing flows unchanged).
- **Tests**: +4 OrderStateMachine, +3 AcceptanceTimeoutService
  (`tests/services/acceptanceTimeout.test.js`), +6 API (R6 worker sweep +
  ACCEPT-after-timeout rejection; R7 cancel happy path + audit + idempotency,
  cancel-after-ACCEPT block, ownership 403, terminal-state blocks,
  401/ORDER_ALREADY_PAID guards).

### R5 — Branch acceptance lifecycle (Order/Acceptance boundary)
- **Locked mapping (per snapshot + approval)**: `orders.status='pending'` is the
  AWAITING_BRANCH_ACCEPTANCE state; branch ACCEPT → `'confirmed'` (ACCEPTED,
  the existing locked operational acceptance state); branch REJECT → new
  terminal `'rejected'` (REJECTED — distinct from customer cancellation
  `'cancelled'`). TIMEOUT reserved for a separate worker task (not built).
- **New endpoint** `POST /orders/:id/branch-acceptance` (`accept`|`reject`):
  server-authoritative, atomic (OrderStateMachine BEGIN IMMEDIATE + CAS),
  audited (`order_status_logs`: actor role+id, decision, reason, previous/new
  state, timestamp), and idempotent for repeated identical decisions (explicit
  `idempotent:true` no-op, no duplicate audit). Reject requires a `reason`
  (REASON_REQUIRED).
- **Authorization boundary**: `branch_manager` acts only on their assigned
  branch (404 otherwise); `brand_manager`/`owner` act brand-wide; cashier and
  kitchen have no acceptance authority (403). Orders are never silently
  rematched on rejection; ACCEPT after REJECT / REJECT after ACCEPT are invalid
  transitions.
- **Financial integrity**: branch REJECT of an order with a settled payment is
  blocked (`ORDER_ALREADY_PAID`, refund flow first) — mirroring the locked
  cancellation guard; promotion redemptions are voided on `rejected` exactly
  as on `cancelled` so a benefit on an unfulfilled order is released.
- **Tests**: +3 OrderStateMachine (pending→rejected validity/terminality,
  atomic audit, settled-payment guard) and +8 API (accept, idempotency,
  reject+reason+terminality, reason required, cross-branch 404, cashier 403,
  settled-payment block, invalid decision).

### R2/R3 — Branch selection mode + final checkout verification
- **`selection_mode` introduced (R2.1)**: `AUTO | CUSTOMER_SELECTED` — HOW the
  fulfillment branch was chosen, distinct from `fulfillment_branch_id` and
  persisted on `orders.selection_mode` (new column, guarded migration). AUTO =
  Core matches via BranchMatcher from the delivery destination;
  CUSTOMER_SELECTED = the customer's `branch_id` is INPUT, never authority
  (canonical `EligibilityService.evaluateBranch` + gate still validate it).
  Legacy clients sending `branch_id` without a mode are derived as
  CUSTOMER_SELECTED (unchanged behavior).
- **Deterministic mode validation (R2.2–R2.5)**: invalid mode values,
  `AUTO` combined with a supplied `branch_id`, and `CUSTOMER_SELECTED` without
  `branch_id` are rejected `400 INVALID_SELECTION_MODE` before any order side
  effect — a client can never smuggle a branch into AUTO, and AUTO never
  silently rematches a rejected CUSTOMER_SELECTED branch.
- **Fresh authoritative verification confirmed (R3)**: `create-order` still
  runs the full `PrePaymentVerificationGate` (branch existence/ownership/
  active/open, fulfillment capability, product active/assignment/availability,
  stock, quantity, authoritative price, promo, R1 single-branch scope) after
  branch resolution and before Order creation — verification failure always
  prevents the Order (new create-order-level stale-stock regression test).
- **Tests**: +8 API tests (AUTO 201 + persisted mode, CUSTOMER_SELECTED 201 +
  persisted mode, legacy derivation, normalization, invalid value, AUTO+
  branch contradiction, CUSTOMER_SELECTED w/o branch, stale-stock no-Order).

### R1 — Cart/Checkout boundary (multi-branch cart; single-branch checkout & order)
- **Locked decision recorded**: the old “1 cart → 1 branch” shorthand is
  superseded. MULTI-BRANCH CART IS ALLOWED; CHECKOUT IS SINGLE-BRANCH; ORDER IS
  SINGLE-BRANCH. Cart lines now record optional branch provenance; a checkout
  is one branch scope; each scope is ordered independently (failure of one
  scope does not invalidate another).
- **Server canonical guard**: new
  `PrePaymentVerificationGate.assertSingleBranchCheckout(branchId, items)` is
  the single enforcement point at the checkout boundary. `create-order` and
  `checkout/verify` reject any payload that mixes item branch provenance, or
  ships one scope against a different branch, with the deterministic status
  `CHECKOUT_SINGLE_BRANCH_REQUIRED` (400, no order). Items without provenance
  (legacy single-group carts) are untouched.
- **Client cart store** (`store.js`): `addItem(product, qty, branchCtx)` stores
  `branch_id`/`branch_name` provenance; line identity is branch-scoped (the
  same catalog product under two branches stays two lines). New APIs:
  `getCartBranchGroups()`, `getCartItemsForBranch(branchId)`,
  `removeBranchItems(branchId)` — all legacy operations unchanged.
- **Checkout page**: sends per-item `branch_id` provenance to verify/create-
  order, fails fast client-side on a broken multi-branch scope (never silently
  merges/splits/rematches), and after a successful order clears only the
  ordered scope — whole cart when the checkout covered it (legacy behavior) —
  so an independent checkout of another branch scope survives (R1.5).
- **Tests**: `tests/client/cartScope.test.js` (8 — multi-branch representation,
  branch-scoped line identity, grouping, scoped removal, legacy compat) +
  6 API tests (matching-provenance success, mixed-scope rejection, wrong-scope
  rejection, verify-boundary rejection, legacy regression, R1.5 independence).
- **Docs**: `XENTRA_CODING_CONTRACT.md` §6 and
  `XENTRA_CORE_IMPLEMENTATION_PLAN.md` Phase D record the supersession.
  `docs/XENTRA_CART_CHECKOUT_CONTRACT.md` (referenced by the R1 task) is not
  yet in the repository — pending import.

### C4/Checkout alignment — AUTO vs CUSTOMER_SELECTED fulfillment branch
- **Locked decision enforced**: a cart always resolves to exactly ONE fulfillment
  branch via either AUTO (`BranchMatcher`) or an explicit CUSTOMER_SELECTED
  branch. A client-supplied `branch_id` is a PREFERENCE, never authority.
- **CUSTOMER_SELECTED validated through canonical eligibility**: `create-order`
  now validates an explicitly selected branch via the new
  `EligibilityService.evaluateBranch()` (exists/active/open + represented
  fulfillment capability, reusing the same engine as AUTO) before any order
  side effect. Ineligible selected branches are REJECTED (400) with an explicit
  reason — there is NO silent rematch to another branch. Product/assignment/
  stock/pricing remain enforced by the stronger `PrePaymentVerificationGate`.
- **Remote/gift delivery**: delivery routing and radius are computed from the
  fulfillment BRANCH to the delivery DESTINATION; buyer location is not a
  delivery input (verified by test). `order_type` and `order_channel` remain
  separate.
- **Tenant isolation preserved**: cross-brand selection fails closed (404);
  inactive branches rejected at resolution. Order persistence keeps a single
  authoritative `branch_id` (stock deducts against that branch). Reservation
  keeps its dedicated path (no locked branch-open contract).

### C4 — Branch Matching
- **Server-authoritative location validation (C4.3)**: `BranchMatcher` now
  rejects missing, non-finite, or out-of-range customer coordinates with an
  explicit `eligible:false` reason — invalid input never silently matches on
  garbage coordinates or a fabricated fallback location.
- **Deterministic winner (C4.7)**: eligible branches are ranked by shortest
  ROAD distance; ties (and equal straight-line candidates) are broken by
  branch id — the winner no longer depends on database row order.
- **Road distance is the ranking fact (C4.4)**: winner selection uses the
  routed distance, not straight-line proximity; Haversine remains a documented
  candidate pre-filter. Radius classification documented: 1.5x straight-line
  pre-filter + branch-level `max_radius_km` road check are existing
  delivery-policy approximations, unchanged.
- **Top-N routing boundary documented (C4.8)**: only the 3 closest-by-
  Haversine candidates are road-evaluated — classified as a performance
  optimization with bounded correctness (a 4th+ straight-line candidate with a
  much shorter road could differ). Not redesigned; flagged as a reported
  matching-policy gap.
- **Routing never silent (C4.5/C4.11)**: the winning delivery payload now
  discloses `routing_provider` and `routing_estimated`, so an OSRM failure
  falling back to the Haversine estimate can never masquerade as an
  authoritative route; hard routing failures propagate as explicit errors
  instead of fabricated successes.
- **Full-cart matching on the public runtime path (C4.2)**: `POST
  /delivery/match-branch` now accepts an optional `items` array (previously
  silently dropped) and performs canonical full-cart matching — partial-cart
  branches are excluded and a cart no branch can fully satisfy fails closed.
  An explicitly provided non-array `items` is rejected with 400.
- **Read-only guarantee (C4.12)**: regression tests prove matching never
  mutates orders, the inventory ledger, or stock.

### C3 — Branch/Product Eligibility Boundary
- **Review pass — cart-level reason contract**: `EligibilityService.evaluateCart()`
  now returns meaningful top-level `reasons` whenever the cart is ineligible —
  the deterministic blocking codes of the failed item evaluations,
  deduplicated and ordered by first-seen item order (e.g.
  `["INSUFFICIENT_STOCK", "PRODUCT_NOT_ASSIGNED"]`). Item-level reasons remain
  intact per line; `eligible: true` still returns `reasons: []`; branch-level
  failure still surfaces the single branch reason.
- **Review pass — BranchMatcher pre-filter audited**: the candidate-discovery
  SQL predicates (`is_active`, `is_open_override`, `is_delivery_active`) are
  documented as a SAFE OPTIMIZATION semantically identical to
  `EligibilityService._resolveBranch()` checks — never a second eligibility
  policy. Any excluded branch would also be rejected by the canonical engine
  (incl. missing `branch_delivery_settings` row → NULL capability), so
  per-branch `evaluateCart()` can only disagree on item-level facts. Selection
  (nearest/route/fee) remains exclusively in BranchMatcher; regression tests
  prove candidates never surface branch-level reasons.
- **Canonical eligibility engine** (`domains/commerce/services/EligibilityService.js`):
  one deterministic decision layer answering "can this Branch satisfy this
  product / the complete cart?" — `evaluateProduct` and `evaluateCart` with
  fixed evaluation order and stable reason codes
  (`BRANCH_NOT_FOUND/BRANCH_NOT_ACTIVE/BRANCH_CLOSED/`
  `FULFILLMENT_NOT_SUPPORTED/PRODUCT_NOT_FOUND/PRODUCT_INACTIVE/`
  `PRODUCT_NOT_ASSIGNED/PRODUCT_UNAVAILABLE/INSUFFICIENT_STOCK/`
  `INVALID_QUANTITY/INVALID_CART`). Cross-brand/cross-org inputs fail closed
  (`BRANCH_NOT_FOUND`/`PRODUCT_NOT_FOUND`) so tenant existence never leaks.
  The engine only decides eligibility — it never selects a branch, never does
  routing/ETA/delivery pricing, never mutates or reserves stock.
- **BranchMatcher consumes the canonical engine**: the inline per-branch
  stock/assignment re-implementation was removed; delivery candidates are now
  narrowed through `EligibilityService.evaluateCart`. NULL stock is treated as
  0 (matching CatalogService/InventoryStockService/PrePaymentVerificationGate)
  instead of the previous matcher behavior that silently treated unrecorded
  stock as unlimited.
- **Full-cart invariant enforced (no split fulfillment)**: when items are
  provided and NO branch can satisfy the COMPLETE cart, the match now fails
  closed with an explicit reason instead of silently selecting the nearest
  branch that cannot fulfill it (Core v1 = 1 cart → 1 fulfillment branch).
- **Consumer layering documented**: CatalogService remains presentation
  availability (`is_available`), PrePaymentVerificationGate keeps its stronger
  final Pay-time checks (same facts + pricing/promotion), and BranchMatcher
  uses the canonical eligibility result — no duplicate eligibility rule set.
- **Reported gaps (not invented)**: `dine_in`/`reservation` have no capability
  flag in the schema, so the engine does not fabricate or substitute one for
  them; operating hours/schedule remain unimplemented (`is_open_override` is
  the only authoritative open/close fact).

### C2 — Branch Inventory Boundary
- **Atomic guarded stock mutation** (`InventoryStockService.recordMovement`):
  replaced the read→compute→write pattern with a single guarded conditional
  UPDATE (`stock = COALESCE(stock,0) + qty WHERE ... AND COALESCE(stock,0) + qty >= 0`)
  inside `BEGIN IMMEDIATE`, so concurrent mutations can never overwrite each
  other or oversell — matching the pattern order settlement already used.
- **Idempotency (C2.8)**: optional `mutation_id` on inventory mutations,
  enforced by a UNIQUE partial index on `inventory_movements(mutation_id)`;
  replaying the same mutation returns the original result and never
  double-applies (unique-race handled too).
- **DB-level negative-stock guard (C2.6/C2.15)**: `branch_products` triggers
  abort any INSERT/UPDATE that would write `stock < 0`
  (`NEGATIVE_STOCK_REJECTED`), regardless of application path.
- **Branch inventory API** (`GET/PATCH /admin/branches/:id/inventory`):
  branch-scoped read + operational adjustments (`audit_adjustment` ±,
  `waste_spoilage` − only). `purchase_in`/`sale_deduction` stay owned by the
  PO-receipt and order-settlement flows and are refused as manual operations.
  Enforces assignment existence + brand consistency, Branch Manager own-branch
  scope, strict quantity validation, and records actor role in the ledger.

### C1 — Product → Branch Assignment Boundary
- **Explicit assignment API** (`/admin/branches/:id/products`): Owner/Brand
  authority assigns an existing brand product to a branch of the same brand
  (idempotent — repeat assign returns `already_assigned`, PK prevents
  duplicates); list endpoint exposes assignments for Owner/Brand/Branch
  Manager (scoped). Branch Manager toggles operational availability
  (`PATCH .../products/:productId`, own branch only, strict 0|1, audited in
  `branch_operation_logs` with `product_id`).
- **Brand consistency enforced twice**: app-layer (`product.brand_id` must
  equal `branch.brand_id`, else 400 `PRODUCT_BRAND_MISMATCH`) and a DB
  trigger raising `CROSS_BRAND_ASSIGNMENT_REJECTED` on any raw cross-brand
  `branch_products` insert/update. Cross-organization/branch tampering
  rejected by the tenant ownership guard.
- **Assignment ≠ Inventory**: assigning a product creates the assignment row
  WITHOUT fabricating stock (`stock` stays NULL until the Inventory domain
  records it); availability toggles never touch stock.
- **Consumer coherence**: `CatalogService` branch-scoped menus now treat an
  unassigned product as NOT available with zero stock (no synthetic 999);
  brand-wide (pre-branch) master menus are unchanged.

### B1 — Organization → Brand → Branch Operational Boundary
- **Branch operational state is now transitionable & audited**: `PUT
  /admin/branches/:id` accepts the server-authoritative `is_open_override`
  switch (validated strictly as 0|1; invalid transitions → 400) alongside
  `is_active`; every authorized change is snapshotted before mutation and
  recorded append-only in the new `branch_operation_logs` table (what changed,
  which branch, actor id/role, before/after values).
- **Branch-scope enforcement verified for operational writes**: Branch Manager
  may only transition their assigned branch (`FORBIDDEN_BRANCH_SCOPE`
  otherwise); non-manager branch roles and anonymous callers are rejected;
  cross-brand branch-ID tampering is blocked by the tenant ownership guard.
- **Identity boundary hardening**: merchant login now rejects an operator
  record whose `branch_id` references a branch of another brand
  (`BRANCH_TENANT_MISMATCH`) — the org → brand → branch relationship is
  enforced at session creation, not only by the database FK.
- **Admin branch list** now exposes `is_open_override` and capability flags.
- **Reported (not invented — no locked business contract yet)**: schedule-driven
  operating hours and a `dine_in` capability flag remain unimplemented; open
  state is the `is_open_override` master switch consumed by `BranchMatcher` and
  the public branch API (see `docs/DATABASE_SCHEMA.md` drift note).

### PWA Install Incentive — End-to-End State Machine & Server Authority
- **One promotion contract across UI and Pay** (`PrePaymentVerificationGate`):
  the gate no longer rejects rewards based on `display_mode` alone. Install
  requirement is satisfied when `pwa_runtime` reports standalone OR
  `install_state === 'accepted'` — the same context that made the reward
  claimable in the browser tab. Legacy booleans (`is_pwa_installed`) are never
  read; entitlement authority stays in the server DB checks (promo active,
  first order, redemption ledger, brand/branch catalog). Removed the client-side
  "finish in the app" Pay interception.
- **PwaRuntime = single source of truth** (`pwa-runtime.js`): one
  `beforeinstallprompt` capture (in `<head>`), shared `promptInstall()`/
  `markInstalled()`/`getInstallState()`, single `appinstalled` handler that
  broadcasts `xentra:pwa-installed` for checkout/home. Removed competing
  per-page listeners and the dead `deferredPrompt` duplicate.
- **Server-authoritative reward lines**: claim builds the cart line from the
  server payload (`product_id`, `product_name`, `reward_price`, `regular_price`,
  `image_url`) with catalog enrichment in `PromotionEngineService`; no client
  hardcoded prices.
- **Dynamic reward config**: no synthetic reward product fallback in
  `InstallIncentiveStrategy` (no grant when `target_product_id` is unset);
  ledger `benefit_amount` for Rp0 rewards follows the configured catalog price
  (gate + `PaymentGatewayService`) — no hardcoded 5000.
- **Canonical reward identity only**: price-0 / name-\"gratis\" heuristics
  removed from `store.js`/`checkout.js` reward detection (one visual-only
  fallback remains for legacy free lines).
- Docs updated (`02-domain-blueprint.md`, `AUDIT_VERIFICATION_01-06.md` F02,
  `DEPLOYMENT.md`) — Es Teh/401 now described strictly as seed/demo data.

## [2.2.8] - 2026-09-02
### Fixed & Hardened (Troubleshooting Reference)
- **Nested Horizontal Carousel & Momentum Swipe (`checkout.css`, `checkout.js`)**:
  - Diperbaiki konflik `touch-action` pada kartu upsell/rekomendasi: mengembalikan gestur native mobile agar swipe horizontal dan scroll vertikal halaman bekerja bersamaan dengan akselerasi hardware penuh (60/120fps).
  - Menerapkan strict overflow containment (`overflow: hidden; max-width: 100%;`) pada parent wrappers (`#x-items-card`, `.x-complement-section`) untuk mencegah kontainer melebar mengikuti total lebar kartu, yang sebelumnya menyebabkan `clientWidth === scrollWidth` dan memicu efek bouncing elastis.
- **Anti-Blinking Async Re-rendering & Touch Session Preservation (`checkout.js`)**:
  - Menghapus pemanggilan destruktif `renderLayout()` (full `container.innerHTML` wipe) dari callback background async `loadActivePromotions()`.
  - Mengisolasi update banner promo ke dedicated DOM slot (`<div id="x-promo-slot">`) via `renderPromoBanner()`, sehingga DOM tree tidak berkedip dan pointer/touch session yang sedang aktif di swipe tidak terputus (*detached DOM element*).
  - Menambahkan caching key guard (`track.__renderedKey`) di `applyUpsellPool()` agar refresh data katalog tidak menimpa innerHTML dan tidak mereset `scrollLeft` ke 0 saat kartu produk tidak mengalami perubahan ID.
- **Promo Claim & Welcome Banner Reactivity (`checkout.js`)**:
  - Memasang `renderPromoBanner()` ke dalam `Store.subscribe()` pada setiap mutasi kuantitas item keranjang.
  - Memperbaiki bug di mana setelah menu promo dihapus dengan tombol minus (`-`), banner tidak otomatis kembali ke status tombol "Claim" (sebelumnya memerlukan reload halaman manual).
- **Node.js Environment & LiteSpeed Passenger Compatibility (`db.js`, `deploy-core.sh`)**:
- **Checkout Menu Items Symmetrical Spacing (`checkout.css`)**:
  - Memperbaiki jarak antar-item menu keranjang pada Card 2 dengan pola simetris (*item* → *16px space* → *divider line #eee* → *16px space* → *item*).
  - Mengatur `padding: 16px 0` pada `.x-product.x-checkout-item` dengan `padding-top: 0` pada elemen pertama dan `padding-bottom: 0` pada elemen terakhir, mencegah tombol Catatan dan judul menu menempel pada garis pembatas horizontal.
- **Checkout Bottom CTA Spacer Alignment (`checkout.js`, `checkout.css`)**:
  - Menyamakan jarak antara Card 5 (Ringkasan Pembayaran) dengan tepi atas bilah tombol sticky CTA (`Pesan sekarang`) menjadi tepat `10px`, identik dengan jarak vertikal antar kartu di atasnya (`margin: 10px`).
  - Menghapus elemen spacer DOM ekstra dan mengunci `padding-bottom` pada kontainer `.x-checkout-alt2` sebesar `calc(74px + env(safe-area-inset-bottom, 0px) + 10px)` agar jarak scroll konsisten di semua viewport.
- **Promo Reward Item Priority Sorting (`store.js`, `checkout.js`)**:
  - Item hadiah promo (misalnya *Es Teh Gratis*) dikonfigurasi untuk selalu menempati urutan produk pertama (index 0) di list keranjang & halaman checkout (`items.unshift()` dan `getCheckoutItems()` sorting).
  - Memastikan customer yang mengeklaim promo langsung melihat hadiahnya tampil di baris paling atas tanpa harus scroll ke bawah, memberikan konfirmasi visual instan bahwa klaim hadiah berhasil.
- **1:1 Card Visual Hierarchy & Checkout Structure Alignment (`checkout.js`, `checkout.css`)**:
  - Header diselaraskan menjadi `Checkout Bangjo`.
  - Reordering card struktur checkout presisi sesuai visual mockup:
    - **Card 1**: Dynamic Promo Slot (`#x-promo-slot`).
    - **Card 2**: Menu Items & Horizontal Upsell Carousel (`#x-items-card`). Tombol `Catatan` dipindah ke kolom kiri di bawah badge diskon, stepper quantity pill lime terang di kanan bersama thumbnail gambar.
    - **Card 3**: Tipe Pembelian / Fulfillment Card (`#x-card-fulfillment`) dengan ikon kurir, label tipe, slot waktu tebal, tombol pill `Pilih` hijau-lime, dan baris catatan kurir + tombol `Catatan`.
    - **Card 4**: Alamat Pengiriman (`#x-card-address`) dengan header + tombol pill `Pilih`, label alamat, alamat lengkap, dan catatan patokan miring.
    - **Card 5**: Ringkasan Pembayaran & Metode Bayar (`#x-payment-summary-card`) dengan rincian harga/ongkir/diskon, total pembayaran (harga lama dicoret + total aktif besar), 2-grid kolom metode pembayaran (`Tunai (COD)` vs `Online Pay`), dan garansi keamanan Midtrans.
    - **Bottom Bar**: Sticky action bar dengan full-width lime pill button `Pesan sekarang`.

## [2.2.7] - 2026-09-01
### Fixed
- Multi-Tenant Domain & Host Resolution (`tenantResolver.js`):
  - Added full support for `dev.mybangjo.com`, `app.mybangjo.com`, local network IP addresses, and `x-brand-slug: bangjo` header.
  - Added single-tenant fallback to prevent `404 TENANT_NOT_FOUND` on catalog endpoints (`/api/v1/catalog/menu`).
- Customer PWA Catalog Resilience (`home.js` & `api.js`):
  - Injected `x-brand-slug: bangjo` header automatically into all API requests.
  - Implemented offline `localStorage` catalog caching and default catalog fallback so the home screen never fails or displays a red error banner.

## [2.2.6] - 2026-09-01
### Added
- Customer PWA UI Alignment with Locked Notion Decisions:
  - 4 `order_type` support: `delivery` (asap/scheduled), `pickup` (outlet selector), `dine_in` (table number context), and `reservation` (H+1 restriction, date/time/guest count).
  - WhatsApp Customer Session binding (`Store.setCustomerSession`) and automatic `Authorization: Bearer <token>` in `API` client.
  - Realtime Pre-Payment Verification Gate dialog: *"Ada perubahan di pesananmu, cek dulu yuk"* when live prices or stock mutate right before payment.
  - Dedicated endpoint `POST /api/v1/checkout/verify` and graceful pre-payment bypass for pure table reservations.
  - Live Tracking Screen (`order-received.js`) enhanced for 4 order types, payment status badges, and official branch WhatsApp button.
- Version bump to `v2.2.6` for automated PWA cache busting.

## [2.2.4] - 2026-08-30
### Fixed
- OOM fix untuk dev.mybangjo.com: hapus multer/adm-zip dari server (pakai raw + unzip shell saja), tambah SKIP_SYNC guard dan NODE_OPTIONS, npm install di dev tidak wajib — server kembali hidup 404 -> 200.
- deploy-core.sh dan deploy-xentra.sh tetap terpisah: dev HANYA via /wp-json/xentra/v1/deploy (raw), app HANYA via app.mybangjo.com WP receiver.

## [2.2.3] - 2026-08-30
### Added
- Endpoint deploy terpisah untuk dev.mybangjo.com: POST /wp-json/xentra/v1/deploy dan /api/v1/deploy di Node (multer + adm-zip) — dev tidak lagi lewat WP receiver app.mybangjo.com, token X-Deploy-Token sama, extract + touch tmp/restart.txt + npm install.
### Fixed
- Pisah total deploy dev vs app: deploy-core.sh HANYA ke https://dev.mybangjo.com (target=core), deploy-xentra.sh HANYA ke https://app.mybangjo.com — tidak ada copy service-worker lintas domain.
- Tambah multer/adm-zip ke dependencies agar deploy multipart zip 50MB berfungsi tanpa fallback shell.

## [2.2.2] — 2026-08-30

### Banner Promo + PWA Install (cache-bust)

- Cache-bust semua HTML: `PWA_VERSION` `v2_1_3/v2_1_4` → `v2_2_2`, `?v=...` → `?v=2.2.2`, `CACHE_NAME` `bangjo-core-v2xx` → `bangjo-core-v222` — perbaiki "tidak tampak perubahan" karena SW/HTML masih cached v2.1.3.
- Checkout banner abu-abu muda + `iced-tea.png` sudah ada (v2.2.1) — tidak diubah lagi.
- Tombol **Install** di banner checkout sekarang fungsional:
  - Android: pakai `beforeinstallprompt` (`deferredPrompt.prompt()`) → dialog install PWA native.
  - iOS: tampilkan sheet panduan 3 langkah Share → Tambah ke Layar Utama → Tambah.
  - Saat klik **Install**, otomatis tambah item **Es Teh Rp0** (`promo-es-teh-gratis`, `price:0`, `regular_price:5000`, `image_url:/assets/img/iced-tea.png`) ke cart via `Store.addItem`, render ulang list + `calculateTotals` — gratis tetap saat submit (backend validasi `price` dari produk jika ada, tapi untuk promo ini `price:0` ikut `validatedItems`).
  - Sudah terpasang / `appinstalled` juga dapat gratis.

---

## [2.2.1] — 2026-08-30

### Promo Banner — abu-abu muda + asset lokal iced-tea

- Banner checkout `x-alt-promo-banner` dari `background:#1f2428` (dark) → `#ececec` (abu-abu muda) sesuai Image 2 target — headline `color:#111`, sub `syarat & ketentuan berlaku` di bawah headline.
- Layout `display:grid` 3-kolom → `display:flex` (iced-tea kiri `56px`, copy tengah flex, tombol Install kanan) — `gap:12px`, `padding:10px 14px`, `border-radius:14px`, responsive `max-width:380px` `48px`.
- Asset `iced_tea.png` (72x65 PNG 7.5K) → `apps/customer-pwa/assets/img/iced-tea.png`, `checkout.js` `src` dari `https://images.unsplash.com/...` → `/assets/img/iced-tea.png` (`object-fit:contain`, `background:transparent`).
- Tidak ada rewrite/mock/preview HTML — hanya patch CSS/JS existing (`checkout.css`, `checkout.js`) + asset.

---

# Changelog — Xentra Core

## [2.2.0] — 2026-08-30

### 🔵 Checkout Alternative 2 — Wiring ke flow xentra-core existing (no mock)

Checkout `apps/customer-pwa` sekarang replica pixel **Checkout Bangjo** tapi 100%% lewat service existing:

| Aspek | Sebelum | Sesudah |
|-------|---------|---------|
| Ongkir/diskon | `state.deliveryFee/state.discount` hardcode 12000/7000 | `POST /delivery/match-branch` via `BranchMatcher` + `RouteService` (OSRM/Haversine) + `DeliveryCalculator.calculate()` — single source of truth |
| Upsell rail | `fallback-1/2/3 Es Jeruk` statis + try `/catalog/upsell` | `GET /catalog/menu` (reuse catalog service), filter cart, fallback `/catalog/upsell` |
| Submit | `POST /checkout/submit` mock `customer_name/customer_phone` + `product_id` + `price` | `POST /checkout/create-order` kontrak existing `{branch_id, customer:{name,phone}, order_type, fulfillment, delivery/address, items:[{id,quantity,note}], payment_method}` — immutable snapshot, `branch_delivery_settings` + `order_deliveries/order_payments` |
| State | `fulfillment.scheduled` hilang | `scheduled` + `scheduled_slot_start` |
| Empty cart | kosong | seed demo Mie Gurith x5 + Es Teh x1 untuk preview desainer |

Visual: `assets/css/checkout.css` append scoped `.x-checkout-alt2` 278 baris (banner dark Install/es teh, card Mie Gurith 17k→15k + Es Teh, rail Es Jeruk, card delivery/pickup, alamat Rumah Gw, ringkasan strike 42k→35k, COD/Online, trust midtrans, sticky Pesan sekarang).

### 🟢 Backend & Test Fixes

| Fix | File | Sebab |
|-----|------|-------|
| `order_items.item_note → note` | `server/routes/api.js` | schema kolom `note`, sebelumnya 500 |
| `products.slug` NOT NULL | `server/database/syncWoo.js` | live sync Woo tanpa slug |
| `DeliveryCalculator` ineligible return `free_km/price_per_km/discount_label` | `server/services/DeliveryCalculator.js` | `order_deliveries.rate_per_km_applied` jadi null → SQLite param 9 error |
| branch seed balik `Surabaya Barat -7.2912,112.7154` | `server/database/db.js` | test payload dekat branch, Pringsewu bikin out-of-radius |
| `orders.customer_name` fixture | `tests/orderStateMachine.test.js` | NOT NULL constraint |
| `NODE_ENV=test` isolasi DB per pid + skip `syncWoo` + guard `app.listen` | `server/database/db.js`, `server/app.js` | WAL `database is locked` saat `node --test` parallel |

Tests: `13/13 pass` (`deliveryCalculator 4 + orderStateMachine 2 + apiEndpoints 7`). Midtrans sandbox error `Access denied` expected (dummy key) → fallback `sim_snap_*`, order tetap 201.

### Ops

- `package.json` `2.0.0 → 2.2.0`, `server/app.js` `/health` version `2.2.0`
- `.gitignore` tambah `*.db` (xentra.db runtime tidak ikut deploy)
- Deploy: `deploy-core.sh` `target=core` ke `/home/mybangjo/xentra-core` via `app.mybangjo.com/wp-json/xentra/v1/deploy`

---

## [2.1.0] — 2026-08-30

### 🔴 Database Schema Fixes (BREAKING — DB direset)

File SQLite `xentra.db` sudah dihapus dan akan di-recreate otomatis saat
server di-start ulang. Semua data lama (orders, products, dll) akan di-seed
ulang dari `seedData()`.

| Sebelum (schema lama)      | Sesudah (match kode)        | File yang diperbaiki |
|----------------------------|-----------------------------|----------------------|
| `delivery_orders`          | `order_deliveries`          | `db.js` schema       |
| `payments`                 | `order_payments`            | `db.js` schema       |
| `order_status_audit`       | `order_status_logs`         | `db.js` schema       |
| `branch_settings` (di kode)| `branch_delivery_settings`  | `api.js`, `BranchMatcher.js` |

**Kolom yang juga diseragamkan:**
- `order_deliveries`: tambah `destination_address`, `destination_latitude`,
  `actual_road_distance_meters`, `chargeable_distance_km`, dll
- `order_payments`: tambah `merchant_id`, `snap_token`, `payment_status`,
  `raw_webhook_response`, `settled_at`
- `order_status_logs`: `from_status`→`previous_status`, `to_status`→`new_status`,
  `changed_by`→`actor_type`+`actor_id`
- `branch_delivery_settings`: `max_delivery_radius_km`→`max_radius_km`,
  `delivery_enabled`→`is_delivery_active`, `promo_config`→`promo_delivery_discount`+`promo_min_order`

**Tabel baru ditambahkan ke schema:**
- `product_categories` (junction table untuk relasi produk-kategori multi)

### 🟠 Brand ID Consistency

| Komponen          | Lama                   | Baru            |
|-------------------|------------------------|-----------------|
| `tenantResolver`  | `brand_bangjo_master`  | `brand_bangjo`  |
| `memoryStore`     | `brand_bangjo_master`  | `brand_bangjo`  |
| `seedData()`      | `brand_bangjo` (sudah) | `brand_bangjo`  |

### 🟡 Redundant Files Cleanup

File berikut dipindahkan ke `assets/js/_deprecated/` (tidak dihapus, bisa
di-recover):

| File Lama                    | Alasan                                    |
|------------------------------|-------------------------------------------|
| `assets/js/app.js` (568 ln)  | Duplikat `pages/home.js` versi lama       |
| `assets/js/checkout.js` (173KB)| Copy paste dari WP production plugin    |
| `assets/js/home.js` (1317 ln) | Campuran XentraNav + WP production logic |
| `assets/js/store.js` (168 ln) | Duplikat `core/store.js`, localStorage key beda |
| `sw.js`                       | Identik dengan `service-worker.js`       |

### File Canonical (yang dipakai)

```
assets/js/
├── core/
│   ├── api.js       ← API wrapper
│   ├── nav.js       ← XentraNav back-button handler
│   ├── router.js    ← SPA hash-based router
│   ├── store.js     ← CANONICAL store (localStorage key: xentra_v2_*)
│   └── ui.js        ← Utility helpers (money, escape)
├── pages/
│   ├── home.js      ← CANONICAL home controller
│   ├── checkout.js  ← CANONICAL checkout controller
│   └── order-received.js
├── dashboard.js     ← Merchant dashboard
├── location.js      ← Location helper
└── _deprecated/     ← File lama (safe to delete after verification)
```

---

## Cara Revert

Jika terjadi masalah, gunakan salah satu cara berikut:

### Revert commit saja (buat commit baru yang membatalkan):
```bash
cd xentra-core
git revert HEAD
```

### Hard reset ke save point (buang commit v2.1.0 sepenuhnya):
```bash
cd xentra-core
git reset --hard aafe903
```

### Git log untuk referensi:
```
12f724e (HEAD) v2.1.0: Audit cleanup
aafe903          SAVE POINT: sebelum audit cleanup
efc6f23          Initialize Xentra Core v2.0.0
```

---

## Known Issues (belum diperbaiki di v2.1.0)

1. **Upsell endpoint hardcoded** — `/catalog/upsell` masih return array statis,
   belum query DB
2. **Addresses hanya di memory** — belum ada tabel `addresses` di schema,
   data hilang saat server restart
3. **Auth login password** — masih pakai plaintext comparison + backdoor
   `bangjo123`
4. **`syncWoo.js` price normalization** — logika `price >= 100000 ? price/100`
   bisa salah untuk produk yang memang harganya di atas Rp 100.000
