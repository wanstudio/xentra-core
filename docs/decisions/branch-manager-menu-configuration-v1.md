# Xentra — Branch Manager Menu Configuration v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-09-17  
**Scope:** Branch Manager Operational Center / Catalog selling-assortment behavior

## Decision

Branch Manager has explicit **branch-scoped Menu Configuration authority** for the Branch assigned to the authenticated actor.

The business boundary is:

- **Owner / Brand:** owns the global Master Catalog, Master Products, Master Categories, Bundle/Composite definitions, and brand-wide catalog policy/universe.
- **Branch Manager:** chooses which approved Master Menus are sold by the Branch, creates and manages Branch Categories for that Branch, assigns adopted Branch Menus to those categories, and operates Branch Menu availability plus Product/SKU stock through Inventory.
- **Xentra-Core:** authenticates, authorizes, enforces branch scope, persists mutations, validates invariants, and audits protected mutations.

This is an explicit clarification/reconciliation of the existing Master Catalog + Branch selling-catalog model. It is **not** permission for Branch Manager to become a Master Product manager.


> **CURRENT FORWARD CONTRACT (2026-10-03):** The selling/assortment unit is **Menu**, not Branch Product. Branch adoption is persisted in `branch_menus`; Branch Category membership is `branch_menu_categories`; Product/SKU stock is `branch_product_inventory`. Any "Branch Product" wording below is historical terminology and must be interpreted as the underlying Product component or as a legacy compatibility path, never as the forward commercial identity.

> **ARCHITECTURE RECONCILIATION (2026-09-30):** This Branch Manager authority remains valid for **adoption, Branch Category classification, availability, stock**, plus the narrow **Customer Display Name Override** described in the forward Menu contract. It does **not** grant authority over Master Menu composition. The forward Menu contract is `docs/decisions/xentra-master-menu-composition-branch-adoption-contract-v1.md`. Legacy Branch Product description/image/price/name override behavior remains quarantined. The current optional Customer-facing display-name override is stored on `branch_menus.display_name_override`.


## Branch Manager capabilities

Within the current Branch only, Branch Manager may:

1. **Adopt/select** an approved Master Menu into the Branch selling assortment.
2. **Remove/unadopt** a Branch Menu from the Branch assortment.
3. **Create Branch Categories.**
4. **Rename Branch Categories.**
5. **Reorder Branch Categories.**
6. **Delete Branch Categories** subject to existing referential/data-integrity rules.
7. **Assign/remove Branch Menus** from one or more Branch Categories.
8. **Operate Branch Menu availability / sold-out state.**
9. **Operate Product/SKU stock** under the Inventory contract.

A Branch Product may belong to multiple Branch Categories. Category membership is a branch-local many-to-many relationship.

## Prohibited Branch Manager authority

Branch Manager must not:

- create, edit, or delete Master Products;
- create, edit, or delete Master Categories;
- create or modify Bundle/Composite composition;
- alter Master Product identity/content/defaults outside an explicitly approved Branch override contract; **for the new Menu contract, no such content override is canonical**;
- modify another Branch's assortment or Branch Categories;
- change brand-wide catalog policy or the global sellable universe;
- create a Branch-owned bundle/composite product.

## Catalog model

```text
Master Catalog (Owner / Brand)
├── Products / SKUs
├── Master taxonomy + Menu composition
└── Menu Satuan / Menu Paket

        ↓ approved Menus

Branch A
├── adopted Branch Menus
├── Branch Categories
│   ├── Menu membership → many-to-many
│   └── branch-local ordering
├── Menu availability
└── Product/SKU inventory

Branch B
├── adopted Branch Menus (independent selection)
└── independent Branch Categories
```

The same Master Product may be adopted by multiple Branches. Each Branch independently controls whether it carries that product and how the adopted product is organized locally.

## Authority invariant

The client UI may expose the capability according to role/scope, but UI visibility is never authorization. Every mutation must resolve:

```text
Authenticated identity
→ current role/permission
→ current Branch scope
→ target Branch Menu / Branch Category
→ requested authority
→ business invariants
→ atomic mutation
→ audit
→ authoritative response
```

A client-provided `branch_id` is context/input only and never sufficient authorization.

## Relationship to the Product Universe lock

This decision is compatible with the locked **Product Universe, Bundle Authority & Branch Selling Simplicity** decision:

> Owner determines what may be sold. Branch selects and operates it correctly.

The Branch Manager may select/adopt from the approved universe; the Branch Manager does not expand or redefine that universe.

## Implementation consequences

The Branch Manager Menu surface must provide a real branch-scoped path for:

- `Tambah dari Master Menu` / adopt Menu;
- viewing current adopted Menu assortment;
- removing/unadopting a Branch Menu;
- Branch Category CRUD + ordering;
- Branch Menu ↔ Branch Category membership management;
- Branch Menu availability/sold-out operation;
- Product/SKU inventory operation through the canonical Inventory boundary.

Server authorization must prevent cross-Branch mutation and all Master Catalog mutation from the Branch Manager role.

Required tests include:

- successful adoption of an approved Master Product into the manager's Branch;
- rejection of adoption into another Branch;
- successful Branch Category create/rename/reorder/delete;
- successful many-to-many membership changes;
- rejection of Master Product/Master Category/Bundle mutations by Branch Manager;
- persistence across reload/restart;
- audit coverage for protected mutations.

## Non-goal

**No Branch Bundle Engine.** Do not introduce branch-owned bundle components, bundle pricing formulas, branch-created composite products, or duplicate Master Products to satisfy local Branch categories or promotions.

## Documentation reconciliation rule

This decision supersedes older wording that limited Branch Manager Menu responsibility to availability/sold-out only. When a document says Branch Menu configuration/adoption is Owner-only, interpret that wording as stale and reconcile it to this locked decision.
