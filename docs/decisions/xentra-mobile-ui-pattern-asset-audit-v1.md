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
