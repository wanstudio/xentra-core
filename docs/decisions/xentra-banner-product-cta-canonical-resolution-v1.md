# Xentra — Banner PRODUCT CTA → Canonical Menu Resolution v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-10-03  
**Scope:** Storefront Banner PRODUCT CTA / Customer Home navigation

## Decision

Existing Storefront Banner `PRODUCT` CTA content keeps `cta_target_id` as a **Product ID** for compatibility with existing Banner Content records and the current Owner Banner editor.

Customer navigation must not treat that Product ID as a commercial Menu identity.

When a Customer taps a Banner with `cta_type = PRODUCT`, the forward Customer Home path resolves the target through the canonical branch-scoped Menu catalog:

```text
Banner cta_target_id (Product ID)
        ↓
GET /catalog/composed-menu?branch_id=<current branch>
        ↓
Menu.components[].product_id
        ↓
exactly one matching Menu
        ↓
open canonical Menu detail
```

## Resolution rules

1. **Exactly one matching Menu**  
   Open that canonical Menu.

2. **No matching Menu**  
   Treat the Banner target as unavailable for the current branch. Do not query the legacy Product catalog as a fallback.

3. **More than one matching Menu**  
   Treat the target as ambiguous. Do not arbitrarily choose a commercial Menu. Tell the Customer that the Banner target maps to multiple Menus and keep normal catalog navigation available.

4. A Product CTA resolver must use Product identity only as a relation key (`components[].product_id`). It must never derive customer price, category, taxonomy, composition, or availability from `products.price`, `products.category_id`, or legacy Branch Product override fields.

5. Canonical Menu data remains the sole Customer commercial authority. The Banner is presentation/navigation content and does not become a source of pricing or eligibility.

## Compatibility boundary

This decision does **not** introduce a new `MENU` CTA type and does not reinterpret existing `PRODUCT` CTA records as Menu IDs.

The current Owner Banner editor may continue selecting a Product ID. A future change that makes Menu the stored CTA identity requires a separate schema/API/UI contract decision and migration plan.

## Non-goals

- No removal of the legacy Product CTA storage.
- No reactivation of `/catalog/menu` or `/products` as a forward Customer fallback.
- No Product price/category authority restoration.
- No arbitrary Product → Menu selection when one Product participates in multiple Menus.
