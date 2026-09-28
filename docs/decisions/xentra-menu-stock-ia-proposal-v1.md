# Xentra Merchant Menu & Stock IA Proposal v1

**Status:** 🔒 LOCKED — IMPLEMENTATION CONTRACT  
**Date:** 2026-09-29  
**Scope:** Merchant App, branch-scoped daily operations

## 1. Purpose

Define the Xentra-specific information architecture for Menu and Stock after the UI/source audit.

This document is an IA proposal, not an implementation contract yet. Backend/domain authority remains unchanged.

## 2. Shared UX rules

Both surfaces inherit the approved Merchant Home grammar:

- mobile-first;
- branch context always visible;
- persistent Merchant bottom navigation;
- card/list-first on mobile;
- touch-friendly controls;
- progressive disclosure;
- one clear primary action per item;
- calm status language;
- reuse existing Xentra primitives before creating new ones.

GoBiz / GrabMerchant remain visual ergonomics references only.

## 3. Menu IA

### 3.1 Primary job

The Branch Manager should be able to answer quickly:

1. Menu apa yang sedang dijual?
2. Apa yang sedang tidak tersedia?
3. Produk mana yang perlu diubah?
4. Bagaimana kategori dan tampilan menu cabang?
5. Apakah harga/field cabang berbeda dari master?

### 3.2 Proposed screen structure

**Header**
- title: Menu;
- active branch context;
- search;
- optional compact action for adding/adopting a product.

**Attention strip**
- only when actionable exceptions exist;
- examples: unavailable items, missing assortment, or other supported operational exceptions;
- do not turn it into a permanent KPI wall.

**Category navigation**
- horizontal category chips;
- "Semua" first;
- category selection filters the product list;
- category management is progressive disclosure rather than a second top-level navigation.

**Product list**
Each row/card exposes:
- image;
- product name;
- category context;
- effective branch price;
- availability state;
- one primary fast action: availability toggle;
- overflow/detail action for deeper edits.

**Product detail / edit sheet**
Progressive disclosure for:
- name/description override where authorized;
- image;
- category memberships;
- price according to Pricing Policy;
- availability;
- options/variations where the existing catalog contract supports them.

**Catalog adoption flow**
When a master product is not yet adopted:
- discover/search master product;
- select product;
- choose branch categories;
- resolve price through existing Pricing Policy;
- adopt;
- return to Menu list with mutation feedback.

### 3.3 Menu boundaries

Menu availability is not physical inventory.

Changing availability:
- changes branch catalog availability only;
- must not fabricate or mutate stock;
- must remain branch-scoped and RBAC-authorized.

Stock changes:
- do not automatically toggle Menu availability.

### 3.4 Category rules

Categories remain branch-scoped presentation/catalog structures where the existing contract defines them.

The IA supports:
- create;
- rename;
- image;
- reorder;
- assign product to multiple categories.

Avoid a separate "Category Management" destination unless the implementation proves it is necessary.

## 4. Stock IA

### 4.1 Primary job

The Branch Manager should be able to answer:

1. Produk mana yang benar-benar punya stok tercatat?
2. Mana yang menipis?
3. Mana yang habis?
4. Mana yang belum dilacak?
5. Saya perlu melakukan penyesuaian apa?

### 4.2 Proposed screen structure

**Header**
- title: Stock;
- active branch context;
- search.

**Stock summary**
Compact, action-oriented counts:
- Dilacak;
- Menipis;
- Habis;
- Belum dilacak.

Do not treat NULL/untracked as Habis.

**Status filters**
- Semua;
- Menipis;
- Habis;
- Belum dilacak.

Optional additional filters can be introduced only when a real operational job requires them.

**Stock list**
Each row/card:
- product name;
- current quantity;
- unit if the domain supports a unit;
- low-stock threshold when configured;
- status;
- last movement context when available;
- adjustment action.

The current UI's price column is not a primary Stock concern and should not be retained unless a concrete operational reason is demonstrated.

### 4.3 Adjustment interaction

Use an existing Merchant modal/sheet primitive.

The interaction should show:

1. product;
2. current stock;
3. movement type;
4. quantity delta;
5. resulting stock preview when safely calculable;
6. reason/notes;
7. confirm action.

The user enters a **movement**, not an arbitrary replacement value, because the Inventory domain is ledger-based.

For untracked stock:
- the UI must clearly explain that the first adjustment establishes the tracked stock state;
- it must not label NULL as zero;
- exact transition semantics must follow the reconciled Inventory contract.

### 4.4 History

Inventory movement history is an authoritative domain concept and is immutable.

The IA should reserve a progressive-disclosure entry point such as:
- "Riwayat stok" from Stock;
- or item-level "Riwayat".

Implementation must first use the existing authoritative movement ledger/API. Do not create a second history store.

### 4.5 Stock boundaries

Stock must not:
- edit product master data;
- edit branch categories;
- change Menu availability automatically;
- create a second inventory ledger;
- invent stock for a catalog assignment;
- treat a missing stock record as zero without explicit domain semantics.

## 5. Shared interaction inventory

Menu and Stock should reuse:

| Need | Existing source |
|---|---|
| Toast | merchant-shared/js/shared.js + shared.css |
| Action/overflow menu | merchant-shared/js/action-menu.js |
| Image crop | merchant-shared/js/crop-editor.js |
| Toggle | merchant-shared/css/dashboard.css |
| Modal/overlay | merchant-shared/css/dashboard.css |
| Merchant sheet patterns | merchant-shared/css/dashboard.css |
| Existing category/product catalog behavior | merchant-app/menu.js + branch-catalog-ui.js |

New primitives require an explicit audit finding that no existing primitive is suitable.

## 6. Implementation blockers before coding

### Blocker A — branch assignment must not fabricate stock

Current repository evidence conflicts:

- DATABASE_SCHEMA.md says catalog assignment is not inventory and API-created assignments keep stock NULL.
- tests/apiEndpoints.test.js asserts stock stays NULL after assignment.
- admin-branch-catalog.js currently writes stock = 100 during adoption.

This must be reconciled before the new Stock UI is implemented.

### Blocker B — null stock presentation

Current stock.js uses Number(it.stock), which can collapse NULL into 0 in the UI.

The new IA explicitly requires:
**NULL = Belum dilacak**, not Habis.

## 7. Definition of Done for IA review

The IA can be locked when review confirms:

- Menu and Stock have separate jobs;
- availability and physical stock are clearly separated;
- branch scope is obvious;
- untracked stock is represented honestly;
- frequent Branch Manager actions are one/two taps away;
- deeper editing uses progressive disclosure;
- no duplicate UI framework is introduced;
- existing Xentra primitives are reused;
- no backend/domain authority is duplicated in the UI.

**PROPOSAL — review this IA before implementation.**


## Contract Reconciliation Update

The previously identified catalog-adoption stock blocker is resolved.

Catalog adoption no longer fabricates physical stock, and the regression suite now asserts that a newly adopted branch product keeps stock = NULL until an Inventory operation records stock.

The IA requirement remains:
**NULL = Belum dilacak**, never Habis.

**LOCKED — IA approved for implementation. Backend/domain contracts remain authoritative.**


## 🔒 LOCKED ADDENDUM — Menu Hierarchy & Navigation v2
**Date: 29 September 2026**

The Menu module hierarchy is now locked as a navigation relationship, not a copy of GoBiz IA.

### Canonical Menu hierarchy

Menu → Kategori dan menu → Pilih kategori → Daftar menu dalam kategori → Pilih menu → Ubah menu

Category management remains a sibling operation to category browsing: Kategori dan menu → pilih kategori → daftar menu, or Kategori dan menu → ubah kategori.

### Menu module hub

The Merchant App Menu entry point is a module hub with:
- **Kategori dan menu** — implemented and navigable.
- **Variasi menu** — reserved capability; not presented as an active workflow until the underlying Xentra variation contract exists.
- **Jadwal menu** — reserved capability; not presented as an active workflow until the underlying Xentra scheduling contract exists.

This prevents dead-end screens and prevents the UI from inventing unsupported backend capabilities.

### Screen responsibilities

- **Menu**: module entry point, not a giant CRUD table.
- **Kategori dan menu**: branch-scoped category index.
- **Category detail**: menu items belonging to the selected branch category.
- **Ubah kategori**: edits the category entity only.
- **Ubah menu**: edits the menu item / branch override through the existing progressive catalog override flow.
- **Stock** remains a separate bottom-navigation surface and remains the physical inventory authority.

### Navigation behavior

- Menu opens at the Menu hub.
- Kategori dan menu opens the category index.
- Selecting a category opens its menu list.
- Selecting/editing a menu uses the existing progressive catalog override flow.
- Back navigation returns one level at a time.
- Category membership remains multi-category; a menu may therefore appear in more than one category.
- Fast availability remains available at the menu-item level.
- No new backend authority or second state machine is introduced.

### GoBiz reference boundary

The supplied GoBiz screens are used only for native-feeling hierarchy, touch ergonomics, list/divider treatment, progressive disclosure, and the visual relationship between category and item screens.

They do not define Xentra business rules, branch scope, Catalog authority, Inventory authority, or unsupported capabilities.

**LOCKED — Menu hierarchy v2 is now the implementation contract for Merchant App Menu.**
