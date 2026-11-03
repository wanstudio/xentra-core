# Xentra Agent Guide

This repository uses small, task-focused agent skills rather than one giant instruction file.

## Repository facts

- **Single-process Express monolith** — CommonJS (`require`), not ESM. One `package.json`, no workspaces.
- **Entry point**: root `app.js` re-exports `server/app.js` (Passenger-compatible). `server/app.js` is the real Express app.
- **Database**: SQLite via `node:sqlite` (Node 22+) or `sql.js` fallback (Node 20). Tests always use in-memory `:memory:`.
- **Frontend**: Plain HTML/JS/CSS in `apps/` served as static files — no build step, no framework, no bundler.
- **Node requirement**: `>=20.20.2` (see `package.json` engines).
- **Runtime topology**: Xentra Core is deployed to Xentra-controlled infrastructure. `xentra.cloud` is the SaaS Control Plane/Admin surface. Client domains are tenant/brand entry points provisioned through Xentra Domain Management; they are not hardcoded production identities and do not imply a dedicated physical server.

## Commands

```bash
npm test                                   # Full test suite (3000+ tests) — JANGAN dijalankan berulang kali!
node --test tests/<targeted>.test.js       # Targeted test cepat (hanya untuk file relevan)
npm start                                  # node server/app.js on port 3000
```

Tests use Node's built-in test runner (`node --test`) with `--test-concurrency=1`. Pattern: `tests/*.test.js tests/**/*.test.js`. There is no ESLint, Prettier, TypeScript, or other static analysis.

## Test Execution Discipline (Strict Rule)

- **DILARANG KERAS** menjalankan `npm test` (full suite) berulang-ulang setiap saat atau setelah perubahan kecil.
- **Jangan jalankan test jika hanya perubahan styling, CSS, layout visual, atau teks label minor** yang tidak mengubah logika bisnis atau API.
- **Gunakan Targeted Test**: Jika memang harus memvalidasi regresi logika atau kontrak, **hanya jalankan file test yang relevan**:
  ```bash
  node --test tests/<spesifik-test>.test.js
  ```
- **Frekuensi Minim**: Uji coba hanya dilakukan di akhir pekerjaan saat fitur/perbaikan benar-benar sudah siap, bukan di setiap langkah debugging.

## Before coding

1. Read the relevant Xentra Notion decisions/requirements.
2. If `docs/notion/` contains a snapshot relevant to the task, read it (see `docs/notion/README.md`). It is a pinned copy of Notion — ask the user when a decision may have changed since the snapshot.
3. Read every `.agent/skills/*/SKILL.md` relevant to the requested change; do not load unrelated skills unnecessarily.
4. Inspect current Git status, recent commits, and affected files.
5. Identify the domain owner, locked invariants, and existing implementation boundary.
6. Do not write or modify code until the required context is understood.
7. For mobile UI/CSS tasks, strictly adhere to `docs/decisions/MOBILE_LAYOUT_SYSTEM_CONTRACT.md`:
   - **Screen Archetype A (With Primary Bottom Nav)**: Only `.x-tab-content.active::after` provides bottom clearance (`var(--m-bottom-spacer)`). Inner screens (`.x-home-screen`, `.bm-orders-mobile-cards`) must have `padding-bottom: 0 !important;` and `:last-child { margin-bottom: 0 !important; }`.
   - **Screen Archetype B (With Floating Action Dock/CTA)**: Suppress `active::after` (`display: none !important; height: 0 !important;`). The card list container MUST have explicit `padding-bottom: calc(88px + env(...)) !important;` so cards are never covered by the bottom action dock. Cards must have `margin-bottom: 0 !important;`.
   - Guarded by `node --test tests/merchantLayoutContract.test.js`.

## Authority

- Notion = authority for business rules, locked decisions, invariants, and architecture boundaries.
- Git = evidence of current implementation and history; never invent business rules from code alone.
- UI/client state is never domain authority.

## Architecture layout

```
server/          Express app, routes, middleware, services, database
 domains/        Domain logic (commerce, delivery, inventory, payment, pos, promotion, reporting, affiliate, banner)
core/            Platform foundations (events, identity/RBAC, config, integration, audit)
apps/            Static frontends (customer-pwa, merchant-dashboard, merchant-app, merchant-shared, kitchen-app)
tests/           Node built-in test runner — mirrors domains/, core/, services/, client/
tools/           Developer and administrative utility scripts (seed-demo, bootstrap, reset-admin)
docs/notion/     Pinned Notion decision snapshots
```

Key domain boundaries: Organization → Brand → Branch. Payment credentials resolve hierarchically (Branch → Brand → Organization). Delivery formula is a single source of truth in `server/services/DeliveryCalculator.js`. Order state machine lives in `server/services/OrderStateMachine.js`.

## Skills

- `.agent/skills/xentra-context/SKILL.md` — repository context, source hierarchy, and decision discipline.
- `.agent/skills/xentra-business-logic/SKILL.md` — domain boundaries, state/lifecycle reasoning, and business invariants.
- `.agent/skills/xentra-coding-workflow/SKILL.md` — normal feature/refactor/bug-fix implementation workflow.
- `.agent/skills/xentra-yagni/SKILL.md` — YAGNI, reuse, dependency, and minimal-change discipline; prevents speculative architecture.
- `.agent/skills/xentra-ponytail-review/SKILL.md` — change-level review for unnecessary complexity, duplication, and speculative abstraction.
- `.agent/skills/xentra-ponytail-audit/SKILL.md` — repository-level audit for accumulated over-engineering and architecture drift.
- `.agent/skills/xentra-ponytail-debt/SKILL.md` — deliberate technical-debt tracking and cleanup discipline.
- `.agent/skills/xentra-backend-engineering/SKILL.md` — Node/Express backend boundaries, API contracts, authority, transactions, and idempotency.
- `.agent/skills/xentra-frontend-engineering/SKILL.md` — PWA/dashboard/workspace UI, reusable components, state, runtime wiring, and navigation. Follows `docs/decisions/FIGMA_TO_PRODUCTION_UI_TRANSLATION_RULES.md` for translating raw Figma/Tailwind UI snippets into production code.
- `.agent/skills/xentra-integration-engineering/SKILL.md` — gateways, webhooks, POS sync, delivery, hardware, and event integrations.
- `.agent/skills/xentra-database/SKILL.md` — database integrity, concurrency, transactions, inventory, and financial persistence.
- `.agent/skills/xentra-debugging/SKILL.md` — root-cause debugging and runtime investigation.
- `.agent/skills/xentra-security-audit/SKILL.md` — security and integrity audit when the task is security-sensitive or requires verification.

## Product surface / feature boundary

- `merchant-dashboard` is the Owner / Brand control surface.
- `merchant-app` is the Branch Manager operational surface.
- Kitchen does not require a separate UI surface in MVP; physical printing is the default workflow.
- `kitchen-display` is a held/future KDS add-on surface. It must not become a mandatory login/device or duplicate order state machine.
- Future KDS activation must be controlled by SaaS feature entitlement while reusing Core RBAC, scope, persistence, audit, and order-state authority.

## Domain / tenant / client-domain rules

- `xentra.cloud` is the Xentra SaaS Control Plane/Admin surface.
- Client domains are first-class tenant/brand entry points managed by the Control Plane Domain Management flow.
- The Domain Registry/managed domain configuration is authoritative for domain → tenant/brand association.
- Adding a client domain must not require application-source changes.
- Client-specific domains must not be hardcoded as application routing logic or special-case tenant fallbacks.
- Infrastructure-level domain entries may exist as generated provisioning state, but must originate from Domain Management rather than hand-maintained client exceptions.
- `tenantResolver` must resolve from authoritative domain configuration and authenticated context and fail closed for unknown domains.
- Do not accept tenant identity from an untrusted query parameter or arbitrary client-controlled header for protected operations.
- Do not introduce `app.mybangjo.com` (or another client domain) as a permanent production special case.
- The historical Bangjo shared-hosting mirror deployment is legacy and is not the target runtime topology.
- `biz.xentra.cloud` is the designated Xentra Business Portal entry point for Owner/Merchant experiences and is Xentra-branded by default.
- Platform branding and tenant branding are separate concepts: Xentra is the platform default; tenant branding is an override resolved from authoritative tenant/brand context.
- White-label is a tenant branding mode, not a separate application architecture or tenant identity.
- VIP/dedicated infrastructure does not create a separate tenant or identity. A dedicated client such as Bangjo remains a normal Xentra tenant logically.
- Normal tenant branding is centrally resolved from the authoritative tenant/brand context; do not create independent per-app tenant branding systems.
- Customer PWA keeps the existing Brand Logo + `primary_color` behavior.
- Merchant/Owner PWA and POS PWA may have optional installed-app icon/logo overrides solely for launcher identity; these overrides do not create separate brands and must not propagate Customer PWA `primary_color` into Merchant/POS UI.
- Client domains remain direct tenant entry points. Never route `m.mybangjo.com`, `pos.mybangjo.com`, or another client domain through `biz.xentra.cloud` merely to apply branding.

## Skills selection

Use the smallest relevant skill set. Combine skills when a change crosses boundaries; for example, a payment feature normally needs coding workflow + backend + database + integration context. Use Ponytail review when a change adds abstraction or refactoring, Ponytail audit for repository-wide complexity review, and Ponytail debt when accepting a deliberate temporary shortcut.

## Execution discipline

- Preserve existing domain boundaries and locked contracts.
- Follow YAGNI/minimal-change discipline: do not add speculative abstractions, dependencies, duplication, or unrelated refactors.
- Prefer existing ownership and contracts before creating parallel services/components/utilities.
- When a requirement genuinely crosses boundaries, introduce the smallest stable abstraction that satisfies it.
- Before finishing, verify affected business logic, domain boundaries, runtime wiring, and callers remain coherent.

## Anti-shortcutting & End-to-End Integration Discipline

Never take lazy shortcuts or leave half-baked wiring. When adding or updating user-facing capabilities across any surface (POS, Dashboard, Merchant App, Customer PWA):

1. **Check Existing Platform Engines & Shared UI First**:
   - Xentra already has standard platform engines (e.g., Media Engine in `core/media/` and interactive UI primitives in `apps/merchant-shared/`).
   - If an entity upload is required, **always** inspect and reuse `XentraCropEditor` (`window.XentraCropEditor`), the interactive crop modal `#modal-crop-editor`, and standard 1:1 framing before touching backend storage. Never write a raw file-to-API bypass that skips canonical user interactions.
2. **Verify Full 3-Layer Delivery (Not Just Unit Tests)**:
   - **Layer 1 (Contract & Engine)**: Use repository domain services (`MediaService`, etc.).
   - **Layer 2 (Runtime Routing)**: Verify exact Express route mounting in `server/app.js` and ensure all client calling patterns (e.g., `/api/v1/auth/...` vs direct `/auth/...`) are covered without returning 404s.
   - **Layer 3 (Surface DOM & Script Wiring)**: Ensure target surfaces (`index.html`, stylesheet, DOM modal elements, and scripts) have the necessary markup and script tags loaded. A feature is broken if the backend works in tests but the frontend DOM is missing.
3. **Never Confuse YAGNI With Incomplete Work**:
   - YAGNI means avoiding speculative architecture and unneeded dependencies; it does **not** mean taking shortcuts that deliver broken UX, bypassing existing platform engines, or leaving unmounted routes.

## UI-to-Backend Full-Stack Standpoint (Absolute Invariant)

Whenever a user provides a UI design snippet (Tailwind, HTML, Figma mockup, or React view), **DO NOT TREAT IT AS JUST ISOLATED UI/STYLING**. A UI snippet is an architectural contract of intent. The agent **MUST** automatically deduce, implement, and verify the full underlying system architecture as defined in [docs/XENTRA_UI_TO_BACKEND_EXECUTION_STANDPOINT.md](docs/XENTRA_UI_TO_BACKEND_EXECUTION_STANDPOINT.md):

1. **System Flow & Deep Link Navigation**: Define canonical route patterns (`:id/edit`), parameter extraction, and parent stack restoration.
2. **Database Invariants & Atomic Projections**: Update all related entities (master records AND valuation/stock balance records) atomically in a single transaction.
3. **Mandatory 5-Endpoint CRUD Suite**: List (`GET`), Detail (`GET /:id`), Create (`POST`), Update (`PUT /:id`), and Status Toggle (`PUT/PATCH /:id/status` or `DELETE`).
4. **Service Worker & Cache Proxy Boundary**: Explicitly bypass mutations in `apps/owner-app/sw.js` under `network-only` and set `Cache-Control: no-store` on dynamic admin endpoints.
5. **Client-Side State Synchronization (0ms UX)**: Pair optimistic UI state updates with authoritative background re-fetch and screen resume event listeners.
6. **Automated Verification**: Never consider a UI change done without passing end-to-end targeted unit and integration tests.

## Currency & Number Formatting Rule (Absolute Invariant)

- **Indonesian Rupiah Display Standard**: Semua representasi mata uang Rupiah dan angka kuantitas/harga di seluruh surface (Customer PWA, Merchant App, Merchant Dashboard, POS, Driver App) **WAJIB** menggunakan tanda titik (`.`) sebagai pemisah ribuan, jutaan, dan seterusnya (`Rp 1.000`, `Rp 25.000`, `Rp 1.500.000`).
- **Dilarang Keras**: Menampilkan nominal mentah tanpa pemisah (`Rp25000`), pemisah koma khas US (`Rp25,000`), atau desimal sen yang tidak relevan (`Rp25.000,00`).
- **Currency Input Fields Invariant (Mobile Keypad & Auto-Dot Masking)**:
  - Setiap input field nominal uang di seluruh antarmuka (mobile & desktop) **WAJIB** langsung memanggil keyboard angka murni (numpad/dialpad) di perangkat HP:
    ```html
    <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" ...>
    ```
  - Input uang **WAJIB** memformat titik pemisah ribuan secara otomatis dan real-time saat diketik (`Auto-Dot Formatting`), mendukung penghapusan backspace yang mulus, dan mempertahankan posisi kursor (tidak melompat ke ujung kanan).
  - Gunakan canonical helper platform:
    - Display: `formatMoney(val)` / `window.XentraShared.formatMoney` / `window.Xentra.UI.money`
    - Input Binding: `window.XentraShared.setupCurrencyInputAutoDot(inputEl, onChange)` / `formatNumber(val)`.

## Mobile Page Bottom Action Bar & Bottom Sheet Lifecycle Standard (Absolute Invariant)

Every mobile/web page in Xentra (especially Owner Mobile `apps/owner-app`, `apps/merchant-dashboard`, and React bundles in `packages/menu-editor-ui`) may own its own fixed bottom action bar or modal bottom sheets for executing page-specific endpoints. To prevent overlapping bottom bars (`createPortal` stacking) and orphaned bottom sheets on route transitions or Back navigation, all AI agents MUST obey these 4 invariants:

1. **Single-Active-Page Root Guarantee (`packages/menu-editor-ui/src/main.jsx`)**:
   - All React page mounts MUST be tracked in an iterable `Map` (`roots`) rather than an un-iterable `WeakMap`.
   - Mounting any page (`mount*Page`, `mountMenuEditor`, `mountBusinessHub`, `mountCatalogSubHub`) MUST call `unmountOtherPageRoots(activeContainer)` first, and global route transitions MUST call `window.unmountAllModernPages()`.
   - **FORBIDDEN**: Hiding a React mount container using only `element.style.display = 'none'` without calling `root.unmount()`. Because fixed bottom bars and modals use `createPortal(..., document.body)`, hiding the mount div leaves portaled bottom bars alive and stacked on `document.body`.
2. **Route-Level Cleanup (`dashboard.js` & feature modules)**:
   - Every route change in `applyRoute(route)` MUST close all active presentation overlays (`window.XentraPresentation.closeAll()`, `window.XentraUI.Modal.closeAll()`) and unmount inactive modern React page roots (`window.unmountAllModernPages()`) before mounting the target route.
   - Whenever a module switches sub-views (e.g., `showCategoryEditorSection`, `showMasterCategoriesPage`, `showOwnerMasterMenuEditor`, `showProductListSection`, `showProductDetailSection`, `showProductEditorSection`), it MUST explicitly unmount sibling React containers.
3. **Hardware / Browser Back (`popstate` & `hashchange`) Must Destroy/Close Active Sheets & Modals**:
   - `window.XentraPresentation` (`apps/merchant-shared/js/presentation-shells.js`) and `window.XentraUI.Modal` (`apps/merchant-shared/js/sheet-modal.js`) MUST listen to `popstate` and expose `closeAll()` so pressing Back immediately destroys open bottom sheets/dialogs from `#x-presentation-root` / `document.body`.
   - Any React page component that renders portaled modals or bottom sheets (`PickItemSheet`, `AturItemModal`, `showDeleteModal`, `showAddSheet`, etc.) MUST register `popstate` and `hashchange` cleanup listeners to close its open state on Back navigation, and `OwnerAppShell` MUST sync routes on both `hashchange` and `popstate`.
4. **Bundle Rebuild & Regression Verification**:
   - Any change to `packages/menu-editor-ui/src/**` MUST be followed by `cd packages/menu-editor-ui && npm run build` so `apps/owner-app/assets/bundles/menu-editor.js` is updated.
   - Verify compliance with `node --test tests/ownerBottomBarLifecycle.test.js`.

## Smooth Page Transition & Anti-Flicker Standard (Absolute Invariant)

All Xentra surfaces (Owner Mobile `apps/owner-app`, Merchant App `apps/merchant-app`, Merchant Dashboard `apps/merchant-dashboard`, POS `apps/pos-web`, Customer PWA `apps/customer-pwa`, and future refactored apps) MUST provide native-grade, flicker-free page transitions and obey these 8 invariants:

1. **No Native WebView Top Progress Bar Flicker (`native/*-android`)**:
   - In Android WebView shells (`native/owner-android`, `native/merchant-android`, `native/pos-android`), `ProgressBar` (`@+id/progressBar` above the topbar) MUST remain permanently hidden (`View.GONE`, `0dp`, `alpha="0"`) AND have all tints set to `@android:color/transparent` (`Color.TRANSPARENT`).
   - **FORBIDDEN**: Calling `progressBar.setVisibility(View.VISIBLE)` inside `WebViewClient.onPageStarted` or `WebChromeClient.onProgressChanged`.
2. **Static Icon & Image HTTP Caching (`_smartStaticHeaders` in `server/app.js`)**:
   - Static asset mounts (`/owner/assets`, `/dashboard/assets`, `/merchant-shared`, `/merchant/assets`, `/pos/assets`, `/driver/assets`, `/belanja/assets`) MUST use `_smartStaticHeaders` so `.svg`, `.png`, `.webp`, `.ico`, and `.woff2` files are cached (`Cache-Control: public, max-age=86400, stale-while-revalidate=604800`) while `.js` and `.css` remain `no-cache, no-store, must-revalidate`.
   - **FORBIDDEN**: Serving `/owner/assets/icons/*.svg` with `Cache-Control: no-store`. Forcing the browser/WebView to re-download SVG icons on every React page mount causes both icon pop-in flicker and Chromium `WebChromeClient.onProgressChanged` (the green progress bar flicker) on every route transition!
3. **Synchronous React 18 Commit on Route Mount/Unmount (`flushSync` in `packages/menu-editor-ui/src/main.jsx`)**:
   - Because the host router (`applyRoute` in `dashboard.js`) switches `.x-tab-content.active` synchronously, all React 18 `root.render(...)` and `root.unmount()` calls in `main.jsx` MUST be wrapped in `flushSync` from `'react-dom'`.
   - **FORBIDDEN**: Calling `root.render(...)` asynchronously during synchronous tab switching, which leaves the active container blank for 1–2 frames before React commits.
4. **Synchronous Prop-to-State Derivation & Cache Hydration in React Pages**:
   - When a component syncs state from a prop (such as `initialSubHub` in `BusinessHub.jsx`), it MUST update state synchronously during render (`if (initialSubHub !== prevInitialSubHub) { ... }`), NEVER inside `useEffect` (which paints the stale view for 1 frame and then re-renders).
   - Page components (`CategoriesPage`, `CategoryDetailPage`, `CategorySortPage`, `CategoryMenuSortPage`, `CategoryEditorPage`, `ItemMasterPage`) MUST hydrate their initial `useState(() => ...)` synchronously from `window.state` / `window._ownerMasterMenuState` so cached pages render immediately on Frame 0 without flashing `animate-pulse` skeletons.
5. **History-State Navigation Over Raw `window.location.hash` / `history.back()`**:
   - Internal route transitions and programmatic Back (`XentraNavigationController.back()`) MUST use `history.pushState` / `history.replaceState` + synchronous `renderRoute()` rather than `window.location.hash = ...` or `window.history.back()`, which trigger asynchronous browser traversal and WebView load-progress bars.
6. **Zero Transform & Zero Competing Animation on Outer `.x-tab-content` Sections**:
   - Outer `<section class="x-tab-content">` containers MUST have `animation: none !important; transform: none !important;`.
7. **Canonical Non-Blanking Directional Page Transitions (`data-nav-dir` + Shared Keyframes)**:
   - Update `document.body.setAttribute('data-nav-dir', dir)` via `prepareOwnerRouteDirection(route)` right when activating the target tab (after cleaning up the outgoing view), and start keyframes (`xentraSlidePushIn`, `xentraSlidePopIn`, `xentraTabFadeIn`) at `opacity: 0.96` (never `opacity: 0` full-viewport blanking) over `140ms–180ms cubic-bezier(0.22, 1, 0.36, 1)`.
8. **Hide Legacy Fallback Views by Default in CSS**:
   - When a route is served by a modern React mount, legacy sibling containers (`#legacy-business-main-content`, `#master-categories-page`, `#product-list-view`) MUST be hidden by CSS (`display: none !important`) so they never flash for 1 frame before JS hides them.

## Completion

A coding task is complete only when the implementation matches the relevant contract, the correct runtime path is wired, affected callers remain coherent, and the changes are committed. Update durable documentation when the contract or architecture changes.

