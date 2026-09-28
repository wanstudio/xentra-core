# Xentra Mobile UI Pattern & Asset Audit — Menu/Stock Preparation v1

**Status:** AUDIT BASELINE  
**Date:** 2026-09-29  
**Repository:** `wanstudio/xentra-core`

## Objective

Identify mature Xentra UI primitives and assets that should be reused by the upcoming Merchant Menu and Stock work.

This audit intentionally does **not** define Menu/Stock IA yet.

## Confirmed reusable candidates

| Pattern | Current canonical implementation | Surface | Reuse decision |
|---|---|---|---|
| Merchant shared auth/DOM/format helpers | `apps/merchant-shared/js/shared.js` | Merchant surfaces | Reuse |
| Toast | `apps/merchant-shared/js/shared.js` + `apps/merchant-shared/css/shared.css` | Merchant surfaces | Reuse |
| Overflow action menu / popover | `apps/merchant-shared/js/action-menu.js` + shared CSS | Merchant surfaces | Reuse |
| Image crop editor | `apps/merchant-shared/js/crop-editor.js` + shared CSS | Merchant surfaces | Reuse |
| Merchant modal/overlay shell | `apps/merchant-shared/css/dashboard.css` | Merchant surfaces | Reuse/audit |
| Merchant toggle | `apps/merchant-shared/css/dashboard.css` | Merchant surfaces | Reuse |
| Merchant top bar | `apps/merchant-shared/css/dashboard.css` + existing shell HTML | Merchant surfaces | Reuse grammar |
| Merchant bottom navigation | `apps/merchant-dashboard/index.html` + shared dashboard CSS | Owner surface | Reference/reuse where surface-appropriate |
| Merchant bottom-sheet styles | `apps/merchant-shared/css/dashboard.css` | Merchant surfaces | Reuse/audit |
| Customer bottom sheet | `apps/customer-pwa/assets/css/components.css` + `app.css` + existing page HTML/JS | Customer PWA | Reuse visual/interaction pattern; do not blindly import customer code |
| Customer back affordance | `apps/customer-pwa/assets/icons/arrowback.svg` and existing page implementations | Customer PWA | Candidate for shared asset audit |
| Merchant Menu availability toggle | `apps/merchant-app/assets/js/menu.js` / `branch-catalog-ui.js` + shared toggle CSS | Merchant App | Reuse behavior/pattern; refactor only if needed |
| Branch category chips/list interaction | `apps/merchant-app/assets/js/menu.js` | Merchant App | Candidate pattern; assess against new IA |
| Branch product override modal | `apps/merchant-app/assets/js/branch-catalog-ui.js` | Merchant App | Reuse domain interaction patterns; redesign presentation if needed |

## Important existing architecture

`apps/merchant-shared/` already exists as a shared merchant frontend layer.

Current documented load order:

`shared.js → action-menu.js → crop-editor.js → catalog-client.js → surface-owned branch-catalog-ui.js → surface JS`

Therefore the new Menu/Stock implementation should extend this architecture rather than creating another generic UI layer.

## Customer PWA asset rule

Customer PWA contains mature assets and interaction patterns, including:

- `apps/customer-pwa/assets/icons/arrowback.svg`;
- bottom-sheet implementation in `components.css` / `app.css`;
- existing modal/dialog patterns;
- existing icon and illustration assets.

These should be inventoried for genuine cross-surface reuse. Do not duplicate or relocate assets merely for convenience.

## Known duplication / consolidation opportunities

The audit shows that some visual primitives exist in more than one surface, for example:

- top bars;
- modal shells;
- toast implementations;
- bottom navigation;
- bottom sheets;
- icon usage.

This does **not** mean they should all be forcibly merged into one universal component. First determine whether the behavior and visual contract are actually shared. Surface-specific shell behavior should remain surface-specific.

## Menu/Stock-specific findings

### Menu

Existing Merchant App already contains:

- availability toggle;
- category filtering;
- category chips;
- branch product override;
- product image crop flow;
- price-policy-aware editing;
- multi-category checkbox selection.

These are valuable implementation evidence, but the current screen structure is **not automatically the final Menu IA**.

### Stock

No new Stock-specific UI primitive should be created yet.

First map the authoritative inventory concepts and inspect any existing stock/inventory UI before deciding the information hierarchy.

## Next audit pass

Before Menu IA design:

1. inspect all existing Merchant/Customer icon directories and identify duplicates;
2. map top bar/back/bottom-nav/sheet/modal/toggle implementations and their actual behavior;
3. identify which primitives are truly cross-surface versus surface-specific;
4. document canonical source paths;
5. identify safe shared-library candidates;
6. separately inspect existing Inventory/Stock UI and Core inventory contracts;
7. only then draft the Xentra-specific Menu and Stock IA.

## Guardrail

Do not implement or redesign Menu/Stock based on GoBiz hierarchy during this audit.

**Audit result so far: Xentra already has substantial reusable UI infrastructure. The next work is consolidation/documentation and IA design, not rebuilding primitives from scratch.**

## Second Audit Pass — Completed 29 September 2026

The second pass inspected the current Merchant Menu/Stock implementation, Owner Stock surface, inventory routes/services, domain documentation, tests, and icon references.

### Canonical shell / interaction findings

- Merchant shared infrastructure remains the correct reuse boundary: merchant-shared/js/shared.js, action-menu.js, crop-editor.js, shared.css, and dashboard.css.
- Merchant shell patterns (top bar, toggle, modal/overlay, bottom-sheet styling) are already available in dashboard.css; do not create parallel Menu/Stock shell primitives.
- Customer PWA has a mature back icon at assets/icons/arrowback.svg and mature sheet/dialog patterns, but Customer and Merchant ownership must remain explicit before cross-surface promotion.
- Owner Dashboard has its own bottom navigation and stock overview surface. It should not be treated as the Merchant App navigation implementation merely because the CSS is shared.
- Existing Merchant App Menu code already consumes the shared toggle and catalog/crop infrastructure.

### Icon / asset findings

The codebase currently mixes three asset strategies:

1. surface-owned PWA assets (/merchant-app/assets/icons, /pos/assets/icons);
2. shared/public Customer PWA assets (/assets/icons/...);
3. Owner Dashboard assets (/merchant-dashboard/assets/icons/..., including quick-access assets).

The correct consolidation rule is ownership-first, not "put every icon in one folder". Existing icons should only be promoted to a shared library when the visual and behavioral contract is genuinely cross-surface.

Notable existing canonical examples:

- Customer back affordance: apps/customer-pwa/assets/icons/arrowback.svg;
- Merchant/POS installed-PWA icons: surface-owned icon-192.png / icon-512.png;
- Owner quick-access icons: apps/merchant-dashboard/assets/icons/quick-access/*;
- Owner stock icon: apps/merchant-dashboard/assets/icons/quick-access.svg#stock.

### Menu findings

Current Merchant App Menu already provides evidence for:

- availability filtering/toggling;
- category chips and category ordering;
- category image editing;
- product adoption into a branch catalog;
- multi-category assignment;
- branch product image/name/description/price-policy overrides;
- crop-editor integration;
- toast mutation feedback.

However, the current screen is a legacy operational implementation, not yet the locked final mobile Menu IA. It should be used as a behavior/domain source, not copied wholesale as the new screen structure.

One presentation issue to clean up during the IA implementation pass: the current category UI uses inline emoji glyphs (edit/delete/drag) for controls. These should be replaced by the canonical Xentra icon treatment selected during the asset consolidation pass; do not add another ad-hoc icon set.

### Stock findings — important domain/UI boundary

The current Merchant Stock UI is a Branch Manager operational surface with:

- branch inventory fetch;
- search and status filters;
- total/safe/low/out statistics;
- manual adjustment action;
- adjustment type, signed quantity, and notes;
- success/error toast feedback.

The Core Inventory domain is authoritative and provides strict non-negative stock plus immutable movement history. The UI therefore must not invent stock state or mutate availability as a side effect.

The audit also found a **contract-drift blocker that must be resolved before the final Stock UI is implemented**:

- docs/DATABASE_SCHEMA.md states that branch-product assignment is not inventory and API-created assignments keep stock NULL.
- tests/apiEndpoints.test.js explicitly asserts that a valid catalog assignment must not fabricate stock and that stock stays NULL.
- server/routes/admin-branch-catalog.js currently contains an adoption INSERT path that writes stock = 100.

These three facts disagree. This is a backend/domain-contract issue, not a UI decision. The Stock IA must therefore model an explicit **Belum dilacak / untracked** state rather than silently treating an unrecorded inventory value as "HABIS" until the authoritative contract is reconciled.

The current stock.js also converts a null stock to 0 through Number(it.stock). That can make an untracked item appear as out-of-stock in the UI. This must not be carried into the new Stock UX.

### Stock IA evidence from current domain

The authoritative model already distinguishes:

- branch catalog assignment;
- operational availability (is_available);
- physical stock (stock);
- low-stock threshold;
- stock movement ledger;
- branch scope and RBAC.

Therefore:

- **Menu** owns "can customers order this item?" / availability presentation.
- **Stock** owns physical quantity and stock movement/adjustment.
- A Stock action must not automatically switch Menu availability.
- An untracked (NULL) stock value is not the same fact as zero stock.
- Product options/variations remain a Menu/catalog concern unless a future domain contract explicitly creates inventory-bearing variants.

### Final audit gate

The source audit is now sufficient to move to **IA proposal**, with one backend contract drift explicitly parked as a blocker for implementation rather than silently normalized in the UI.

Next sequence:

1. freeze the canonical reusable pattern/asset map;
2. draft Xentra-specific Menu IA;
3. draft Xentra-specific Stock IA;
4. review/lock IA;
5. reconcile the stock assignment contract;
6. implement UI using existing shared primitives;
7. run regression/UI tests.

**AUDIT COMPLETE — no new generic UI framework is justified for Menu/Stock.**


## Contract Reconciliation — Completed 29 September 2026

The stock-assignment drift identified by the audit has now been reconciled against the locked catalog/inventory contract.

- server/routes/admin-branch-catalog.js no longer writes a fabricated stock value when a master product is adopted into a branch catalog.
- tests/apiEndpoints.test.js now asserts that adoption preserves stock = NULL.
- Physical stock remains owned by the Inventory domain and is established through inventory operations, not catalog adoption.

This removes the backend blocker for IA implementation. The remaining UI requirement is unchanged: existing NULL stock must be rendered as **Belum dilacak**, not **Habis**.

Git commits:
- 0d1d3c1b6fc35b7f9c653f54a653cb6d125bb03c — catalog adoption contract fix.
- 796fc662ae9dbd1b45d25c08d42fa0be15153204 — regression test for non-fabricated stock.

**Audit status: COMPLETE. Backend contract blocker: RESOLVED.**
