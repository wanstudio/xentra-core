# 🔒 Xentra — Product Name vs Category Display Boundary v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-10-01  
**Scope:** Master Catalog, Owner Product Editor, Master Menu Resolver, Customer PWA, Merchant Branch Menu

## 1. Decision

A **Master Product has its own explicit Product Name**.

The canonical Customer-facing card mapping is:

```
products.name       → Customer card title
Master Flavor       → Customer card subtitle
Master Complement[] → Customer card detail
Master Level        → Customer card indicator
Master Category     → grouping / classification
```

**Kategori is not the Product title.** Category remains a Master Catalog grouping/classification field.

A Product is therefore a named catalog entity that may share a Category with many other Products:

```
Kategori: Ayam
  ├── Ayam Geprek
  ├── Ayam Bakar
  ├── Ayam Kremes
  └── Ayam Goreng
```

## 2. Product identity

- `products.id` remains the canonical Product identity.
- `products.name` is the explicit Product Name and is required for Master Product creation.
- `products.name` is used as the default Customer card title.
- Product Name must never be derived from Category + Flavor or another composition concatenation.
- The structured component combination is not a Product primary key.

## 3. Category boundary

Master Category answers:

> “Produk ini termasuk kelompok apa?”

Product Name answers:

> “Produk ini apa?”

Therefore:

- `products.category_id` points to the Master Category.
- `categories.name` is used for category navigation, grouping, filters, and classification.
- `categories.name` must not be projected into a Product's `title` field.
- Multiple Products may have the same Category and must remain individually distinguishable by Product Name.

## 4. Customer presentation

Default resolution:

```
Customer title    = products.name
Customer subtitle = Master Flavor.name, when present
Customer detail   = ordered Master Complement names
Customer indicator = Master Level presentation
Customer grouping = Master Category
```

Existing Branch Customer Display Name Override remains a narrow Branch-scoped presentation exception:

```
branch_products.name_override
```

When a non-empty override exists:

- it replaces `products.name` for that Branch's Customer title;
- it does not change Master Product identity;
- it does not change Master Category;
- it does not change Master composition;
- the existing rule that an active display-name override suppresses the Master Flavor subtitle remains valid.

When cleared, the Branch falls back to the live Master Product Name.

## 5. Owner Product Editor

The Owner mobile Product Editor must expose:

```
Foto
Nama Produk       [required]
Kategori          [required]
Rasa              [optional]
Kelengkapan       [0..N]
Level             [optional]
Harga
...
Live Customer Preview
```

The Product Name field is visible and editable.

The editor must not:

- hide Product Name as an internal-only field;
- derive Product Name from Kategori + Rasa;
- use Category as the Customer title;
- create a second customer-facing name field.

The live preview must demonstrate the same canonical mapping used by the Customer PWA.

## 6. API / resolver invariant

The canonical Master Menu resolver must return:

```
title    = branch display-name override OR products.name
subtitle = Master Flavor.name (unless display-name override is active)
detail   = Master Complement names
indicator = Master Level
categories = Branch Category membership where applicable
master.category_id = Master Category identity
master.category_name = Master Category name
```

For the brand-wide Master Menu tree:

- category nodes are built from the actual Master Category record;
- product nodes are grouped under that Category;
- a product's title does not rename its Category node.

## 7. Data / migration impact

This correction does **not** require a schema migration for the Product identity model.

The existing `products.name` column already stores the required Product Name.

Implementation is a **read/presentation contract correction**:

1. expose `products.name` in Owner Product Editor;
2. require explicit Product Name on create/edit;
3. stop deriving name from Category + Flavor;
4. resolve Customer title from `products.name`;
5. keep Category as grouping/classification;
6. keep Branch Display Name Override as the only narrow presentation exception;
7. reconcile tests and documentation.

Existing Product Names must be preserved. No bulk rename based on Category + Flavor is authorized by this decision.

## 8. Supersession

This decision supersedes the earlier 2026-09-29 interpretation:

```
Kategori → Customer card title
products.name → internal-only identity
```

The authoritative forward mapping is now:

```
Product Name → Customer card title
Kategori     → grouping / classification
```

The prior wording may remain in historical records only when clearly identified as superseded.

## 9. Verification

Required regression coverage:

- Owner Product Editor exposes required Product Name.
- Product Name is sent directly in the Product save payload.
- Customer preview uses Product Name as title.
- Master resolver uses Product Name as title.
- Master resolver category tree uses Category name as category node name.
- Branch display-name override still overrides only the Customer title.
- Customer catalog route preserves both Product title and Category grouping.

**Git source of truth:** this document.