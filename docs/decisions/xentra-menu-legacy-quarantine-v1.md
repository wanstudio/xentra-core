# Xentra Legacy Menu Architecture Quarantine v1

**Status:** LOCKED — LEGACY QUARANTINE / NON-CANONICAL  
**Date:** 2026-09-29  
**Superseded by:** `docs/decisions/xentra-master-menu-composition-branch-adoption-contract-v1.md`

## 1. Purpose

This document quarantines the previous Branch Catalog / Menu architecture so legacy behavior does not contaminate the approved new Master Menu Composition direction.

The quarantine is an **architecture boundary**, not a destructive data purge.

## 2. New canonical direction

The canonical direction is:

```
Owner creates Master data
    ↓
Owner assembles Master Product
    ↓
Merchant adopts Master Product
    ↓
Merchant classifies adopted Product with Branch Categories
    ↓
Customer PWA renders resolved Master composition in Branch context
```

Owner-owned structured Master data includes the customer-facing composition vocabulary such as Kategori, Rasa, Kelengkapan, and Level.

Merchant does not author or override that composition.

## 3. Legacy behavior now quarantined

The following are **legacy/non-canonical** for the new Menu architecture:

### Branch Product legacy content overrides

```
branch_products.description_override
branch_products.image_override
```

These legacy fields MUST NOT be used for new Customer Menu composition work. They remain temporarily for compatibility and migration only.

### Reclassified canonical field — Branch Customer Display Name

`branch_products.name_override TEXT NULL` is now a narrow canonical presentation field.

It is optional and scoped to one Branch adoption:
- non-empty string → Customer title override for that Branch;
- `NULL` / cleared → inherit the live Master Customer presentation;
- `branch_products.product_id` remains the Master Product reference;
- no new Product or Master composition is created.

Canonical transport:
`PATCH /admin/branches/:id/menu/:productId/display-name`

This reclassification does not activate `description_override` or `image_override`.

### Legacy Branch override UI

The existing Branch Catalog UI that exposes:

- Edit Menu Cabang;
- free-form branch name override;
- free-form branch description override;
- branch image override;

is legacy compatibility UI.

It must not be expanded or treated as the new Merchant Menu editor.

### Legacy Branch override API

```
PATCH /admin/branches/:id/products/:productId/override
```

is legacy compatibility infrastructure.

No new field may be added to this endpoint for the new Menu Composition model.

### Legacy snapshot columns

```
product_name
product_description
product_image_url
```

are migration/backward-compatibility columns only.

They are not a new data source for Customer Menu composition.

### Legacy scalar Branch Category relation

```
branch_products.branch_category_id
```

is not the canonical Branch Category membership authority.

The canonical relationship is:

```
branch_product_categories
```

with Branch scope enforced by Core.

## 4. What remains valid and is NOT quarantined

These concepts remain valid:

- Master Product identity;
- Master Category ownership by Owner/Brand;
- Branch Product adoption relationship;
- Branch Category ownership;
- Branch availability;
- Branch stock / Inventory authority;
- Pricing Policy;
- existing POS Variant/Add-on contract in `products.options_config`;
- immutable order snapshots;
- RBAC and branch scope;
- audit and Core authorization.

Quarantine applies to the **old Menu composition/override mechanism**, not to the whole Catalog, Branch, Inventory, POS, or Order architecture.

## 5. Runtime compatibility rule

Until migration is complete, legacy runtime paths may continue to exist because existing data and current application flows depend on them.

However:

1. no new feature may depend on legacy override fields;
2. no new Customer PWA presentation may be designed around legacy free-text overrides;
3. no new Merchant Menu UX may expose legacy override semantics as the canonical model;
4. all new Menu APIs must use the new structured composition contract;
5. migration work may read legacy fields only to reconcile existing data;
6. legacy paths must be removed or disabled after migration acceptance.

## 6. Agent / implementation rule

When an AI agent, developer, or future implementation task encounters conflicting references:

- the **Master Menu Composition & Branch Adoption Contract v1** is the forward-looking Menu architecture;
- this document marks the previous Branch Override/Snapshot mechanisms as legacy;
- old docs mentioning Branch Override/Snapshot are historical unless explicitly marked as still authoritative for an unrelated domain;
- do not revive legacy behavior merely because existing source code still contains it.

## 7. Documentation reconciliation

The following legacy documents/sections must not remain authoritative for Menu composition:

- `docs/BRANCH_CATALOG_MODEL.md` — mark SUPERSEDED; retain for history only.
- prior Branch Catalog Snapshot / Save Point language — historical.
- prior Master Product Default + Branch Optional Override language for Menu content — superseded for the new Menu composition direction.
- Merchant Menu IA references to name/description/image overrides — superseded by the new structured Master composition model.

The existing POS `options_config` contract is explicitly excluded from this supersession.

## 8. Migration boundary

Migration must be explicit and staged:

```
Legacy data
   ↓
reconcile / map
   ↓
Master Component Library
   ↓
Product Composition relations
   ↓
Branch Adoption
   ↓
Customer Menu resolver
   ↓
legacy path removal
```

Do not perform destructive deletion of legacy columns before migrated data has been verified.

## 9. Completion criteria

Quarantine is considered complete only when:

- new Menu composition is the sole canonical Customer Menu path;
- Merchant cannot edit Master composition;
- Customer PWA no longer depends on legacy branch content overrides;
- legacy override endpoint has no active consumer;
- legacy override UI has no active consumer;
- Branch Category M:N is canonical;
- migration tests prove no meaningful legacy data is lost;
- legacy compatibility fields can be removed or formally archived.

**LOCKED — Legacy Menu/Snapshot/Branch-Override architecture is quarantined. It is retained only as compatibility material until the new Master Menu Composition migration is accepted.**
