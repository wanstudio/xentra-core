# Xentra — Branch Catalog Model

**Status: LOCKED — reconciled with Canonical Architecture & Product Library v2**  
**Decision authority:** locked business decisions + Library v2

> The former snapshot/save-point wording is superseded. Current resolution is **Master Product Default + explicit Branch Override** for supported fields. Business ownership boundaries remain unchanged.

## 1. Canonical concepts

Xentra separates:

1. **Master Product** — Brand-owned identity/content/defaults.
2. **Master Category** — Brand-owned master grouping.
3. **Branch Product** — Branch selling assignment/configuration/state.
4. **Branch Category** — Branch-controlled selling grouping.
5. **Branch Menu** — durable Branch selling-menu configuration.
6. **Branch Product Availability** — daily operational state.
7. **Stock** — inventory quantity/state; not the same as availability.

These concepts must not be collapsed because they appear together in the customer menu.

## 2. Ownership boundary

```text
Owner / Brand
    ↓
Master Product + Master Category
    ↓
Branch Menu Configuration / Branch Product
    ↓
Branch Manager daily Availability
    ↓
Customer / POS / KDS consumption
```

Owner manages master catalog and durable Branch Menu configuration. Branch Manager operates Branch Product availability/sold-out state. Xentra-Core enforces authorization, scope, integrity, and persistence.

## 3. Resolution model

For fields that support inheritance:

```text
Master Product Default
        ↓
explicit Branch Override when present
        ↓
Effective Branch value
```

`NULL`/absent Branch override means inherit the Master default for that supported field. A Branch override wins without mutating the Master Product.

Do not describe this as an immutable copied snapshot or generic save-point model.

## 4. Branch Category

Branch Category is independently controlled at Branch scope. A Branch may organize its selling assortment differently from the Master Category structure. Identical names do not make Master Category and Branch Category the same entity.

A Branch may omit products/categories it does not sell and may arrange adopted products according to its own selling-menu configuration.

## 5. Availability vs Master active state vs Stock

These are three separate concepts:

```text
Master Product active state
        ≠
Branch Product Availability
        ≠
Stock quantity/state
```

`branch_products.is_available` remains the branch-scoped availability authority.

A Branch Manager marking a product sold out must not silently mutate Master Product `is_active`.

Stock exhaustion must fail safely and must not manufacture an artificial available quantity.

## 6. Customer-facing rule

When a Branch context exists, customer catalog reads consume the Branch selling catalog. Customer presentation must not silently fall back to a global Master Catalog when a Branch-scoped catalog is required.

Home has one active Branch context for customer presentation and must not mix products from multiple Branches in one Branch context.

## 7. Authority matrix

| Concern | Owner | Branch Manager | Core |
|---|---|---|---|
| Master Product | Configure/Govern | Observe | Enforce |
| Master Category | Configure | Observe | Enforce |
| Branch Menu | Configure | Observe | Enforce branch scope |
| Branch Product assignment | Configure/govern according to contract | Operate within granted scope | Enforce |
| Branch Product Availability | Observe | Operate | Enforce |
| Stock | Observe/report | Operate | Persist/validate |

Visibility in a dashboard never implies mutation authority.

## 8. Database boundary

This document does not authorize ad-hoc schema invention. Physical tables/columns must follow the current database contract and explicit migration decisions.

In particular, do not invent duplicate catalog structures merely to make UI terminology convenient.

## 9. Historical implementation notes

The previous adoption-as-snapshot model is **SUPERSEDED**. Current implementation direction is Master Product Default + Branch Optional Override.

Any old code/docs using snapshot/save-point terminology should be treated as legacy unless explicitly reconciled.

## 10. Implementation invariant

Before catalog changes:

1. identify Master vs Branch concept;
2. identify durable configuration vs operational state;
3. identify authoritative owner and scope;
4. reuse the canonical Library v2 vocabulary;
5. do not use Master state as a silent Branch operational state;
6. do not introduce a new synonym/entity to work around an existing boundary.

Canonical reference: `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md`.
