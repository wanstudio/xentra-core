# Xentra Core — Database Schema Specification

**Database Standard:** ANSI SQL Compliant (Compatible with MySQL 8.0+, PostgreSQL 14+, SQLite 3)

---

## 1. Tenancy & Hierarchy Tables

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

---

## 2. Menu & Catalog Tables

### `categories`
```sql
CREATE TABLE categories (
    id VARCHAR(36) PRIMARY KEY,
    brand_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
);
```

### `products`
```sql
CREATE TABLE products (
    id VARCHAR(36) PRIMARY KEY,
    brand_id VARCHAR(36) NOT NULL,
    category_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(12, 2) NOT NULL,
    regular_price DECIMAL(12, 2),
    sale_price DECIMAL(12, 2),
    image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
```

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
    fulfillment_schedule_type VARCHAR(20) DEFAULT 'asap', -- 'asap' or 'scheduled'
    scheduled_slot_start TIMESTAMP,
    scheduled_slot_end TIMESTAMP,
    status VARCHAR(30) DEFAULT 'pending', -- pending, confirmed, preparing, ready, out_for_delivery, completed, cancelled, refunded
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
