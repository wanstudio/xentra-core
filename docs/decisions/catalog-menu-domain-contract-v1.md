# Xentra — Catalog / Master Category / Master Menu Contract v1

Status: LOCKED / AUTHORITATIVE
Effective: 2026-10-05
Applies to: Owner Catalog UI, Menu authoring, Item/stock identity, Customer PWA Menu resolution, Branch Menu adoption, related API/service/schema/tests
Production rule: This contract defines forward behavior. Legacy fields/routes may remain only as compatibility or migration paths and must not become a second source of truth.

## 1. Canonical Catalog Information Architecture

Catalog has exactly two top-level areas:

    Catalog
    ├── Master Menu
    └── Master Category
        ├── Category
        ├── Judul
        ├── Rasa
        └── Item

Rules:
- Master Menu is a top-level Catalog area.
- Master Category is a top-level Catalog area.
- Category, Judul, Rasa, and Item are four independent Master Category vocabularies.
- They are not a parent-child hierarchy with one another.
- Do not introduce additional Catalog top-level nodes named Produk Master, Menu Cabang, Kelengkapan, Level, or synonyms for these concepts.
- Branch selling configuration is a separate Branch/assortment surface, not a third Master Catalog area.
- User-facing terminology must use Item, not Product, when referring to the atomic internal composition/stock unit.

Canonical UI labels:
- Master Menu
- Master Category
- Category
- Judul
- Rasa
- Item

## 2. Entity Ownership

### Category
Category is Master Category vocabulary used to classify and group Menus.
Category does not own Judul, Rasa, Item, price, stock, or Menu composition.
Category is brand-scoped.

### Judul
Judul is a reusable Master Category vocabulary for the customer-facing Menu title.
Judul is independent from Category.
A Menu selects a Judul; it does not replace Master Judul with a free-text customer title.
Judul is brand-scoped.

### Rasa
Rasa is a reusable optional Master Category vocabulary.
Rasa is independent from Category and Judul.
Rasa may be reused by many Menus.
Rasa is brand-scoped.

### Item
Item is the atomic internal composition/stock identity used by a Menu.
Item owns Item identity, Item name, optional SKU/stock-managed state, internal description/media where supported by the Item domain, and lifecycle.
Item does not own customer Menu title, Menu Category, Menu Rasa, Menu price, or Branch Menu adoption.
The Owner UI must use Item terminology. Legacy Product columns/classes may remain internally during migration, but that does not change forward business vocabulary.

## 3. Menu Ownership

Menu is the commercial/customer-facing entity.
A Menu owns immutable Menu ID, selected Category, selected Judul, optional Rasa, optional Pedas presentation, Menu media/presentation, selling price, lifecycle status, and composition of one or many Items.
A Menu does not become a different business entity based on the number of Items it contains.
There is no forward Menu subtype called Menu Satuan, Menu Paket, or Package Menu.
There is no forward menu_type=SINGLE or menu_type=PACKAGE business rule.
Legacy menu_type, package_name, SINGLE/PACKAGE routes, and equivalent fields may remain temporarily for migration compatibility only.

## 4. Menu Composition

Canonical relation:
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
- The same Item may not appear more than once in the same Menu composition; repeated use is represented by quantity.
- Quantity is a positive integer.
- Quantity is part of the Menu composition and is not inferred from cart quantity.
- A Menu with one Item is valid.
- A Menu with multiple Items is valid.
- Composition count does not create or imply a Package entity.
- Promotion does not create a Package entity.
- Cart combinations do not create a Package entity.

### Customer boundary
Item is internal.
Customer PWA must never expose Item name as a customer-facing Menu field, Item SKU, Item stock-management flag, internal Item ID, or internal composition metadata that is not explicitly part of Menu presentation.
The fact that a Menu contains Items is an implementation detail unless a future explicit customer-facing feature says otherwise.

## 5. Menu Authoring UI

Master Menu editor must expose these commercial fields consistently:
    Judul       → select from Master Category / Judul
    Category    → select from Master Category / Category
    Rasa        → optional select from Master Category / Rasa
    Item        → one or more internal composition rows
    Pedas       → optional checkbox + horizontal scale
    Harga Jual  → required Menu field
    Media       → Menu presentation media
    Status      → lifecycle

The Menu editor must not replace Judul with a free-text Nama Menu field.

The Menu editor may offer inline creation of missing Master dependencies, but the created entity must belong to the proper Master Category vocabulary:
- + Category creates Category.
- + Judul creates Judul.
- + Rasa creates Rasa.
- + Item creates Item.
Inline creation must not create hidden legacy entities that bypass the Master Category contract.

## 6. Pedas / Spice UI Contract

Pedas is optional Menu presentation.
Canonical interaction:
    [ ] Level Pedas
    unchecked
    → horizontal scale hidden / inactive
    → no Pedas indicator in preview/customer presentation
    checked
    → horizontal scale becomes active
    → Owner selects a position on the scale

Rules:
- Pedas is not a dropdown.
- The UI must not define business vocabulary such as Level 1 = tidak pedas, Level 2 = pedas, and so on.
- The horizontal scale position may be stored numerically internally.
- The checkbox is the authoritative indication that Pedas presentation is enabled.
- Unchecked means no active Pedas presentation.
- Existing numeric storage such as 0–4 is an internal scalar only; it must not be presented as named business levels unless a future contract explicitly defines that vocabulary.

## 7. Selling Price

Selling price belongs to Menu.
    Item
    → internal atomic identity / optional stock
    Menu
    → customer-facing presentation
    → selling price

Rules:
- Item does not own canonical Menu selling price.
- The same Item may participate in multiple Menus with different selling prices.
- Menu selling price is stored independently from Item stock identity.
- Historical orders must retain the effective transaction price.

## 8. Menu Media

Menu presentation media belongs to the Menu presentation boundary.
Rules:
- Menu image must not be defined as the first Item image.
- Menu image may not be silently replaced by Item media as the canonical business rule.
- Any fallback used temporarily for migration or preview must be explicitly treated as technical fallback, not Menu identity.
- New Menu image upload must use the canonical Media Engine.
- Do not create a second upload path for Menu images.

## 9. Master Category UI

Master Category is one Owner workspace containing the four independent vocabularies:
    Master Category
    ├── Category
    ├── Judul
    ├── Rasa
    └── Item

The UI may use tabs, segmented navigation, cards, or another presentation pattern, but the information architecture must remain exactly these four concepts.

### Delete/archive behavior
- A master entity that is referenced by other data must not show a destructive Delete action when deletion is invalid.
- Where referential integrity requires preservation, the UI should expose Arsipkan / Nonaktifkan semantics.
- The UI label and backend behavior must agree.
- Do not present Delete and then return a foreign-key failure for a normal referenced record.
Category, Judul, Rasa, and Item must each have a clear lifecycle operation appropriate to their references.

## 10. Customer PWA Contract

Customer PWA receives a resolved Menu View Model.
Conceptual customer payload:
    Menu ID
    Title        ← Judul
    Subtitle     ← Rasa when configured and customer-visible
    Category     ← grouping
    Media        ← Menu presentation
    Selling Price
    Pedas presentation when enabled
    Availability

The Customer PWA must not reconstruct Menu identity by reading arbitrary legacy Product/Item fields.
The Customer PWA must not depend on menu_type, SINGLE, PACKAGE, package_name, Item SKU, Item stock flag, or raw internal Product/Item names.
Search uses the resolved Menu View Model.
Current search scope:
- Title/Judul is searchable.
- Rasa/subtitle is searchable when present.
- Pedas scale is not searchable.
- Item name is not searchable.
- SKU is not searchable.
Results update while typing; no separate submit action is required for basic search.

## 11. Inventory Contract

Item is the inventory identity.
    Item
    ├── SKU present
    │   └── stock-managed
    └── SKU absent
        └── non-stock

Rules:
- SKU presence means the Item is stock-managed.
- SKU absence means the Item is non-stock.
- Inventory quantity belongs to Branch Inventory.
- Creating an Item must not fabricate stock quantity.
- Assigning a SKU must not fabricate stock quantity.
- A Menu consumes Item stock according to its Menu Items quantities.
- For a Menu containing multiple stock-managed Items, all required stock validations must be evaluated atomically before committing a sale.
- Non-stock Items do not constrain availability through stock quantity.
Legacy database tables may still use the physical column name product_id during migration. Forward business meaning is Item.

## 12. Branch Adoption

The customer-facing assortment boundary is Menu.
    Master Menu
       ↓
    Branch adopts Menu
       ↓
    Branch Menu configuration
       ↓
    Menu resolves Item composition
       ↓
    Branch Item inventory

Rules:
- Branch adoption is Menu-authoritative.
- Branch does not create a new Master Menu by copying it.
- Branch adoption does not create a new Item.
- Item inventory remains Item-authoritative.
- Branch-local categories/assortment are separate from Master Category.
- A Branch may make an adopted Menu operationally unavailable without changing the Master Menu lifecycle.
- Branch-level price override, where supported, belongs to Branch Menu configuration, not Item.
Menu Cabang is not a Master Category or Master Menu synonym. It is a branch operational/selling surface.

## 13. Legacy Compatibility Boundary

Legacy implementation may contain products, product_id, menu_type, package_name, sub_categories, menu_titles, old Product-centric Catalog routes, SINGLE/PACKAGE endpoints, and old Complement/Kelengkapan and Level master components.
These are compatibility/migration evidence only unless explicitly adopted into the new contract.
Forward code must not use legacy fields as a second authority.
Migration direction:
    legacy data
        ↓
    migration / compatibility input
        ↓
    canonical Menu + Master Category + Item model
Ambiguous legacy data must be marked for review rather than guessed.

## 14. API / Service Boundary

Forward Menu create/update conceptually contains:
    {
      category_id: ... ,
      title_id: ... ,
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

title_id refers to Master Category → Judul.
item_id is the forward semantic name even if the physical DB column remains product_id temporarily.
spice_level is an internal scalar position only.
spice_enabled is explicit and authoritative.
No menu_type or package_name field is required by the forward contract.
The server remains authoritative for brand ownership, reference ownership, lifecycle, composition validity, stock integrity, authorization, persistence, and audit.

## 15. Tests and Definition of Done

### UI
- Catalog shows exactly Master Menu + Master Category.
- Master Category exposes Category, Judul, Rasa, Item.
- No fake Master Kategori route is used for the Item/legacy Product editor.
- No Catalog top-level Menu Cabang node is introduced as a synonym for Master Menu.
- Menu editor selects Master Judul rather than free-text customer title.
- Menu editor supports one-or-many Item composition.
- Pedas uses checkbox + horizontal scale.
- Menu media is not derived by business rule from first Item media.
- Delete/archive semantics match backend referential rules.

### Backend
- Menu does not require SINGLE/PACKAGE semantics.
- Menu accepts one-or-many Items.
- Menu price belongs to Menu.
- Item SKU/stockability belongs to Item.
- Menu resolves Item composition for inventory consumption.
- Customer resolver does not expose internal Item identity.
- Legacy paths remain isolated compatibility-only.

### Tests
- Tests encode this contract rather than obsolete SINGLE/PACKAGE or Complement/Level/legacy Product UI assumptions.
- Removed files are not referenced by active tests.
- UI tests assert the exact Catalog information architecture.
- Contract tests cover one-item and multi-item Menus.
- Contract tests cover Pedas enabled/disabled behavior.
- Customer boundary tests assert Item/SKU/stock fields are absent.
- Full CI must pass on the proposal branch before promotion.

## 16. Explicit Prohibitions

Do not introduce or restore these as forward business concepts:
    Produk Master        — not a Catalog synonym
    Menu Cabang          — not a Master Menu synonym
    Kelengkapan          — not a Master Category vocabulary
    Master Flavor        — not the replacement name for Rasa
    Master Level         — not a Master Category vocabulary
    Nama Menu free-text  — not a replacement for Master Judul
    Menu Satuan          — forbidden as a forward business concept
    Menu Paket           — forbidden as a forward business concept
    Package Menu         — forbidden as a forward business concept
    menu_type SINGLE     — forbidden as a forward business rule
    menu_type PACKAGE    — forbidden as a forward business rule
    package_name         — forbidden as a forward business rule
    Product as UI term for Item — forbidden in Owner forward UI
    Item SKU in PWA      — forbidden
    Item stock flag in PWA — forbidden
Legacy storage may keep some of these temporarily, but forward UI and business logic must not depend on them.

## 17. Contract Precedence

When code, tests, older proposals, screenshots, or legacy terminology conflict with this document:
1. This locked contract is the forward Catalog/Menu authority.
2. More recent explicit business decisions may supersede this document only when explicitly recorded.
3. Legacy code is not evidence that a legacy rule remains valid.
4. A passing legacy test does not override this contract.
5. Any migration ambiguity must be reviewed; never silently guessed.

Promotion gate: No promotion of the new Catalog/Menu implementation to main until UI, backend, Customer PWA, tests, CI, migration/quarantine, and runtime verification all agree with this contract.