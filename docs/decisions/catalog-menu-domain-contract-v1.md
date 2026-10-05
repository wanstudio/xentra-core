# Xentra — Catalog / Master Category / Master Menu Contract v1

Status: LOCKED / AUTHORITATIVE
Effective: 2026-10-05
Scope: Owner Catalog UI, Master Menu, Master Category, Item/stock identity, Customer PWA resolution, Branch Menu adoption, API/service/schema/tests

## 1. Canonical Catalog Information Architecture

    Catalog
    ├── Master Menu
    └── Master Category
        ├── Category
        ├── Rasa
        └── Item

Catalog has exactly two top-level areas: Master Menu and Master Category.
Master Category contains exactly Category, Rasa, and Item.
Sub Category, when used by the food taxonomy, belongs inside the Category domain and is not a separate top-level Catalog area.
Category, Rasa, and Item are independent master areas; they do not form a parent-child hierarchy with one another.
Do not introduce Produk Master, Menu Cabang, Kelengkapan, Level, or any additional top-level Catalog node as a synonym for these areas.
Owner forward UI must use Item, not Product, when referring to the atomic internal composition/stock unit.

## 2. Master Category Ownership

### Category
Category classifies and groups Menus.
Sub Category, when used, belongs to exactly one Category and is managed inside the Category domain.
Category/Sub Category is customer-facing taxonomy context.
Category and Sub Category do not own Rasa, Item, price, stock, or Menu composition.

### Rasa
Rasa is reusable and optional.
Rasa is independent from Category/Sub Category and may be reused by many Menus.
Rasa is brand-scoped.

### Item
Item is the atomic internal composition and inventory identity used by Menu.
Item owns Item identity, Item name, optional SKU/stock-managed state, internal description/media where supported, and lifecycle.
Item does not own customer Menu title, Menu taxonomy, Menu Rasa, Menu price, or Branch Menu adoption.
Legacy physical Product names/columns may remain during migration, but forward business terminology is Item.

## 3. Menu Ownership

Menu is the commercial/customer-facing entity.
Menu owns Category/Sub Category context, optional Rasa, optional Pedas presentation, Menu presentation media, selling price, lifecycle status, immutable Menu ID, and one-or-many Item composition.

Menu does not become a different business entity based on Item count.
There is no forward business concept called Menu Satuan, Menu Paket, Package Menu, SINGLE Menu, or PACKAGE Menu.
Legacy menu_type, package_name, SINGLE/PACKAGE routes, and equivalent storage may remain temporarily for migration compatibility only.

## 4. Menu Identity and Customer Presentation

Canonical Menu identity for the current food model:

    Category + Sub Category + Rasa

Rules:
- Category and Sub Category establish taxonomy context.
- Rasa is part of identity when present; duplicate protection must be NULL-safe.
- The same Category/Sub Category/Rasa combination must not create duplicate active canonical Menus within a Brand.

Customer presentation:

    Title    → Sub Category
    Subtitle → Rasa when configured and customer-visible
    Category → grouping/filter context

Rasa named Original is the baseline and is not shown as the customer subtitle.
The Menu editor must not replace this identity with an arbitrary free-text customer title.

## 5. Menu Composition

    Master Menu
       ↓
    Menu
       ↓
    Menu Items
       ├── Item A × quantity
       ├── Item B × quantity
       └── Item C × quantity

Rules:
- A Menu may contain one or many Items.
- One Item may be reused by many Menus.
- The same Item appears at most once in one Menu composition; repeated units use quantity.
- Quantity is a positive integer and belongs to the Menu composition.
- A one-Item Menu is valid.
- A multi-Item Menu is valid.
- Item count never creates a Package entity.
- Promotion and cart combinations never create a Package entity.

Customer boundary:
- Item is internal implementation data.
- Customer PWA must not expose Item name as a Menu field, Item SKU, stock-managed flag, internal Item ID, or raw internal composition metadata.

## 6. Master Menu UI Contract

Master Menu is the Owner authoring area for the commercial Menu.
The editor must provide:
- Category/Sub Category selection from Master Category.
- Optional Rasa selection from Master Category.
- One-or-many Item composition rows.
- Optional Pedas checkbox plus horizontal scale.
- Required Menu selling price.
- Menu presentation media.
- Lifecycle status.

The editor must not introduce a free-text customer title that bypasses Category/Sub Category identity.
Inline creation may be provided without leaving the editor:
- + Category creates Category.
- + Sub Category creates a Sub Category under the selected Category.
- + Rasa creates Rasa.
- + Item creates Item.
Inline creation must not silently create legacy Product, Complement, Flavor, or Level entities as replacements.

## 7. Pedas / Spice Contract

Canonical interaction:

    [ ] Level Pedas

    unchecked
    → horizontal scale hidden/inactive
    → no Pedas indicator

    checked
    → horizontal scale active
    → Owner selects a position

Pedas is not a dropdown.
The UI must not define business meanings such as Level 1 = not spicy, Level 2 = spicy, etc.
A numeric storage value may represent the horizontal position internally.
spice_enabled is the explicit authoritative toggle.
When disabled, no active Pedas presentation is shown.

## 8. Selling Price

Selling price belongs to Menu.
The same Item may participate in multiple Menus with different selling prices.
Item stock identity and Menu price are separate authorities.
Historical transactions must preserve the effective transaction price.

## 9. Menu Media

Menu image is Menu presentation media.
Do not define the Menu image as the first Item image.
Do not silently substitute Item media as the canonical Menu-media rule.
Temporary fallback for legacy preview/migration is technical fallback only.
New Menu image upload uses the canonical Media Engine.

## 10. Master Category UI Contract

Master Category contains exactly:
    Category
    Rasa
    Item

Category may contain/manage its Sub Category structure.
The presentation may use tabs, cards, segmented navigation, or another UI pattern, but it must not create additional master concepts.

Deletion behavior:
- Do not show destructive Delete when referential integrity makes deletion invalid.
- Use Arsipkan/Nonaktifkan when a referenced master record must be preserved.
- UI wording and backend behavior must agree.
- A normal referenced record must not present Delete and then fail with an avoidable foreign-key error.

## 11. Customer PWA Contract

Customer PWA consumes a resolved Menu View Model.

    Menu ID
    Title        ← Sub Category
    Subtitle     ← Rasa when configured
    Category     ← grouping
    Media        ← Menu presentation
    Selling Price
    Pedas        ← only when enabled
    Availability

Customer PWA must not reconstruct Menu identity from legacy Product/Item fields.
Customer PWA must not depend on menu_type, SINGLE, PACKAGE, package_name, Item SKU, Item stock flags, or raw internal Item/Product names.
Search operates on the resolved Menu View Model:
- Title/Sub Category is searchable.
- Rasa/subtitle is searchable when present.
- Pedas scale is not searchable.
- Item name is not searchable.
- SKU is not searchable.
Search updates while typing.

## 12. Inventory Contract

Item is the inventory identity:

    Item
    ├── SKU present → stock-managed
    └── SKU absent  → non-stock

Rules:
- SKU presence determines Item stockability.
- Inventory quantity belongs to Branch Inventory.
- Creating Item or assigning SKU does not fabricate stock quantity.
- Selling a Menu consumes the required stock-managed Item quantities.
- All required Item stock validations must be checked atomically before a sale commits.
- Non-stock Items do not constrain availability through stock quantity.

Legacy physical product_id/product tables may remain during migration; forward semantic meaning is Item.

## 13. Branch Adoption

Branch assortment is Menu-authoritative:

    Master Menu
       ↓
    Branch adopts Menu
       ↓
    Branch Menu configuration
       ↓
    Menu resolves Item composition
       ↓
    Branch Item inventory

Branch adoption does not create another Master Menu or another Item.
Branch operational availability is distinct from Master Menu lifecycle.
Branch-local categories are separate from Master Category.
Any supported Branch price override belongs to Branch Menu configuration, not Item.
Menu Cabang is a branch operational/selling surface, not a Master Catalog area.

## 14. Legacy Compatibility Boundary

Legacy concepts may remain temporarily as compatibility/migration evidence:
- products / product_id
- sub_categories
- menu_titles
- menu_type
- package_name
- SINGLE/PACKAGE endpoints
- Complement/Kelengkapan
- old Level master data
- old Product-centric Catalog routes.

These are not forward business authorities.
Forward code must not use legacy fields as a second source of truth.
Ambiguous legacy records must be marked for review rather than guessed.

## 15. Forward API / Service Shape

Conceptual forward Menu create/update:

    {
      category_id: ... ,
      sub_category_id: ... ,
      rasa_id: null,
      spice_enabled: false,
      spice_level: 0,
      selling_price: 25000,
      status: DRAFT,
      media_id: null,
      items: [
        { item_id: ..., quantity: 1 }
      ]
    }

sub_category_id belongs to the selected Category.
item_id is the forward semantic name even when the physical legacy column remains product_id.
spice_level is only the internal horizontal-scale position.
spice_enabled is explicit and authoritative.
No menu_type or package_name is required by the forward contract.
Server-side authorization, brand ownership, lifecycle, composition validity, inventory integrity, persistence, and audit remain authoritative.

## 16. Definition of Done

UI:
- Catalog shows exactly Master Menu and Master Category.
- Master Category shows exactly Category, Rasa, Item, with Sub Category under Category.
- No Produk Master alias is used for Item.
- No Catalog top-level Menu Cabang node is used as a Master Menu synonym.
- Menu editor selects Category/Sub Category/Rasa and does not replace identity with free-text customer title.
- Menu editor supports one-or-many Item composition.
- Pedas is checkbox + horizontal scale.
- Menu media is a Menu concern.
- Delete/archive semantics match referential constraints.

Backend:
- Menu accepts one-or-many Items.
- Menu has no forward SINGLE/PACKAGE subtype requirement.
- Menu identity uses Category + Sub Category + Rasa.
- Menu price is Menu-owned.
- Item SKU/stockability is Item-owned.
- Inventory consumption resolves from Menu Items.
- Customer resolver does not expose internal Item identity.
- Legacy paths are compatibility-only.

Tests:
- Tests assert the exact Catalog information architecture.
- Tests cover one-Item and multi-Item Menus.
- Tests cover Pedas enabled/disabled behavior.
- Tests assert internal Item/SKU/stock fields are absent from customer payload.
- Active tests do not depend on removed/superseded contract files.
- Full CI must pass on the proposal branch before promotion.

## 17. Explicit Prohibitions

Do not reintroduce as forward concepts:
    Produk Master
    Menu Cabang as Master Menu
    Kelengkapan as a Master Category area
    Master Flavor
    Master Level
    Judul as a separate Master Category area
    free-text Nama Menu as a replacement for taxonomy identity
    Menu Satuan
    Menu Paket
    Package Menu
    menu_type SINGLE
    menu_type PACKAGE
    package_name
    Product as the Owner UI term for Item
    Item SKU in Customer PWA
    Item stock flag in Customer PWA

Legacy storage can remain temporarily, but forward UI and business logic must not depend on it.

## 🔒 KOREKSI — Judul menggantikan Sub Category, Rasa dekoratif
**Tanggal: 2026-10-05, koreksi dari pemilik contract. Menggantikan §1, §2, §4, §10, §17.**

### Model forward yang benar

    Catalog
    ├── Master Menu
    └── Master Category
        ├── Category   ← pengelompokan saja (bukan parent)
        ├── Judul      ← master, judul customer
        ├── Rasa       ← master, opsional/dekoratif
        └── Item       ← unit atomic/stock internal

### Aturan

1. Master Category berisi tepat empat tab: **Category | Judul | Rasa | Item**.
2. **Sub Category dihapus** sebagai konsep forward — dari UI, wiring, API, dan database.
   Perannya digantikan Judul. (Boleh diganti atau dibuat ulang; pilihannya teknis.)
3. **Judul** adalah master Brand-scoped dengan ON/OFF, edit, dan delete — persis pola Category
   dan Rasa. Judul **bukan child Category** dan **bukan field bebas**.
4. **Category hanya pengelompokan**, bukan parent dari Judul. Hubungan Menu ↔ Judul sama
   dengan hubungan Menu ↔ Rasa (master yang direferensikan Menu).
5. Saat Category dipilih di editor Menu, **dropdown Judul direkomendasikan berdasarkan
   Category** — mis. Category "Udang" menampilkan Judul yang berkaitan dengan udang, bukan
   ayam atau minuman. Bila tidak ada Judul yang cocok, seluruh Judul tetap dapat dipilih
   supaya Menu tidak pernah buntu.
6. Memilih/menambah Judul dan Rasa memakai pola **dropdown + tombol `[ + ]`**; `[ + ]` membuka
   bottom sheet master-inline dan hasilnya langsung menjadi opsi dropdown.
7. **Rasa opsional** (boleh kosong) dan bersifat dekoratif.
8. **Judul adalah judul customer.** Bila Rasa diisi, customer melihat Judul di baris atas dan
   Rasa di baris bawah dengan **satu ukuran font dan satu warna** — bukan subtitle kecil
   berwarna redup. Contoh: Judul "Ayam Geprek" + Rasa "Sambal Ijo" → terbaca
   "Ayam Geprek Sambal Ijo".
9. Anti-duplikat Menu: **(Category + Judul + Rasa)** dalam satu Brand, dengan Rasa kosong
   diperlakukan sebagai satu nilai tersendiri (NULL-safe).
10. Judul **wajib** saat Menu disimpan, karena tanpa Judul customer tidak punya judul.
11. Media Menu tetap milik Menu (bukan gambar Item pertama).
12. **Validasi bergantung status** (hanya Category + Judul yang selalu wajib):
    - **DRAFT** — wajib: Category + Judul. Harga, Item, Rasa, Pedas, dan Media boleh kosong.
      Menu boleh disusun bertahap.
    - **ACTIVE** — wajib: Category + Judul + **harga** + **minimal 1 Item**. Alasannya Menu
      ACTIVE tampil di customer PWA dan harus bisa dibeli; Menu tanpa harga/Item tidak boleh
      dipublikasikan.
    - Transisi DRAFT → ACTIVE wajib melewati validasi ACTIVE di server (bukan hanya di UI).
    - Semua field non-wajib lain (Rasa, Pedas, Media) tetap boleh kosong di status apa pun.

13. **Kontrol stok ada di domain Item, bukan domain Stok** (menguatkan §12):
    - Tab Item: kolom SKU berupa checkbox **"Kelola stok (pakai SKU)"**.
      Dicentang → textbox SKU muncul dan wajib diisi. Tidak dicentang → textbox tersembunyi dan
      SKU dikosongkan, Item menjadi non-stock.
    - SKU ada → Item stock-managed dan ikut inventaris cabang; SKU kosong → non-stock dan tidak
      membatasi ketersediaan Menu.
    - Angka dan pergerakan stok tetap milik domain Stok/Cabang (`branch_product_inventory`).
      Pola ini sama dengan praktik umum (Shopify "Track quantity", Square/Lightspeed/Toast
      "Track inventory"): kebijakan di Item, kuantitas per lokasi/cabang.
    - **Guard**: toggle tidak boleh dimatikan selama masih ada stok > 0 di cabang mana pun.
      Stok harus dinolkan/dihabiskan lebih dulu. Server menolak (bukan hanya UI) dan UI
      menjelaskan alasannya, supaya tidak ada state "ada stok tapi Item tidak dihitung".

### Cakupan pekerjaan

UI, wiring, API, dan database wajib konsisten dengan koreksi ini. Kode, route, dan test lama
yang masih bertumpu pada Sub Category atau `menu_titles` legacy tidak menjadi acuan.

## 18. Precedence and Promotion Gate

This document is the forward Catalog/Menu authority.
Legacy code and passing legacy tests do not override this contract.
Newer explicit business decisions supersede this contract only when explicitly recorded.
Ambiguity must be reviewed, never silently guessed.

Promotion to main is blocked until UI, backend, Customer PWA, tests, CI, migration/quarantine, and runtime verification all agree with this contract.