# Xentra — Master Menu Composition Implementation Plan v1

**Status:** ⚠️ SUPERSEDED — HISTORICAL EXECUTION PLAN  
**Original date:** 2026-09-29  
**Superseded by:**  
- `docs/decisions/catalog-menu-domain-contract-v2.md`
- `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

## 1. Purpose

This file records the earlier execution plan used while Xentra migrated from the Product-centric Menu model.

It is retained for:
- migration history;
- traceability of implementation commits;
- understanding why compatibility tables/fields exist.

It is **not** a current implementation plan.

## 2. Current forward authority

New Menu implementation must follow:

```
Menu
├── Category       → grouping/classification
├── Title          → explicit customer-facing commercial name
└── Menu Items
     └── optional Item Choices
```

Item Choice:
- belongs to one specific Menu Item;
- may be fixed by Owner or selected by Customer;
- starts from an Xentra-provided choice template;
- may have editable customer-facing labels/values;
- uses a generic Custom renderer when no standard template fits;
- must not use label text to infer business meaning.

See:
- `docs/decisions/catalog-menu-domain-contract-v2.md`
- `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

## 3. Historical implementation material

Earlier phases implemented or proposed:
- Master Product composition;
- Master Rasa / Complement / Level relations;
- Product-centric Menu resolution;
- Branch Product adoption;
- Branch Category membership;
- order menu snapshots;
- legacy migration tracking.

Some of these structures remain useful as migration/compatibility infrastructure. Their presence does not make the old Product-centric composition model active.

## 4. What is superseded

Do not use this historical plan to introduce:
- Product Name as a substitute for current Menu Title;
- Category + Sub Category + Rasa as universal Menu identity;
- universal Master Rasa/Complement/Level composition;
- separate global Menu Configuration input;
- Owner-created custom UI templates;
- Product-centric menu editing as the current Owner mental model;
- legacy Branch Product override semantics as new Menu functionality.

## 5. Migration principle retained

The incremental migration principle remains valid:

```
Expand
  ↓
Migrate / Backfill
  ↓
Verify
  ↓
Switch consumers to canonical model
  ↓
Prove no legacy consumers remain
  ↓
Contract / remove
```

No destructive cleanup should be inferred from this document.

## 6. Relationship to Production / Material / Inventory

This historical Menu execution plan does not define:
- Recipe / BoM;
- Production Item;
- Material;
- Material Stock;
- Stock Location;
- Procurement.

Those concerns are governed by current domain-boundary and future target data-model decisions.

Menu composition may later provide an input to Production/Recipe resolution, but this document does not define that relationship.

## 7. Worker rule

If an older implementation step, test, or comment from this plan conflicts with a current locked contract:

**current locked contract wins.**

Do not modify the current business model merely to make historical implementation steps look internally consistent.

If a migration requires compatibility behavior, keep it explicitly marked as compatibility and document the migration evidence.

**SUPERSEDED — historical execution plan only.**
