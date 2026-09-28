# Xentra Mobile UI Pattern & Asset Library — Audit Baseline v1

**Status:** LOCKED — AUDIT/PLANNING BASELINE  
**Date:** 2026-09-29

## Purpose

Document and consolidate mature Xentra mobile UI patterns and assets before building the new Merchant Menu and Stock surfaces.

This is an inventory/ownership document, not permission to redesign the UI system.

## Source surfaces to audit

- `apps/customer-pwa`
- `apps/merchant-app`
- `apps/merchant-dashboard`
- `apps/pos-app`
- `apps/merchant-shared`

## Pattern groups

### Shell

- top bar
- back affordance
- bottom navigation
- page header
- section header
- sticky action/footer

### Content

- list item
- card
- section card
- divider
- badge/status
- empty state
- error state
- loading/skeleton

### Interaction

- toggle
- tabs/segmented control
- checkbox/radio
- bottom sheet
- action sheet
- modal/dialog
- confirmation
- toast/snackbar

### Operational states

- available
- unavailable
- low stock
- out of stock
- saving
- saved
- warning
- error
- disabled
- scheduled/pending

## Asset groups

Audit existing assets before adding new ones:

- navigation icons
- menu/food/category icons
- stock/operations icons
- status icons
- Customer PWA illustrations
- existing PWA/app branding assets where reusable

## Canonical-source rule

Every promoted shared pattern or asset must record:

- canonical source path;
- owning surface/library;
- usage examples;
- variants/states;
- whether it is safe for cross-surface reuse.

Do not copy an asset/component into another app merely to make implementation convenient.

## Menu/Stock requirement

Menu and Stock must consume this library after the audit rather than introducing parallel primitives.

GoFood Merchant / GrabMerchant references may influence visual ergonomics only. They do not define Xentra IA.

## Implementation gate

No new Menu/Stock UI primitive should be created until the audit confirms that an existing Xentra implementation cannot satisfy the requirement.

**LOCKED — audit existing Xentra UI first, document it, reuse it, then build only what is genuinely missing.**
