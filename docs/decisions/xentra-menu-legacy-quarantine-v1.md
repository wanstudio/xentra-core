# Xentra Legacy Menu Architecture Quarantine v1

**Status:** 🔒 LOCKED — LEGACY QUARANTINE / NON-CANONICAL  
**Original date:** 2026-09-29  
**Current forward authority:** `docs/decisions/catalog-menu-domain-contract-v2.md`  
**Current Item Choice authority:** `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

## 1. Purpose

This document quarantines the earlier Branch Catalog / Product-centric Menu implementation so legacy behavior is not reintroduced into the current Menu architecture.

It is a **migration boundary**, not a second active Menu contract.

## 2. What is quarantined

The following earlier mechanisms remain legacy/compatibility material:

- legacy Branch Product content overrides;
- legacy Product/Menu snapshot fields;
- legacy scalar Branch Category relation;
- old Product-centric Menu composition;
- old Product Options/variation structures where they conflict with the new Menu Item Choice contract;
- legacy Menu/Product endpoints that expose the old composition model.

Their presence in source or database does not make them current business authority.

## 3. Current forward Menu model

New Menu work follows:

```
Menu
├── Category
├── Title
└── Menu Items
     └── optional Item Choices
```

Category is grouping/classification.

Title is explicit customer-facing commercial naming.

Item Choice belongs to a specific Menu Item.

Use:
- `docs/decisions/catalog-menu-domain-contract-v2.md`
- `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`

Do not derive new behavior from the historical Product → Rasa/Complement/Level composition described by earlier versions of this document.

## 4. Legacy compatibility rule

Legacy routes, fields, and adapters may remain while migration requires them.

They must:
- remain explicitly marked as compatibility/legacy;
- not become a new source of truth;
- not be extended to satisfy new Menu requirements;
- not be exposed as the canonical Owner Menu authoring model;
- be removed only after consumer/data migration evidence is complete.

## 5. Branch boundary

Branch adoption/operations remain separate from Owner Menu authoring.

Branch does not create a second Master Menu composition.

Branch operational availability and Inventory stock remain separate authorities.

The exact active Branch adoption and permission rules are governed by their current contracts; this quarantine document does not redefine them.

## 6. Customer boundary

New Customer PWA/Menu work must consume the current resolved Menu contract.

Do not reconstruct customer Menu semantics from:
- legacy Product fields;
- legacy Branch override fields;
- old Product composition relations;
- raw internal Item/Product fields.

## 7. Migration / retirement

Use the existing staged migration principle:

```
Legacy data
   ↓
reconcile / map
   ↓
canonical Menu model
   ↓
switch consumers
   ↓
verify
   ↓
remove legacy paths
```

Destructive cleanup is always a separate verified step.

## 8. Worker rule

When a source file, test, or historical document conflicts with the current Menu contract:

1. classify the conflicting material as current, compatibility, superseded, or historical;
2. follow the current locked contract for new work;
3. do not make a legacy behavior canonical merely because existing tests pass;
4. if the current contract itself is insufficient, stop and record the missing business decision before inventing a substitute.

**LOCKED — legacy Menu architecture remains quarantined and is not a competing implementation authority.**
