'use strict';

const ensuredDbs = new WeakSet();

function hasColumn(db, table, column) {
  let result = [];
  if (db && typeof db.prepare === 'function') {
    result = db.prepare(`PRAGMA table_info(${table})`).all();
  } else if (db && typeof db.queryMany === 'function') {
    result = db.queryMany(`PRAGMA table_info(${table})`);
  }
  const rows = Array.isArray(result)
    ? result
    : (result && Array.isArray(result.rows) ? result.rows : []);
  return rows.some(row => String(row.name) === column);
}

function normalizeName(value) {
  return String(value == null ? '' : value).trim();
}

function slugify(value) {
  return normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'judul';
}

/**
 * Migrasi satu kali: **Sub Category → Judul**.
 *
 * Sub Category dipensiunkan sebagai konsep forward; Judul menggantikannya sebagai judul
 * customer. Supaya judul yang sudah tampil di storefront tidak berubah, setiap Sub Category
 * yang dipakai Menu dibuatkan Judul dengan nama yang sama, lalu Menu diarahkan ke
 * `title_id` + `category_id` (Category tetap sebagai pengelompokan).
 *
 * Idempotent: hanya memproses Menu yang `title_id`-nya masih kosong.
 */
function migrateSubCategoriesToTitles(db) {
  const query = (sql) => {
    if (db && typeof db.prepare === 'function') return db.prepare(sql).all();
    if (db && typeof db.queryMany === 'function') return db.queryMany(sql);
    return [];
  };
  const run = (sql, params) => {
    if (db && typeof db.prepare === 'function') return db.prepare(sql).run(...params);
    if (db && typeof db.queryMany === 'function') return db.queryMany(sql, params);
    return null;
  };

  let rows = [];
  try {
    rows = query(`
      SELECT m.id AS menu_id, m.brand_id, sc.id AS sub_id, sc.name AS sub_name, sc.category_id AS category_id
      FROM menus m
      JOIN sub_categories sc ON sc.id = m.sub_category_id AND sc.brand_id = m.brand_id
      WHERE m.sub_category_id IS NOT NULL AND (m.title_id IS NULL OR m.title_id = '')
    `);
  } catch (_) {
    return; // Tabel legacy tidak ada pada database yang sudah bersih.
  }
  if (!Array.isArray(rows) || rows.length === 0) return;

  const titleIdByName = new Map();
  for (const row of rows) {
    const brandId = String(row.brand_id || '');
    const name = normalizeName(row.sub_name);
    if (!brandId || !name) continue;
    const key = brandId + '\u0000' + name.toLowerCase();

    try {
      if (!titleIdByName.has(key)) {
        const existing = query(
          "SELECT id FROM menu_titles WHERE brand_id = '" + brandId.replace(/'/g, "''") +
          "' AND lower(name) = lower('" + name.replace(/'/g, "''") + "') LIMIT 1"
        );
        if (Array.isArray(existing) && existing.length) {
          titleIdByName.set(key, String(existing[0].id));
        } else {
          const id = 'title_' + slugify(name) + '_' + String(row.sub_id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8);
          run(
            'INSERT OR IGNORE INTO menu_titles (id, brand_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, ?, 0, 1)',
            [id, brandId, name, slugify(name)]
          );
          titleIdByName.set(key, id);
        }
      }

      const titleId = titleIdByName.get(key);
      run(
        'UPDATE menus SET title_id = ?, category_id = COALESCE(category_id, ?), updated_at = datetime(\'now\') WHERE id = ?',
        [titleId, row.category_id || null, row.menu_id]
      );
    } catch (err) {
      console.error('[ComposedMenuSchema] migrasi Sub Category → Judul tertunda untuk Menu ' + row.menu_id + ':', err.message);
    }
  }
}

function tableDefinition(db, table) {
  let rows = [];
  if (db && typeof db.prepare === 'function') {
    rows = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").all(table);
  } else if (db && typeof db.queryMany === 'function') {
    rows = db.queryMany("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
  }
  const list = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.rows) ? rows.rows : []);
  return list.length ? String(list[0].sql || '') : '';
}

function tableColumns(db, table) {
  let rows = [];
  if (db && typeof db.prepare === 'function') {
    rows = db.prepare(`PRAGMA table_info(${table})`).all();
  } else if (db && typeof db.queryMany === 'function') {
    rows = db.queryMany(`PRAGMA table_info(${table})`);
  }
  const list = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.rows) ? rows.rows : []);
  return list.map(row => String(row.name));
}

/**
 * Contract v1 migration — docs/decisions/catalog-menu-domain-contract-v1.md
 *
 * Menu tidak lagi punya subtype forward: `menu_type NOT NULL CHECK (SINGLE|PACKAGE)`
 * dan CHECK identitas (wajib package_name untuk PACKAGE, wajib rasa untuk SINGLE)
 * memblokir Menu forward (rasa opsional, 1..N Item, tanpa package_name).
 *
 * SQLite tidak bisa melonggarkan NOT NULL/CHECK lewat ALTER, jadi tabel dibangun ulang
 * sekali. Idempotent: hanya berjalan saat bentuk legacy terdeteksi, kolom yang disalin
 * mengikuti kolom yang benar-benar ada, dan berjalan SEBELUM batch schema supaya
 * index/trigger dibuat pada tabel hasil rebuild.
 */
function migrateLegacyMenuShape(db) {
  const sql = tableDefinition(db, 'menus');
  if (!sql) return;
  const legacyShape = /menu_type\s+TEXT\s+NOT\s+NULL/i.test(sql) ||
                      /menu_type\s+IN\s*\(/i.test(sql) ||
                      /spice_level\s+INTEGER\s+NOT\s+NULL/i.test(sql);
  if (!legacyShape) return;

  const copyable = [
    'id', 'brand_id', 'category_id', 'title_id', 'sub_category_id', 'rasa_id', 'menu_type', 'package_name', 'level_id',
    'selling_price', 'cost_price', 'spice_enabled', 'spice_level', 'status', 'created_at', 'updated_at',
    'media_id', 'image_url', 'image'
  ];
  const existing = tableColumns(db, 'menus');
  const columns = copyable.filter(column => existing.includes(column));
  if (!columns.includes('id')) return;

  // Prosedur rebuild tabel SQLite: FK off + legacy_alter_table on, supaya trigger/view
  // lain yang menyebut `menus` tidak membuat DROP/RENAME gagal saat schema berubah.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA legacy_alter_table = ON');
  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE menus__contract_v1 (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        category_id TEXT,
        title_id TEXT,
        sub_category_id TEXT,
        rasa_id TEXT,
        menu_type TEXT,
        package_name TEXT,
        level_id TEXT,
        selling_price REAL NOT NULL CHECK (selling_price >= 0),
        cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
        spice_enabled INTEGER NOT NULL DEFAULT 0,
        spice_level INTEGER,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
        image_url TEXT,
        image TEXT,
        FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
        FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE RESTRICT,
        FOREIGN KEY (rasa_id) REFERENCES menu_flavors(id) ON DELETE RESTRICT
      )
    `);
    db.exec(
      'INSERT INTO menus__contract_v1 (' + columns.join(', ') + ') ' +
      'SELECT ' + columns.join(', ') + ' FROM menus'
    );
    db.exec('DROP TABLE menus');
    db.exec('ALTER TABLE menus__contract_v1 RENAME TO menus');
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    try { db.exec('PRAGMA legacy_alter_table = OFF'); } catch (_) {}
    try { db.exec('PRAGMA foreign_keys = ON'); } catch (_) {}
  }

  // Index legacy hanya berlaku untuk menu_type = 'SINGLE'; identitas forward berbeda.
  try { db.exec('DROP INDEX IF EXISTS idx_menus_single_identity;'); } catch (_) {}
}

function ensureComposedMenuSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

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

  // Contract v1: longgarkan bentuk legacy menus SEBELUM batch schema, supaya index/trigger
  // di batch itu terpasang pada tabel hasil rebuild.
  migrateLegacyMenuShape(db);

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

    -- Contract v1 (docs/decisions/catalog-menu-domain-contract-v1.md):
    -- Menu tanpa subtype forward. menu_type/package_name/level_id tetap ada sebagai
    -- storage legacy untuk kompatibilitas, tetapi nullable dan bukan authority bisnis.
    -- Rasa opsional, spice adalah field forward.
    CREATE TABLE IF NOT EXISTS menus (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      category_id TEXT,
      title_id TEXT,
      sub_category_id TEXT,
      rasa_id TEXT,
      menu_type TEXT,
      package_name TEXT,
      level_id TEXT,
      selling_price REAL NOT NULL CHECK (selling_price >= 0),
      cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
      spice_enabled INTEGER NOT NULL DEFAULT 0,
      spice_level INTEGER,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE RESTRICT,
      FOREIGN KEY (rasa_id) REFERENCES menu_flavors(id) ON DELETE RESTRICT
    );

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
      display_name_override TEXT,
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
  try { db.exec('ALTER TABLE branch_menus ADD COLUMN display_name_override TEXT;'); } catch (_) {}

  // Menu presentation media (customer-facing) — LOCKED by
  // docs/decisions/xentra-menu-presentation-media-v1.md. Menu Satuan and Menu Paket own their
  // customer-facing image; a component Product image is never used as a fallback.
  // Idempotent — safe on existing databases.
  try { db.exec('ALTER TABLE menus ADD COLUMN media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL;'); } catch (_) {}
  try { db.exec('ALTER TABLE menus ADD COLUMN image_url TEXT;'); } catch (_) {}
  try { db.exec('ALTER TABLE menus ADD COLUMN image TEXT;'); } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_menus_media_id ON menus(media_id) WHERE media_id IS NOT NULL;'); } catch (_) {}
  try { db.exec('ALTER TABLE menus ADD COLUMN spice_enabled INTEGER NOT NULL DEFAULT 0;'); } catch (_) {}
  try { db.exec('ALTER TABLE menus ADD COLUMN spice_level INTEGER NOT NULL DEFAULT 0;'); } catch (_) {}
  try { db.exec('ALTER TABLE menus ADD COLUMN cost_price REAL NOT NULL DEFAULT 0;'); } catch (_) {}
  try { db.exec('ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0;'); } catch (_) {}

  // Judul = master judul customer (Brand-scoped), bentuknya sama seperti Rasa.
  // Sub Category dipensiunkan sebagai konsep forward; perannya digantikan Judul.
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_titles (
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_titles_brand_slug
      ON menu_titles(brand_id, slug);
  `);

  // Menu kini mereferensikan Category (pengelompokan) dan Judul (judul customer).
  try { db.exec('ALTER TABLE menus ADD COLUMN category_id TEXT;'); } catch (_) {}
  try { db.exec('ALTER TABLE menus ADD COLUMN title_id TEXT;'); } catch (_) {}

  // Contract v4 (§3, §8, §21):
  // Menu adalah entitas dengan ID stabil sendiri (MENU-001). Tidak ada formula identitas
  // komposit Category + Judul + Rasa atau pembatasan duplikat komposit.
  try { db.exec('DROP INDEX IF EXISTS idx_menus_identity_v1;'); } catch (_) {}
  try { db.exec('DROP INDEX IF EXISTS idx_menus_single_identity;'); } catch (_) {}

  // Migrasi data: Sub Category → Judul (judul customer tidak berubah).
  migrateSubCategoriesToTitles(db);

  // Migration evidence for the explicit one-time backfill of legacy Menu presentation media.
  // Runtime fallback is not a migration mechanism, so every copy is recorded here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_media_migrations (
      menu_id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'component_product',
      source_product_id TEXT,
      media_id TEXT,
      status TEXT NOT NULL
        CHECK (status IN ('COPIED', 'SKIPPED_PACKAGE', 'SKIPPED_NO_SOURCE', 'SKIPPED_ALREADY_SET', 'FAILED')),
      notes TEXT,
      ran_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_menu_media_migrations_brand_status
      ON menu_media_migrations(brand_id, status);
  `);

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

  ensuredDbs.add(db);
}

module.exports = {
  ensureComposedMenuSchema,
  normalizeName
};
