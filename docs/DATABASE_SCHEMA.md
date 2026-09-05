# Xentra Core — Database Schema Specification

**Database Standard:** ANSI SQL Compliant (Compatible with MySQL 8.0+, PostgreSQL 14+, SQLite 3)

---

## 1. Tenancy & Hierarchy Tables

> **Implementation note (B1/C1/C2 — Branch, Product Assignment & Inventory Boundary,
> 2026-09-04):** the live SQLite schema in `server/database/db.js` implements the tenancy
> hierarchy with the tables below (`organizations` → `brands` → `branches`, plus
> `branch_delivery_settings` carrying the delivery/pickup capability flags that this spec's
> `branch_settings` example describes). Product → Branch assignment is the `branch_products`
> table below with DB-level brand-consistency and non-negative-stock triggers; physical
> stock lives in `branch_products.stock` (owned by the Inventory domain, never fabricated by
> assignment) and every mutation is recorded in the immutable `inventory_movements` ledger
> (atomic guarded updates + optional `mutation_id` idempotency). Known deltas from this spec,
> deliberately not materialized yet (no approved business contract): `dinein_enabled` and
> `operating_hours` (schedule-driven open state). Branch open/close is represented by the
> server-authoritative `branches.is_open_override` master switch consumed by `BranchMatcher`
> and the public branch API. Authorized branch/product-operational mutations are recorded
> append-only in `branch_operation_logs`.

### `organizations`
Master SaaS account / holding organization.
```sql
CREATE TABLE organizations (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'pro',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

### `branch_products` (C1 — Product → Branch Assignment)
An explicit, brand-consistent assignment of a Product Master row to one Branch.
Assignment ≠ inventory (the row carries no stock until the Inventory domain records it;
API-created assignments keep `stock` NULL) and ≠ operational availability (`is_available`
is a branch-scoped flag toggled by Owner/Brand or the assigned Branch Manager).
```sql
CREATE TABLE branch_products (
    branch_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    price REAL,                       -- optional branch price override
    stock INTEGER DEFAULT 100,        -- Inventory domain owns stock semantics
    is_available BOOLEAN DEFAULT TRUE,
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
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);
```

### Branch Catalog (Branch-owned)

The Branch Catalog is NOT a filtered view of the Master Catalog. It is a Branch-owned
operational selling catalog. Adoption of a Master Product is a **save point** — a snapshot
of the Master Product at the time of adoption. Subsequent Master mutations do NOT
silently mutate the Branch Catalog.

#### Ownership model

- **Master Category ≠ Branch Category**: A Branch may create its own categories, rename
  them, and place adopted products into different categories than the Master.
- **Master Product ≠ Branch Product**: A Branch Product preserves provenance to the
  originating Master Product but owns its snapshot metadata, category placement, and
  operational state.
- **Adoption = Save Point**: When a Branch adopts a Master Product, snapshot columns
  capture the Master Product metadata. These snapshots are NOT updated when the
  Master Product changes.

#### Branch Catalog isolation guarantees

- **Master `is_active` ≠ Branch availability**: A Master Product with `is_active=0`
  does NOT make adopted Branch Products unavailable. Branch Catalog reads use
  `branch_products.is_available` as the sole availability authority.
- **Master price ≠ Branch selling price**: Master Product `price` is NOT a live
  fallback for adopted Branch Products. `branch_products.price` is established at
  adoption/migration time and is the authoritative selling price. Master price
  mutations do NOT silently mutate adopted Branch selling prices.
- **Master Category ≠ Branch Category**: `branch_products.branch_category_id`
  references a Branch-owned `branch_categories` row, NOT a Master `categories` row.
  The migration resolves/creates Branch-owned categories for legacy data.

#### Key invariants

- A product may exist in Master Catalog without being adopted by any Branch.
- A Branch may adopt only the Master Products it chooses.
- Branch A and Branch B may sell different subsets of the same Master Catalog.
- The same Master Product may be placed into different Branch Categories by different Branches.
- Master Product mutations (rename, disable, etc.) do NOT silently mutate Branch Catalog.
- Branch Context MUST read Branch Catalog. No Master Catalog fallback is allowed.

### `branch_categories` (Branch-owned Categories)
```sql
CREATE TABLE branch_categories (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);
```

### `branch_products` (Branch Catalog — Adopted Products with Snapshot)
```sql
CREATE TABLE branch_products (
    branch_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    branch_category_id TEXT,
    product_name TEXT,
    product_description TEXT,
    product_image_url TEXT,
    price REAL,
    stock INTEGER DEFAULT 100,
    is_available INTEGER DEFAULT 1,
    low_stock_threshold INTEGER DEFAULT 5,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (branch_id, product_id),
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_category_id) REFERENCES branch_categories(id) ON DELETE SET NULL
);
```

#### Column semantics

- `product_id` → FK to Master Product (provenance; CASCADE DELETE if master deleted).
- `branch_category_id` → FK to **Branch-owned** category (NOT Master Category). Created/resolved during migration. Branch Category ≠ Master Category.
- `product_name` → Snapshot of Master Product name at adoption time. Master mutations do NOT rewrite this.
- `product_description` → Snapshot of Master Product description at adoption time. Master mutations do NOT rewrite this.
- `product_image_url` → Snapshot of Master Product image at adoption time. Master mutations do NOT rewrite this.
- `price` → **Branch selling price**. Established at adoption/migration time. Master price mutations do NOT silently mutate this. This is the authoritative selling price for Branch Catalog reads.
- `stock` → Branch-owned physical stock (Inventory domain).
- `is_available` → **Branch-owned availability flag**. Master Product `is_active` does NOT gate Branch Catalog availability. A disabled master product with `is_available=1` on an adopted branch product remains available in that branch's catalog.

#### Triggers

- `trg_branch_products_brand_consistency_insert/update`: Enforces that `product.brand_id = branch.brand_id` (C1 cross-brand guard).
- `trg_branch_products_stock_non_negative_insert/update`: Enforces `stock >= 0` (C2 non-negative stock guard).

---

## 3. Order & Fulfillment Tables (Immutable Snapshots)

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
    modifiers_snapshot JSON,
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
