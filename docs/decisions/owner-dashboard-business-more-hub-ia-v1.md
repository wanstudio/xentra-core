# Xentra — Owner Dashboard Business / More Hub IA v1

**Status:** LOCKED / AUTHORITATIVE UX SKELETON  
**Decision date:** 2026-09-28  
**Scope:** Owner Dashboard mobile hub navigation after Beranda Quick Access

## Audit conclusion

The Owner Dashboard keeps the five approved bottom-navigation modules:

```text
Beranda
Bisnis
Pesanan
Keuangan
Lainnya
```

Current restaurant-platform references show a recurring separation between home/overview, business-management capabilities (catalog, locations, staff, marketing), financial/payment capabilities, reporting/insight, and account/settings concerns. GrabMerchant documents Home, Insights, Menu/Catalog/Item, Employees, payments, and multi-store management as distinct functional areas. Toast separates Reports from configuration and groups reports by Sales, Menus, Payments, Labor, Marketing, and other domains. Square similarly separates dashboard reporting, items/inventory, and team/customer operations. These patterns are reference inputs only; Xentra remains governed by its own domain and authority contracts.

## 🔒 Owner Catalog UI Clarification — No Master Menu & Paket Hub
**Decision date: 29 September 2026**

The Owner mobile **Bisnis** hub must expose the canonical Master Catalog concepts only:

```
Katalog
└── Produk Master
```

`Menu & Paket` is **not** a standalone Master Catalog navigation layer.

- **Master Product** is the canonical product identity/composition authority.
- **Master Category** organizes the Master Product catalog.
- **Paket / Bundle / Composite** remains an Owner/Brand catalog capability, but no standalone `Paket` UI is exposed until an authoritative package domain/API exists in Core.
- **Menu Cabang** is the branch selling assortment/configuration surface, not a Master Catalog object. The existing route `catalog/menus` remains valid and is labeled **Menu Cabang**.
- Branch Menu access may be entered from Branch Management and from the dedicated `Menu Cabang` Owner route; it must not be presented as `Menu & Paket` in the Master Catalog hub.

Technical terms such as **Master Menu Composition** remain valid for the structured customer-facing resolver/checkout snapshot. That is an internal/domain composition contract, not permission to create a separate Master Menu navigation layer in the Owner UI.

The change is UX/IA terminology and surface ownership only; existing Core authority and Branch Menu contracts remain unchanged.

## 🔒 Kategori & Rasa = Master Dropdown References — 29 September 2026

The Owner `Kategori & Rasa` surface is a small master-reference screen, not a Menu builder.

```
Kategori & Rasa
├── Kategori
│    └── source for Produk Master → Kategori dropdown
└── Rasa
     └── source for Produk Master → Rasa dropdown
```

The `+` action beside the Product form dropdown is a quick-create shortcut into the same master authority. It must not create branch data or a second vocabulary.

`Kelengkapan` and `Level` remain composition controls on the Master Product editor for now because their interaction model is different (multi-select / single-select).

## 🔒 MASTER PRODUCT ASSEMBLY WORKSPACE — 29 September 2026

The Owner Catalog UI uses **Produk Master as the single assembly workspace**. There is no separate `Kategori` or `Kategori & Rasa` navigation tab.

Master references remain authoritative in Core, but are exposed progressively from the Product editor:

```
Produk Master
├── Foto
├── Nama
├── Kategori  ▼  +
├── Rasa      ▼  +
├── Kelengkapan
├── Level
├── Harga
└── Preview Customer
```

The `+` beside Kategori/Rasa opens a contextual modal, creates the master value, refreshes the same selector, and selects the new value. It is a shortcut into the same Core master authority, not a second data model.

This follows the progressive-disclosure reference: the user stays inside the task of assembling one product/menu item instead of navigating to separate master-reference screens.

Menu Cabang remains a separate branch assortment/configuration surface.

## Locked Owner Home / Quick Access

Home remains the mobile command center.

Quick Access remains a compact 2×4 shortcut grid:

```text
Menu          Stok          Cabang        Promo
Laporan       Metode Bayar  Pelanggan     Tim & Akses
```

Rules:
- Quick Access is a shortcut layer, not a second navigation hierarchy.
- Laporan remains a shortcut to the reports route.
- Metode Bayar remains a shortcut to the finance/payment-methods route.
- Finance remains the top-level financial module; no new Payment top-level module is created.
- Lihat semua opens the existing Bisnis hub.

## Locked Business Hub skeleton

```text
BISNIS

Katalog
└── Produk Master

Operasional
├── Stok
└── Cabang Resto

Pelanggan & Pemasaran
├── Pelanggan
└── Marketing & Promo

Tim & Akses
└── Tim & Akses

Insight & Laporan
└── Laporan

Brand
└── Identitas & Branding
```

Intent:
- Business is the discoverable management hub for client business resources and business-facing configuration.
- Existing routes remain authoritative; this work only reorganizes entry-point presentation.
- Stock stays read-only on Owner, consistent with the Owner ↔ Branch Manager authority boundary.
- Reports are discoverable from Business under Insight & Laporan, while the canonical report route remains reports.
- Brand identity is business identity/configuration; the existing settings/business/profile route remains the implementation surface.

## Locked More Hub skeleton

```text
LAINNYA

Pengaturan
├── Pengaturan Restoran
├── Integrasi
├── Notifikasi
└── Akun & Keamanan

Akun
└── Profil & Keluar
```

Intent:
- More is reserved for system/settings/account concerns.
- It must not duplicate Team, Reports, or Brand Identity from Business.
- Existing settings/* routes remain unchanged.
- Account logout remains in the existing Profile & Logout action.

## Non-goals

This decision does not:
- change Bottom Navigation count or route ownership;
- change Core RBAC/authorization;
- create new business domains;
- change APIs or database contracts;
- change Owner vs Branch Manager operational authority;
- finish visual polish beyond the current skeleton/section grouping.

## Related contracts

- docs/decisions/owner-dashboard-focus-scope-navigation-v1.md
- docs/OWNER_BRANCH_MANAGER_BOUNDARY.md
- docs/CANONICAL_ARCHITECTURE_PRODUCT_LIBRARY_V2.md

## Reference sources

- GrabMerchant: https://merchant.grab.com/id-id/guides/all/kemudahan-kelola-bisnis-dengan-grabmerchant-portal
- Toast Reports: https://support.toasttab.com/en/article/Getting-Started-with-Analytics-and-Reports
- Square Reports: https://squareup.com/help/us/en/topic/reports
- Square Inventory: https://squareup.com/help/us/en/article/6110-manage-inventory-with-the-retail-pos-app

## 🔒 UPDATE — Kategori Management Page
**29 September 2026**

Owner Katalog sekarang memiliki management page **Kategori** di atas **Produk Master**.

```
Katalog
├── Kategori       ← lihat/edit kategori existing
└── Produk Master  ← assembly workspace
```

Ini tidak mengubah keputusan bahwa Produk Master adalah tempat assembly. Halaman Kategori hanya menjadi progressive-disclosure surface untuk mengelola master category yang sudah ada. Product editor tetap menyediakan `Kategori ▼ +` sebagai quick-add shortcut ke authority yang sama.



## UPDATE — Kategori Page: 4 Master Menu Tabs
**30 September 2026**

The Owner Kategori management page now uses exactly two local tabs:

Kategori | Rasa | Kelengkapan | Level

Each tab renders its master-reference list as compact cards. Every card exposes an overflow action menu with Edit and Hapus.

Kategori uses /admin/categories. Rasa, Kelengkapan, and Level use /admin/menu/components/:type.

Kelengkapan is the reusable multi-select detail vocabulary for Product Master. Level is the reusable single-select customer indicator vocabulary. When a brand has no Level master rows, the system provisions the standard values 1 — Tidak Pedas, 2 — Pedas Sedang, and 3 — Pedas Banget; existing custom Level rows are never overwritten.

The Product Master editor remains the assembly workspace: Kategori is required; Rasa is optional and single-select; Kelengkapan is optional and multi-select; Level is optional and single-select. POS selling options remain a separate POS-only configuration, not part of the Customer PWA composition.

The Category page is the central master-reference management page for all four vocabularies.