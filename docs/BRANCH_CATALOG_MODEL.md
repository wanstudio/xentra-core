# Xentra Branch Catalog Model

**Status: LOCKED — business/architecture ownership decision**
**Decision date:** 2026-09-05
**Authority:** Current Notion `01 — Architecture Decision Log`

## Core decision

Xentra distinguishes **Master Catalog** from **Branch Catalog**.

- Master Catalog is owned by the Owner/Brand and acts as the master product library.
- Branch has operational authority over what it sells and how its selling menu is organized.
- A Branch does not treat Master Catalog as a live operational mirror.
- A product becomes part of a Branch Catalog through an explicit adoption/copy/save-point action.
- Branch Catalog remains operationally present when the Owner later changes or disables the Master Catalog product.
- Master Catalog changes must not silently delete or disable an already-adopted Branch Product.

## Category ownership

**Branch Category is Branch-owned.** It is not a projection of Master Category.

A Branch may:

- create its own category;
- rename its own category;
- omit categories/products that it does not sell;
- organize an adopted product under any Branch Category it chooses.

Master Category and Branch Category are therefore separate concepts even when their names happen to be identical.

Example:

```text
Master Catalog
├── Makanan
├── Mie
└── Minuman

Branch A
├── Menu Favorit
│   └── Ayam Geprek
├── Mie
│   └── Mie Goreng
└── Minuman
    └── Es Teh

Branch B
├── Paket Hemat
│   └── Ayam Geprek
└── Minuman Dingin
    └── Es Teh
```

Branch B does not need a `Mie` category simply because `Mie` exists in the Master Catalog.

If a Branch Manager puts `Ayam Geprek` into a Branch Category named `Menu Ikan`, Xentra does not automatically correct that merchandising decision unless a separately locked business rule forbids it.

## Product relationship

The conceptual relationship is:

```text
Owner / Brand
      │
      ▼
Master Catalog
      │
      │ product available for adoption
      ▼
Branch Manager
      │
      │ adopt / copy / save point
      ▼
Branch Catalog
      ├── Branch Product
      │     ├── stock
      │     ├── availability
      │     ├── branch price/configuration
      │     └── branch operational state
      │
      └── Branch Category
            └── branch-controlled menu grouping
```

This is intentionally **not** a live-reference model where Branch selling configuration is derived directly from Master Product and Master Category on every read.

## Master changes

The following states are valid:

```text
Master Product: DISABLED

Branch A Product: ACTIVE
Branch B Product: ACTIVE
Branch C Product: DISABLED
```

The Master Product being disabled does not itself authorize Core to silently mutate all Branch Product records.

Future internal communication may inform Branches that the Owner disabled a Master Product, for example:

> Owner menonaktifkan product ini mulai hari ini. Selesaikan transaksi jika ada yang sedang berjalan. Jika tidak ada transaksi, silakan nonaktifkan di Branch Settings.

The Owner → Branch communication workflow, notification transport, synchronization/version policy, and conflict resolution are **future decisions** and are not defined by this document.

## Database implications

The current `branch_products` structure must not automatically be interpreted as complete implementation of snapshot/copy semantics merely because it references `products`.

Do not invent a schema solely from this decision. In particular, this decision does **not** authorize ad-hoc creation of:

- `branch_categories`;
- `categories.branch_id`;
- `products.branch_id`;
- `branch_catalog`.

The exact physical schema for Branch-owned Product/Category records, snapshot fields, versioning, and adoption semantics must be designed and explicitly locked as a separate data-model decision before implementation.

## Domain boundary

- **Catalog domain:** Master Catalog/product library and its master catalog contract.
- **Branch domain:** Branch operational authority and branch context.
- **Branch Catalog:** operational selling configuration owned by the Branch, composed from products the Branch has explicitly adopted.
- **Home/customer presentation:** when a Branch Catalog context exists, display the Branch Catalog rather than falling back to a global Master Catalog.
- **Core:** enforces authority, scope, integrity, state, consistency, idempotency, and auditability; it does not invent business policy.

## Invariants

1. Master Catalog is not a live operational mirror of every Branch.
2. Branch must explicitly adopt a product before it becomes part of that Branch's selling catalog.
3. Branch Category is independently controlled by the Branch.
4. Different Branches may sell different subsets of the same Master Catalog.
5. Different Branches may organize the same product under different Branch Categories.
6. A Master Catalog change must not silently remove or disable an already-adopted Branch Product.
7. A product may remain operationally available to a Branch even when it is disabled in Master Catalog until the approved Owner → Branch operational workflow is applied.
8. Customer-facing Branch Catalog reads must not silently fall back to the global Master Catalog.
9. No implementation may invent schema or synchronization rules that have not been separately approved.

## Current implementation acceptance — 2026-09-05

The current Xentra-Core checkpoint is accepted for the **main Branch Catalog architecture goal**:

- the demo dataset now targets exactly five canonical Branches;
- Branches have independent Branch Categories and Branch Product subsets;
- shared Master Products may be adopted independently by multiple Branches;
- CatalogService/API and Home branch context are expected to consume Branch-scoped catalog data rather than a global Master Catalog fallback;
- the frontend must not hardcode Branch-specific product catalogs.

This acceptance concerns the **catalog structure and branch-scoped UI consumption**, not every operational property of the demo seed implementation.

### Deferred seed-cleanup issue

Commit `f80dd4cf49d95df276f2815dc5cf200f01b184f8` currently performs broad cleanup of non-canonical Branches and related records. This is explicitly **deferred** and excluded from the current architecture acceptance. A future hardening task must restrict destructive cleanup to clearly seed-owned/demo data and must never delete arbitrary persistent business data merely to converge the demo dataset to five Branches.

The deferred cleanup concern does not alter the accepted Master Catalog / Branch Catalog ownership model or the branch-scoped Catalog → UI flow.

## Relationship to previous Home decision

The earlier Home rule remains valid at the presentation level: Home has one Branch Context and must not mix products from multiple Branches. The clarification here changes **what Branch-scoped Catalog means**: it is a Branch-owned saved/adopted catalog, not merely a projection of globally-owned categories/products through `branch_products`.
