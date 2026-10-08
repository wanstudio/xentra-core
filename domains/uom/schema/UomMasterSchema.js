'use strict';

const ensuredDbs = new WeakSet();

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some(row => row && String(row.name) === column);
}

function ensureUomMasterSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS uom_categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      reference_uom_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS uoms (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      conversion_factor REAL NOT NULL
        CHECK (conversion_factor > 0 AND conversion_factor <= 1000000000000),
      allows_fraction INTEGER NOT NULL DEFAULT 1 CHECK (allows_fraction IN (0, 1)),
      quantity_precision INTEGER NOT NULL DEFAULT 6 CHECK (quantity_precision BETWEEN 0 AND 6),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES uom_categories(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_uoms_category_active
      ON uoms(category_id, is_active, code);

    CREATE TRIGGER IF NOT EXISTS trg_uom_category_reference_update
    BEFORE UPDATE OF reference_uom_id ON uom_categories
    FOR EACH ROW
    WHEN NEW.reference_uom_id IS NOT NULL
      AND (
        (SELECT id FROM uoms WHERE id = NEW.reference_uom_id) IS NULL
        OR
        (SELECT category_id FROM uoms WHERE id = NEW.reference_uom_id) <> NEW.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'UOM_REFERENCE_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_uom_category_reference_delete_guard
    BEFORE DELETE ON uoms
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM uom_categories
      WHERE reference_uom_id = OLD.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'UOM_REFERENCE_DELETE_FORBIDDEN');
    END;
  `);

  // Seed the platform-owned canonical vocabulary. Existing rows are never overwritten.
  const categories = [
    ['uom_cat_mass', 'MASS', 'Mass', 'uom_kg'],
    ['uom_cat_volume', 'VOLUME', 'Volume', 'uom_l'],
    ['uom_cat_count', 'COUNT', 'Count', 'uom_pcs']
  ];

  for (const [id, code, name] of categories) {
    db.prepare(
      'INSERT OR IGNORE INTO uom_categories (id, code, name, reference_uom_id) VALUES (?, ?, ?, NULL)'
    ).run(id, code, name);
  }

  const units = [
    ['uom_kg', 'uom_cat_mass', 'kg', 'Kilogram', 1, 1, 6],
    ['uom_g', 'uom_cat_mass', 'g', 'Gram', 0.001, 1, 6],
    ['uom_mg', 'uom_cat_mass', 'mg', 'Milligram', 0.000001, 1, 6],
    ['uom_l', 'uom_cat_volume', 'L', 'Liter', 1, 1, 6],
    ['uom_ml', 'uom_cat_volume', 'ml', 'Milliliter', 0.001, 1, 6],
    ['uom_pcs', 'uom_cat_count', 'pcs', 'Pieces', 1, 0, 0],
    ['uom_dozen', 'uom_cat_count', 'dozen', 'Dozen', 12, 0, 0]
  ];

  for (const unit of units) {
    db.prepare(
      'INSERT OR IGNORE INTO uoms (id, category_id, code, name, conversion_factor, allows_fraction, quantity_precision) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(...unit);
  }

  for (const [id, , , refUom] of categories) {
    db.prepare('UPDATE uom_categories SET reference_uom_id = ? WHERE id = ?').run(refUom, id);
  }

  // Product Stock UOM is a forward compatibility field on the current Product master.
  if (!hasColumn(db, 'products', 'product_stock_uom_id')) {
    try { db.exec('ALTER TABLE products ADD COLUMN product_stock_uom_id TEXT'); } catch (_) {}
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_products_stock_uom_scope_insert
    BEFORE INSERT ON products
    FOR EACH ROW
    WHEN NEW.product_stock_uom_id IS NOT NULL
      AND (
        (SELECT id FROM uoms WHERE id = NEW.product_stock_uom_id) IS NULL
        OR
        (SELECT is_active FROM uoms WHERE id = NEW.product_stock_uom_id) <> 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCT_STOCK_UOM_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_products_stock_uom_scope_update
    BEFORE UPDATE OF product_stock_uom_id ON products
    FOR EACH ROW
    WHEN NEW.product_stock_uom_id IS NOT NULL
      AND (
        (SELECT id FROM uoms WHERE id = NEW.product_stock_uom_id) IS NULL
        OR
        (SELECT is_active FROM uoms WHERE id = NEW.product_stock_uom_id) <> 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCT_STOCK_UOM_INVALID');
    END;
  `);

  ensuredDbs.add(db);
}

module.exports = { ensureUomMasterSchema };
