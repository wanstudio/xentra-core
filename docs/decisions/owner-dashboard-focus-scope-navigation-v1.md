# Xentra — Owner Dashboard Focus/Scope vs Navigation v1

**Status:** LOCKED / AUTHORITATIVE UX CONTRACT  
**Decision date:** 2026-09-28  
**Scope:** Owner Dashboard mobile UI / responsive navigation

## Decision

The Owner Dashboard separates **scope selection** from **module navigation**:

- **Top Bar Focus Selector** selects the current business scope/context.
- **Bottom Navigation** selects the business module.
- Changing Focus does not replace or reconfigure the bottom-navigation architecture.

## Locked UX Rules

1. Focus options may include `Semua Cabang`, individual Branches, and future authorized scopes.
2. Focus defaults to `Semua Cabang` when the Owner is operating at Brand-wide scope.
3. Changing Focus changes dashboard content/data context, not the fundamental navigation structure.
4. Bottom Navigation remains stable across Focus changes.
5. Modules resolve their content against the selected Focus when the domain supports that scope.
6. Branch-specific views may narrow KPIs, Orders, Finance, Catalog, configuration, or other data to the selected Branch.
7. Scope-dependent content/configuration differences do not constitute a second navigation system.
8. Focus is not authorization. Core remains authoritative for identity, RBAC, permission, target, and scope enforcement.
9. Quick Access may expose high-frequency actions such as Promo, Banner, Product, Branch, and Payment without adding them as additional bottom-nav modules.

### Quick Access v1 Default Set

On the Owner mobile Home, Quick Access is a compact **2×4 grid (8 shortcuts)**. The default shortcuts are:

```text
Menu          Stok          Cabang         Promo
Laporan       Metode Bayar  Pelanggan      Tim & Akses
```

Route mapping uses existing Owner surfaces:
- Menu → `catalog/menus`
- Stok → `stock` (dedicated Owner Stock Overview; reads the authoritative operations/inventory report payload)
- Cabang → `branches`
- Promo → `marketing/promotions`
- Laporan → `reports`
- Metode Bayar → `finance/payment-methods`
- Pelanggan → `customers`
- Tim & Akses → `team`

These shortcuts are entry points to existing Owner Dashboard modules; they do not create new top-level modules or replace Bottom Navigation. `Lihat semua` opens the existing **Bisnis** hub.
10. The bottom navigation remains limited to the approved Owner top-level modules.

## Owner Mobile Navigation Baseline

```text
Top Bar
└── Focus: Semua Cabang ▼

Bottom Navigation
├── Beranda
├── Bisnis
├── Pesanan
├── Keuangan
└── Lainnya
```

Example:

```text
Focus: Bangjo Timur
        ↓
Beranda    → Bangjo Timur KPIs / attention
Bisnis     → Bangjo Timur business context where applicable
Pesanan    → Bangjo Timur orders
Keuangan   → Bangjo Timur financial context where applicable
Lainnya    → settings/team/system context according to authority
```

## Mental Model

**Top Bar:** “Saya sedang melihat scope siapa/apa?”  
**Bottom Navigation:** “Saya mau pergi ke module mana?”

## Non-Goals

This decision does not:

- change Owner vs Branch Manager authority;
- change User → Role → Scope RBAC;
- make Branch selection an authorization mechanism;
- create a new domain entity;
- require a separate navigation tree per Branch;
- move Promo/Banner into the bottom navigation;
- change API or persistence contracts.

## Related Contracts

- Owner Dashboard UI Blueprint in Notion.
- `docs/decisions/owner-dashboard-business-more-hub-ia-v1.md`
- `docs/OWNER_BRANCH_MANAGER_BOUNDARY.md`
- `docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md`
