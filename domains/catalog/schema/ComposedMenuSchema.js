'use strict';

let ensured = false;

function hasColumn(db, table, column) {
  return db.queryMany(`PRAGMA table_info(${table})`).some(row => String(row.name) === column);
}

function normalizeName(value) {
  return String(value == null ? '' : value).trim();
}

function ensureComposedMenuSchema(db) {
  if (ensured) return;
  if (!db) db = require('../../../core/data/DataAccess');

  // Additive order snapshot fields. Existing order_items columns remain for legacy consumers.
  try { db.exec('ALTER TABLE order_items ADD COLUMN menu_id TEXT;'); } catch (_) {}
  try { db.exec('ALTER TABLE order_items ADD COLUMN menu_type TEXT;'); } catch (_) {}
  try { db.exec('ALTER TABLE order_items ADD COLUMN component_snapshot TEXT;'); } catch (_) {}

  // Product becomes the atomic inventory identity. The legacy products.price/category
  // columns remain compatibility fields during migration; new Menu code does not use them
  // as customer-facing authorities.
  if (!hasColumn(db, 'products', 'sku')) {
    db.exec('ALTER TABLE products ADD COLUMN sku TEXT;');
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_brand_sku_normalized
      ON products(brand_id, lower(trim(sku)))
      WHERE sku IS NOT NULL AND trim(sku) <> '';

    CREATE TRIGGER IF NOT EXISTS trg_products_sku_non_empty_insert
    BEFORE INSERT ON products
    FOR EACH ROW
    WHEN NEW.sku IS NOT NULL AND trim(NEW.sku) = ''
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCT_SKU_EMPTY');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_products_sku_non_empty_update
    BEFORE UPDATE OF sku ON products
    FOR EACH ROW
    WHEN NEW.sku IS NOT NULL AND trim(NEW.sku) = ''
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCT_SKU_EMPTY');
    END;

    CREATE TABLE IF NOT EXISTS sub_categories (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_categories_brand_name_normalized
      ON sub_categories(brand_id, lower(trim(name)));

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_categories_brand_slug
      ON sub_categories(brand_id, slug);

    CREATE TRIGGER IF NOT EXISTS trg_sub_categories_brand_consistency_insert
    BEFORE INSERT ON sub_categories
    FOR EACH ROW
    WHEN (SELECT brand_id FROM categories WHERE id = NEW.category_id) IS NULL
         OR (SELECT brand_id FROM categories WHERE id = NEW.category_id) <> NEW.brand_id
    BEGIN
      SELECT RAISE(ABORT, 'SUB_CATEGORY_CROSS_BRAND');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_sub_categories_brand_consistency_update
    BEFORE UPDATE OF brand_id, category_id ON sub_categories
    FOR EACH ROW
    WHEN (SELECT brand_id FROM categories WHERE id = NEW.category_id) IS NULL
         OR (SELECT brand_id FROM categories WHERE id = NEW.category_id) <> NEW.brand_id
    BEGIN
      SELECT RAISE(ABORT, 'SUB_CATEGORY_CROSS_BRAND');
    END;

    CREATE TABLE IF NOT EXISTS menus (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      menu_type TEXT NOT NULL CHECK (menu_type IN ('SINGLE', 'PACKAGE')),
      sub_category_id TEXT,
      rasa_id TEXT,
      level_id TEXT,
      package_name TEXT,
      selling_price REAL NOT NULL CHECK (selling_price >= 0),
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE RESTRICT,
      FOREIGN KEY (rasa_id) REFERENCES menu_flavors(id) ON DELETE RESTRICT,
      FOREIGN KEY (level_id) REFERENCES menu_levels(id) ON DELETE RESTRICT,
      CHECK (
        (menu_type = 'SINGLE'
          AND sub_category_id IS NOT NULL
          AND rasa_id IS NOT NULL
          AND package_name IS NULL)
        OR
        (menu_type = 'PACKAGE'
          AND package_name IS NOT NULL
          AND trim(package_name) <> '')
      )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_menus_single_identity
      ON menus(brand_id, sub_category_id, rasa_id)
      WHERE menu_type = 'SINGLE';

    CREATE INDEX IF NOT EXISTS idx_menus_brand_type_status
      ON menus(brand_id, menu_type, status);

    CREATE INDEX IF NOT EXISTS idx_menus_brand_sub_category
      ON menus(brand_id, sub_category_id);

    CREATE TRIGGER IF NOT EXISTS trg_menus_brand_consistency_insert
    BEFORE INSERT ON menus
    FOR EACH ROW
    WHEN
      (NEW.sub_category_id IS NOT NULL AND
       ((SELECT brand_id FROM sub_categories WHERE id = NEW.sub_category_id) IS NULL OR
        (SELECT brand_id FROM sub_categories WHERE id = NEW.sub_category_id) <> NEW.brand_id))
      OR
      (NEW.rasa_id IS NOT NULL AND
       ((SELECT brand_id FROM menu_flavors WHERE id = NEW.rasa_id) IS NULL OR
        (SELECT brand_id FROM menu_flavors WHERE id = NEW.rasa_id) <> NEW.brand_id))
      OR
      (NEW.level_id IS NOT NULL AND
       ((SELECT brand_id FROM menu_levels WHERE id = NEW.level_id) IS NULL OR
        (SELECT brand_id FROM menu_levels WHERE id = NEW.level_id) <> NEW.brand_id))
    BEGIN
      SELECT RAISE(ABORT, 'MENU_CROSS_BRAND');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_menus_brand_consistency_update
    BEFORE UPDATE OF brand_id, sub_category_id, rasa_id, level_id ON menus
    FOR EACH ROW
    WHEN
      (NEW.sub_category_id IS NOT NULL AND
       ((SELECT brand_id FROM sub_categories WHERE id = NEW.sub_category_id) IS NULL OR
        (SELECT brand_id FROM sub_categories WHERE id = NEW.sub_category_id) <> NEW.brand_id))
      OR
      (NEW.rasa_id IS NOT NULL AND
       ((SELECT brand_id FROM menu_flavors WHERE id = NEW.rasa_id) IS NULL OR
        (SELECT brand_id FROM menu_flavors WHERE id = NEW.rasa_id) <> NEW.brand_id))
      OR
      (NEW.level_id IS NOT NULL AND
       ((SELECT brand_id FROM menu_levels WHERE id = NEW.level_id) IS NULL OR
        (SELECT brand_id FROM menu_levels WHERE id = NEW.level_id) <> NEW.brand_id))
    BEGIN
      SELECT RAISE(ABORT, 'MENU_CROSS_BRAND');
    END;

    CREATE TABLE IF NOT EXISTS menu_items (
      menu_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (menu_id, product_id),
      FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_menu_items_product
      ON menu_items(product_id, menu_id);

    CREATE TRIGGER IF NOT EXISTS trg_menu_items_brand_consistency_insert
    BEFORE INSERT ON menu_items
    FOR EACH ROW
    WHEN (SELECT brand_id FROM products WHERE id = NEW.product_id) IS NULL
         OR (SELECT brand_id FROM menus WHERE id = NEW.menu_id) IS NULL
         OR (SELECT brand_id FROM products WHERE id = NEW.product_id) <>
            (SELECT brand_id FROM menus WHERE id = NEW.menu_id)
    BEGIN
      SELECT RAISE(ABORT, 'MENU_ITEM_CROSS_BRAND');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_menu_items_brand_consistency_update
    BEFORE UPDATE OF menu_id, product_id ON menu_items
    FOR EACH ROW
    WHEN (SELECT brand_id FROM products WHERE id = NEW.product_id) IS NULL
         OR (SELECT brand_id FROM menus WHERE id = NEW.menu_id) IS NULL
         OR (SELECT brand_id FROM products WHERE id = NEW.product_id) <>
            (SELECT brand_id FROM menus WHERE id = NEW.menu_id)
    BEGIN
      SELECT RAISE(ABORT, 'MENU_ITEM_CROSS_BRAND');
    END;

    CREATE TABLE IF NOT EXISTS branch_menus (
      branch_id TEXT NOT NULL,
      menu_id TEXT NOT NULL,
      is_available INTEGER NOT NULL DEFAULT 1,
      price_override REAL CHECK (price_override IS NULL OR price_override >= 0),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (branch_id, menu_id),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_branch_menus_menu
      ON branch_menus(menu_id, branch_id);

    CREATE TRIGGER IF NOT EXISTS trg_branch_menus_brand_consistency_insert
    BEFORE INSERT ON branch_menus
    FOR EACH ROW
    WHEN (SELECT brand_id FROM branches WHERE id = NEW.branch_id) IS NULL
         OR (SELECT brand_id FROM menus WHERE id = NEW.menu_id) IS NULL
         OR (SELECT brand_id FROM branches WHERE id = NEW.branch_id) <>
            (SELECT brand_id FROM menus WHERE id = NEW.menu_id)
    BEGIN
      SELECT RAISE(ABORT, 'BRANCH_MENU_CROSS_BRAND');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_branch_menus_brand_consistency_update
    BEFORE UPDATE OF branch_id, menu_id ON branch_menus
    FOR EACH ROW
    WHEN (SELECT brand_id FROM branches WHERE id = NEW.branch_id) IS NULL
         OR (SELECT brand_id FROM menus WHERE id = NEW.menu_id) IS NULL
         OR (SELECT brand_id FROM branches WHERE id = NEW.branch_id) <>
            (SELECT brand_id FROM menus WHERE id = NEW.menu_id)
    BEGIN
      SELECT RAISE(ABORT, 'BRANCH_MENU_CROSS_BRAND');
    END;

    CREATE TABLE IF NOT EXISTS branch_menu_categories (
      branch_id TEXT NOT NULL,
      menu_id TEXT NOT NULL,
      branch_category_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (branch_id, menu_id, branch_category_id),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_category_id) REFERENCES branch_categories(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_branch_menu_categories_menu
      ON branch_menu_categories(branch_id, menu_id);

    CREATE TRIGGER IF NOT EXISTS trg_branch_menu_categories_consistency_insert
    BEFORE INSERT ON branch_menu_categories
    FOR EACH ROW
    WHEN
      (SELECT brand_id FROM branches WHERE id = NEW.branch_id) IS NULL
      OR (SELECT brand_id FROM menus WHERE id = NEW.menu_id) IS NULL
      OR (SELECT brand_id FROM branch_categories WHERE id = NEW.branch_category_id) IS NULL
      OR (SELECT branch_id FROM branch_categories WHERE id = NEW.branch_category_id) IS NULL
      OR (SELECT branch_id FROM branch_categories WHERE id = NEW.branch_category_id) <> NEW.branch_id
      OR (SELECT brand_id FROM branches WHERE id = NEW.branch_id) <>
         (SELECT brand_id FROM menus WHERE id = NEW.menu_id)
    BEGIN
      SELECT RAISE(ABORT, 'BRANCH_MENU_CATEGORY_SCOPE_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_branch_menu_categories_consistency_update
    BEFORE UPDATE OF branch_id, menu_id, branch_category_id ON branch_menu_categories
    FOR EACH ROW
    WHEN
      (SELECT brand_id FROM branches WHERE id = NEW.branch_id) IS NULL
      OR (SELECT brand_id FROM menus WHERE id = NEW.menu_id) IS NULL
      OR (SELECT brand_id FROM branch_categories WHERE id = NEW.branch_category_id) IS NULL
      OR (SELECT branch_id FROM branch_categories WHERE id = NEW.branch_category_id) IS NULL
      OR (SELECT branch_id FROM branch_categories WHERE id = NEW.branch_category_id) <> NEW.branch_id
      OR (SELECT brand_id FROM branches WHERE id = NEW.branch_id) <>
         (SELECT brand_id FROM menus WHERE id = NEW.menu_id)
    BEGIN
      SELECT RAISE(ABORT, 'BRANCH_MENU_CATEGORY_SCOPE_MISMATCH');
    END;

    CREATE TABLE IF NOT EXISTS branch_product_inventory (
      branch_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
      low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (branch_id, product_id),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS composed_menu_migrations (
      product_id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      source_model TEXT NOT NULL DEFAULT 'legacy_product',
      target_model TEXT NOT NULL DEFAULT 'composed_menu_v1',
      status TEXT NOT NULL DEFAULT 'legacy'
        CHECK (status IN ('legacy', 'needs_review', 'migrated', 'verified', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      canonical_fingerprint TEXT,
      source_snapshot TEXT,
      last_error TEXT,
      notes TEXT,
      migrated_at TEXT,
      verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_composed_menu_migrations_brand_status
      ON composed_menu_migrations(brand_id, status);

    CREATE TABLE IF NOT EXISTS product_sku_history (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      previous_sku TEXT,
      new_sku TEXT,
      actor_id TEXT,
      actor_role TEXT,
      changed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_product_sku_history_product
      ON product_sku_history(brand_id, product_id, changed_at);

    CREATE INDEX IF NOT EXISTS idx_branch_product_inventory_product
      ON branch_product_inventory(product_id, branch_id);

    CREATE TRIGGER IF NOT EXISTS trg_branch_product_inventory_brand_consistency_insert
    BEFORE INSERT ON branch_product_inventory
    FOR EACH ROW
    WHEN (SELECT brand_id FROM branches WHERE id = NEW.branch_id) IS NULL
         OR (SELECT brand_id FROM products WHERE id = NEW.product_id) IS NULL
         OR (SELECT brand_id FROM branches WHERE id = NEW.branch_id) <>
            (SELECT brand_id FROM products WHERE id = NEW.product_id)
    BEGIN
      SELECT RAISE(ABORT, 'BRANCH_PRODUCT_INVENTORY_CROSS_BRAND');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_branch_product_inventory_brand_consistency_update
    BEFORE UPDATE OF branch_id, product_id ON branch_product_inventory
    FOR EACH ROW
    WHEN (SELECT brand_id FROM branches WHERE id = NEW.branch_id) IS NULL
         OR (SELECT brand_id FROM products WHERE id = NEW.product_id) IS NULL
         OR (SELECT brand_id FROM branches WHERE id = NEW.branch_id) <>
            (SELECT brand_id FROM products WHERE id = NEW.product_id)
    BEGIN
      SELECT RAISE(ABORT, 'BRANCH_PRODUCT_INVENTORY_CROSS_BRAND');
    END;
  `);

  // Rasa is reusable Brand Master data. Enforce normalized-name uniqueness
  // at the write boundary so quick-add/update can never create a duplicate master.
  // Triggers are used instead of a new unique index because legacy rows may
  // predate this contract and must not make additive schema initialization fail.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_menu_flavors_brand_name_unique_insert
    BEFORE INSERT ON menu_flavors
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM menu_flavors mf
      WHERE mf.brand_id = NEW.brand_id
        AND lower(trim(mf.name)) = lower(trim(NEW.name))
    )
    BEGIN
      SELECT RAISE(ABORT, 'RASA_ALREADY_EXISTS');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_menu_flavors_brand_name_unique_update
    BEFORE UPDATE OF brand_id, name ON menu_flavors
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM menu_flavors mf
      WHERE mf.brand_id = NEW.brand_id
        AND lower(trim(mf.name)) = lower(trim(NEW.name))
        AND mf.id <> NEW.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'RASA_ALREADY_EXISTS');
    END;
  `);

  ensured = true;
}

module.exports = {
  ensureComposedMenuSchema,
  normalizeName
};
