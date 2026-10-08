# Xentra — Master Menu Composition & Branch Adoption Contract v1

**Status:** ⚠️ SUPERSEDED — HISTORICAL  
**Original decision period:** 2026-09-29 to 2026-10-03  
**Superseded by:** `docs/decisions/catalog-menu-domain-contract-v2.md` (LOCKED, 2026-10-08)  
**Related current authority:** `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

## 1. Purpose

This document records the earlier Master Product / Branch Adoption model used during the Menu migration.

It is retained for migration traceability only.

It is **not an active business or implementation contract**.

## 2. What remains historically relevant

The earlier work established several boundaries that remain valid at a higher architectural level:

- Owner/Brand is the authority for the reusable Master Catalog.
- Branch adoption is separate from Owner authoring.
- Branch operational availability is distinct from Master lifecycle.
- Customer PWA consumes a resolved customer-facing Menu view rather than raw legacy database fields.
- Legacy Branch Product override/snapshot mechanisms must not be revived as the new Menu composition authority.
- Branch Category membership remains a separate classification/operational concern.

These principles are governed by the current domain and Branch/Menu contracts, not by this historical document.

## 3. Superseded Menu composition assumptions

The following historical assumptions must **not** be used for new implementation:

- Master Product as the primary customer Menu authoring mental model;
- Product Name as the only customer Menu title mechanism;
- Category + Rasa + Complement + Level as mandatory Product composition dimensions;
- Rasa as a universal Menu identity dimension;
- Complement/Kelengkapan as a universal Menu-level composition layer;
- a separate Product Options contract being treated as the universal Menu Choice model;
- Branch-side Product override semantics as the current Menu composition model.

Those assumptions were revised after F&B stress-testing and Owner Menu Editor review.

## 4. Current forward Menu model

Use:

```
Menu
├── Category
├── Title
└── Menu Items
     └── optional Item Choices
```

Item Choice belongs to the specific Menu Item.

The current Owner flow is defined by:
- `docs/decisions/catalog-menu-domain-contract-v2.md`
- `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

## 5. Branch adoption

The current Branch adoption concept remains:

```
Owner/Brand Menu
      ↓
Branch adopts Menu
      ↓
Branch operational context
      ↓
Customer-facing Menu
```

Adoption does not grant Branch authority to change Master Menu composition.

The exact Branch pricing, availability, stock, and permission rules remain governed by their respective active contracts.

## 6. Legacy migration boundary

Legacy Product/Menu fields, old option structures, and Branch Product compatibility paths may remain while migration is incomplete.

Their continued presence does not make the historical v1 model active.

Do not use this document to justify new schema or UI behavior.

## 7. Documentation rule

This file is intentionally concise after supersession so historical context does not appear beside active rules and create a false second contract.

**SUPERSEDED — retained for historical traceability only.**
