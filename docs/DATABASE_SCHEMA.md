# Xentra Core — Database Schema Specification

**Database Standard:** ANSI SQL Compliant (Compatible with MySQL 8.0+, PostgreSQL 14+, SQLite 3)

**FORWARD CANONICAL SCHEMA — PROPOSAL BRANCH / 2026-10-03**

This proposal branch introduces and validates the Product → Menu → Inventory boundary.
The legacy tables and columns described later in this file remain physical compatibility
storage until consumer migration is complete. They must not be interpreted as the forward
customer-facing source of truth.

Forward authority:

```text
products
  = atomic reusable Product + optional SKU

menus
  = customer-facing Menu Satuan / Menu Paket + selling price + taxonomy

menu_items
  = fixed Product composition

branch_menus
  = Branch adoption + daily Menu availability + optional Branch Menu price override

branch_menu_categories
  = Branch-local merchandising membership

branch_product_inventory
  = Branch Product stock quantity

inventory_movements
  = immutable stock mutation ledger
```

For canonical orders, `order_items.menu_id`, `order_items.menu_type`, and
`order_items.component_snapshot` are the additive transaction references. The legacy
`product_id/product_name` columns remain compatibility fields during migration.

Canonical business rules are defined in
`docs/proposals/xentra-taxonomy-composed-menu-v1.md`. That file is authoritative for
the target semantics while this branch is under construction.

---

## 1. Tenancy & Hierarchy Tables

> **Implementation note (2026-10-08):** the live SQLite schema still contains legacy
> `branch_products` assignment/compatibility storage and `branch_product_inventory` migration
> storage because stock migration is staged. For the forward Product → Menu → Inventory model,
> `branch_menus` owns Menu adoption and the valuation-bearing Product Stock authority is
> `product_stock_balances` at a Stock Location.
> availability/price override, while `branch_product_inventory` owns Product stock quantity.
> `branch_products.stock`, `branch_products.is_available`, legacy snapshot/override fields,
> and legacy branch-price fields are compatibility data only until consumer migration is
> completed. Inventory mutations still append to the immutable `inventory_movements` ledger.
> The physical schema may therefore contain both generations during the migration window, but
> they must never be treated as two competing authorities.

### `organizations`
Master SaaS account / holding organization.
```sql
CREATE TABLE organizations (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'pro',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    options_config JSON -- Master Product option groups/options for POS MVP
);
```

### `brands`
Restaurant brand under an organization (e.g. Bangjo).
```sql
CREATE TABLE brands (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    logo_url VARCHAR(500),
    primary_color VARCHAR(20) DEFAULT '#b6ff00',
    custom_domain VARCHAR(255) UNIQUE,
    default_payment_config JSON, -- { provider: "midtrans", server_key: "...", client_key: "..." }
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
```

### `branches`
Physical location / cloud kitchen branch.
```sql
CREATE TABLE branches (
    id VARCHAR(36) PRIMARY KEY,
    brand_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    address_text TEXT NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    phone VARCHAR(30),
    is_active BOOLEAN DEFAULT TRUE,
    is_open_override BOOLEAN DEFAULT TRUE, -- Master manual open/close switch
    payment_config_override JSON, -- Optional branch-level Midtrans credentials
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);
```

### `branch_settings`
Fulfillment availability and delivery pricing configurations.
```sql
CREATE TABLE branch_settings (
    id VARCHAR(36) PRIMARY KEY,
    branch_id VARCHAR(36) UNIQUE NOT NULL,
    delivery_enabled BOOLEAN DEFAULT TRUE,
    pickup_enabled BOOLEAN DEFAULT TRUE,
    dinein_enabled BOOLEAN DEFAULT FALSE,
    free_delivery_km DECIMAL(6, 2) DEFAULT 0.00,
    price_per_km DECIMAL(10, 2) DEFAULT 2500.00,
    max_delivery_radius_km DECIMAL(6, 2) DEFAULT 10.00,
    min_order_amount DECIMAL(12, 2) DEFAULT 0.00,
    operating_hours JSON, -- { delivery: { monday: { open: "08:00", close: "21:00" }, ... } }
    promo_config JSON, -- { enabled: true, min_subtotal: 50000, discount_amount: 10000, label: "Diskon Ongkir" }
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);
```

### `branch_operation_logs` (B1 — append-only operational audit trail)
Records every authorized mutation to a Branch's operational/profile state so the system can
determine what changed, which Branch was affected, who performed it, when, and that
authorization/scope was satisfied. Written by the branch mutation path only; never updated.
```sql
CREATE TABLE branch_operation_logs (
    id VARCHAR(36) PRIMARY KEY,
    branch_id VARCHAR(36) NOT NULL,
    brand_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36),
    action VARCHAR(30) NOT NULL,      -- e.g. 'branch.update', 'branch.create'
    field VARCHAR(40) NOT NULL,       -- e.g. is_active, is_open_override, name, price_per_km
    previous_value TEXT,
    new_value TEXT,
    actor_id VARCHAR(64),
    actor_role VARCHAR(30),
    authorized BOOLEAN DEFAULT TRUE,
    product_id VARCHAR(36),           -- set for product-scoped ops (e.g. availability toggle)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);
```

### `branch_products` (LEGACY compatibility — Product → Branch Assignment)
An explicit historical Product → Branch assignment row retained during migration. In the
forward model it is not the Menu adoption authority and its stock/availability/price fields
must not be used as canonical Menu or Inventory state.
```sql
CREATE TABLE branch_products (
    branch_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    price REAL,                       -- LEGACY branch price compatibility only
    stock INTEGER DEFAULT 100,        -- LEGACY stock compatibility only
    is_available BOOLEAN DEFAULT TRUE, -- LEGACY availability compatibility only
    low_stock_threshold INTEGER DEFAULT 5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (branch_id, product_id),
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
-- Brand-consistency enforcement (C1.3): product.brand_id must equal branch.brand_id.
-- Enforced by BEFORE INSERT/UPDATE triggers raising CROSS_BRAND_ASSIGNMENT_REJECTED.
-- Non-negative physical stock (C2.6): BEFORE INSERT/UPDATE OF stock triggers raise
-- NEGATIVE_STOCK_REJECTED when NEW.stock < 0.
```

### `inventory_movements` (C2 — immutable branch inventory ledger)
Append-only ledger recording every physical-stock mutation at the branch boundary: who,
what (product), which branch, signed quantity, before/after stock, reference and when.
Inventory audit is NOT a financial ledger.
```sql
CREATE TABLE inventory_movements (
    id VARCHAR(36) PRIMARY KEY,
    branch_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    movement_type VARCHAR(30) NOT NULL,  -- purchase_in/transfer_in/return_in/sale_deduction/transfer_out/waste_spoilage/audit_adjustment
    quantity INTEGER NOT NULL,            -- signed
    previous_stock INTEGER NOT NULL,
    current_stock INTEGER NOT NULL,
    reference_id VARCHAR(64),             -- PO number / order number / transfer id
    mutation_id VARCHAR(64),              -- C2 idempotency key (UNIQUE where not null)
    actor_id VARCHAR(64),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
-- UNIQUE partial index on mutation_id guarantees a logical mutation is applied at most once.
```

---

## 2. Menu & Catalog Tables

### Master Catalog (Brand-owned)

The Master Catalog is the owner/brand product library. It contains the master product
identity, metadata, and master categories. Products may exist in the Master Catalog
without being adopted by any Branch.

### `categories` (Master Categories — Brand-owned)
```sql
CREATE TABLE categories (
    id VARCHAR(36) PRIMARY KEY,
    brand_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug TEXT,
    image_url TEXT,
    image TEXT,
    sort_order INT DEFAULT 0,
    is_active INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);
```

### `products` (Master Products — Brand-owned)
```sql
CREATE TABLE products (
    id VARCHAR(36) PRIMARY KEY,
    brand_id VARCHAR(36) NOT NULL,
    category_id VARCHAR(36),
    name VARCHAR(255) NOT NULL,
    slug TEXT,
    description TEXT,
    price DECIMAL(12, 2) NOT NULL,
    regular_price DECIMAL(12, 2),
    pricing_mode TEXT DEFAULT 'lock',
    min_price REAL,
    max_price REAL,
    image_url VARCHAR(500),
    image TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    menu_schema_version INTEGER NOT NULL DEFAULT 1,
    menu_migration_status TEXT NOT NULL DEFAULT 'legacy',
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);
```

### Composed Menu Migration State

The proposal implementation records Product → Menu reconciliation evidence in the actual
`composed_menu_migrations` table created by `ComposedMenuSchema`. This table is the migration
report/evidence boundary during the transition window.

Key state values:

```text
legacy
needs_review
migrated
verified
failed
```

`products.menu_schema_version` / `products.menu_migration_status` are legacy physical fields
where they already exist; they are not the canonical Menu identity or migration ledger for the
proposal implementation. The canonical business state remains `menus` + `menu_items` and the
migration evidence remains `composed_menu_migrations`.

Migration lifecycle: Expand → Migrate → Verify → Contract.
Legacy fields are not removed until the consumer/verification gate has passed.

### Branch Catalog / Branch Adoption

> **ARCHITECTURE MIGRATION NOTICE — 2026-10-03:** The forward adoption boundary is **Menu**.
> The physical `branch_products` table remains compatibility storage during migration.
> The authoritative forward relationships are `branch_menus` + `branch_menu_categories`.
> Product stock is authoritative in `branch_product_inventory`.

Forward ownership model:

- `branch_menus` → adopted customer-facing Menu + Branch availability + optional Menu price override;
- `branch_menu_categories` → canonical Branch Category membership (M:N);
- `branch_product_inventory` → Product/SKU stock quantity;
- `inventory_movements` → immutable Product inventory ledger;
- `branch_products` → legacy compatibility/migration source only.

#### `branch_products` (LEGACY compatibility shape)

The following physical fields may remain during migration:

```text
product_id
branch_category_id
product_name
product_description
product_image_url
name_override
description_override
image_override
price
stock
is_available
low_stock_threshold
```

These fields are **not** the forward Menu or Inventory authority. Migration tooling may read
them to reconcile existing data. New Customer Menu code must not use them as a substitute for
`branch_menus`, `branch_menu_categories`, or `branch_product_inventory`.

`branch_products.branch_category_id` is legacy scalar classification. The forward M:N
membership authority is `branch_menu_categories`.

`branch_products.name_override`, `description_override`, and `image_override` are legacy
compatibility data; the current Product → Menu contract does not permit them to override the
resolved Customer Menu.

`branch_products.price` is legacy Branch Product pricing data. The forward commercial selling
price belongs to `menus.selling_price`, with `branch_menus.price_override` representing the
Branch Menu configuration where that override is supported by the current implementation.

`branch_products.stock` is legacy inventory data. The forward Product/SKU stock quantity is
`branch_product_inventory.stock_qty`.

### `branch_categories` (Branch-owned Categories)
```sql
CREATE TABLE branch_categories (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);
```
## 3. Order & Fulfillment Tables (Immutable Snapshots)

### Master Menu Composition

The forward Master Menu model is **Owner-owned structured composition**. These tables are
Brand-scoped and are separate from POS `options_config`.

#### `menu_flavors`
```sql
CREATE TABLE menu_flavors (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);
```

#### `menu_complements`
```sql
CREATE TABLE menu_complements (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);
```

#### `menu_levels`
```sql
CREATE TABLE menu_levels (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);
```

#### Legacy Product composition relations

```text
products
  ├── product_flavors      → menu_flavors   (legacy migration source)
  ├── product_complements  → menu_complements (legacy migration source)
  └── product_levels       → menu_levels    (legacy migration source)
```

These relations remain physical compatibility data for migration/reconciliation only. They are
**not** the canonical customer-facing Menu composition. The canonical composition is
`menus → menu_items → products`, with Menu taxonomy stored on `menus` and its Master references.
The same-Brand relationship is enforced at database level. Existing product `category_id` is retained
for legacy Product context and migration mapping.

### `orders`
Master order record governed by state machine.
```sql
CREATE TABLE orders (
    id VARCHAR(36) PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL, -- e.g. XN-20260827-0001
    brand_id VARCHAR(36) NOT NULL,
    branch_id VARCHAR(36) NOT NULL,
    customer_phone VARCHAR(30) NOT NULL,
    customer_name VARCHAR(100),
    order_type VARCHAR(20) NOT NULL, -- 'delivery', 'pickup', 'dinein'
    selection_mode TEXT, -- R2: 'AUTO' (Core/BranchMatcher) or 'CUSTOMER_SELECTED'; NULL = legacy
    fulfillment_schedule_type VARCHAR(20) DEFAULT 'asap', -- 'asap' or 'scheduled'
    scheduled_slot_start TIMESTAMP,
    scheduled_slot_end TIMESTAMP,
    status VARCHAR(30) DEFAULT 'pending', -- pending(AWAITING_BRANCH_ACCEPTANCE) → confirmed(ACCEPTED) → preparing, ready, out_for_delivery, completed; rejected(REJECTED, terminal, R5); timeout(BRANCH_TIMEOUT, terminal, R6); cancelled(CUSTOMER/SYSTEM cancel, R7); refunded
    subtotal DECIMAL(12, 2) NOT NULL,
    discount_amount DECIMAL(12, 2) DEFAULT 0.00,
    delivery_fee DECIMAL(12, 2) DEFAULT 0.00,
    grand_total DECIMAL(12, 2) NOT NULL,
    order_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);
```

### `order_items` (Immutable Item Snapshot)
```sql
CREATE TABLE order_items (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36),
    product_name VARCHAR(255) NOT NULL,
    unit_price DECIMAL(12, 2) NOT NULL,
    quantity INT NOT NULL,
    item_subtotal DECIMAL(12, 2) NOT NULL,
    item_note TEXT,
    menu_id VARCHAR(36), -- Canonical commercial Menu identity; NULL only for legacy rows
    menu_type VARCHAR(20), -- SINGLE | PACKAGE for canonical rows
    menu_snapshot JSON, -- Immutable resolved Menu snapshot
    component_snapshot JSON, -- Immutable Menu → Product composition snapshot
    modifiers_snapshot JSON, -- Immutable resolved POS option snapshot
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
```

### `order_deliveries` (Immutable Routing Snapshot)
```sql
CREATE TABLE order_deliveries (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) UNIQUE NOT NULL,
    destination_address TEXT NOT NULL,
    destination_latitude DECIMAL(10, 8) NOT NULL,
    destination_longitude DECIMAL(11, 8) NOT NULL,
    actual_road_distance_meters INT NOT NULL,
    actual_duration_seconds INT,
    chargeable_distance_km DECIMAL(6, 2) NOT NULL,
    free_km_applied DECIMAL(6, 2) NOT NULL,
    rate_per_km_applied DECIMAL(10, 2) NOT NULL,
    delivery_fee_calculated DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
```

### `order_payments` (Direct-to-Merchant Payment & Refund Audit)
```sql
CREATE TABLE order_payments (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    provider VARCHAR(50) DEFAULT 'midtrans',
    merchant_id VARCHAR(100),
    transaction_id VARCHAR(100),
    payment_method VARCHAR(50), -- 'qris', 'gopay', 'bca_va', 'cash'
    snap_token VARCHAR(255),
    payment_status VARCHAR(30) DEFAULT 'pending', -- pending, settlement, expire, cancel, refunded
    amount DECIMAL(12, 2) NOT NULL,
    refund_amount DECIMAL(12, 2) DEFAULT 0.00,
    refund_reason TEXT,
    raw_webhook_response JSON,
    settled_at TIMESTAMP,
    refunded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
```

### `order_status_logs` (State Machine Event Audit)
```sql
CREATE TABLE order_status_logs (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    previous_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    actor_type VARCHAR(30) NOT NULL, -- 'customer', 'kitchen', 'courier', 'admin', 'system'
    actor_id VARCHAR(36),
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
```
