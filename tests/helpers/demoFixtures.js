'use strict';

/**
 * Demo fixtures for suites that assert against demo data.
 *
 * Schema initialization deliberately provisions ONLY the essential tenant
 * (organization + brand): demo branches, products and promotions are never
 * auto-seeded. Suites that exercise demo branches (`branch_bangjo_barat` /
 * `branch_bangjo_timur`) opt in explicitly by requiring this module.
 *
 * Suites that verify the empty-state contract (e.g. dbSeedIsolation,
 * databaseSafetyGuard) must NOT require this.
 */

const db = require('../../server/database/db');


function seedCanonicalDemoCatalog(db) {
  const { ensureComposedMenuSchema } = require('../../domains/catalog/schema/ComposedMenuSchema');
  ensureComposedMenuSchema({
    queryMany(sql, params = []) { return db.prepare(sql).all(...params); },
    queryOne(sql, params = []) { return db.prepare(sql).get(...params); },
    execute(sql, params = []) { return db.prepare(sql).run(...params); },
    exec(sql) { return db.exec(sql); }
  });

  // menu_flavors enforces normalized brand+name uniqueness through a trigger
  // (RASA_ALREADY_EXISTS), so INSERT OR IGNORE is not sufficient here.
  // Reuse the existing Brand Master row when it already exists.
  let originalRasa = db.prepare(
    "SELECT id FROM menu_flavors WHERE brand_id = 'brand_bangjo' AND lower(trim(name)) = 'original' LIMIT 1"
  ).get();
  if (!originalRasa) {
    const originalRasaId = 'demo_bangjo_rasa_original';
    try {
      db.prepare(
        "INSERT INTO menu_flavors (id, brand_id, name, slug, sort_order, is_active) VALUES (?, 'brand_bangjo', 'Original', 'original', 1, 1)"
      ).run(originalRasaId);
      originalRasa = { id: originalRasaId };
    } catch (err) {
      if (!String(err && err.message || err).includes('RASA_ALREADY_EXISTS')) throw err;
      originalRasa = db.prepare(
        "SELECT id FROM menu_flavors WHERE brand_id = 'brand_bangjo' AND lower(trim(name)) = 'original' LIMIT 1"
      ).get();
    }
  }
  if (!originalRasa || !originalRasa.id) throw new Error('DEMO_ORIGINAL_RASA_UNAVAILABLE');
  const originalRasaId = String(originalRasa.id);

  const products = db.prepare(
    "SELECT id, brand_id, category_id, name, slug, description, price, regular_price, image_url, image, is_active FROM products WHERE brand_id = 'brand_bangjo' ORDER BY id"
  ).all();

  for (const product of products) {
    if (!product.category_id || !product.is_active) continue;

    const productId = String(product.id);
    const subCategoryId = 'demo_bangjo_sub_' + productId;
    const slugBase = String(product.name || productId).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || ('menu-' + productId);
    const subCategorySlug = 'demo-' + slugBase + '-' + productId;
    const menuId = 'demo_bangjo_menu_' + productId;

    db.prepare(
      "INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)"
    ).run(subCategoryId, 'brand_bangjo', product.category_id, product.name, subCategorySlug, Number(product.id) || 0);

    db.prepare(
      "INSERT OR IGNORE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, ?, 'ACTIVE')"
    ).run(menuId, 'brand_bangjo', subCategoryId, originalRasaId, Number(product.price || product.regular_price || 0));

    db.prepare(
      "INSERT OR IGNORE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)"
    ).run(menuId, productId);

    db.prepare(
      "UPDATE products SET sku = COALESCE(NULLIF(trim(sku), ''), ?) WHERE id = ? AND brand_id = ?"
    ).run('DEMO-' + productId, productId, 'brand_bangjo');
  }

  const branchProducts = db.prepare(
    "SELECT branch_id, product_id, branch_category_id, price, stock, is_available FROM branch_products ORDER BY branch_id, product_id"
  ).all();

  for (const bp of branchProducts) {
    const menuId = 'demo_bangjo_menu_' + String(bp.product_id);
    const menu = db.prepare("SELECT id FROM menus WHERE id = ? AND brand_id = 'brand_bangjo'").get(menuId);
    if (!menu) continue;

    db.prepare(
      "INSERT OR IGNORE INTO branch_menus (branch_id, menu_id, is_available, price_override) VALUES (?, ?, ?, ?)"
    ).run(bp.branch_id, menuId, bp.is_available == null ? 1 : Number(bp.is_available), bp.price == null ? null : Number(bp.price));

    if (bp.branch_category_id) {
      db.prepare(
        "INSERT OR IGNORE INTO branch_menu_categories (branch_id, menu_id, branch_category_id) VALUES (?, ?, ?)"
      ).run(bp.branch_id, menuId, bp.branch_category_id);
    }

    if (bp.stock != null) {
      db.prepare(
        "INSERT OR REPLACE INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold) VALUES (?, ?, ?, COALESCE((SELECT low_stock_threshold FROM branch_product_inventory WHERE branch_id = ? AND product_id = ?), 5))"
      ).run(bp.branch_id, bp.product_id, Math.max(0, Number(bp.stock)), bp.branch_id, bp.product_id);
    }
  }
}

function seedDemoFixtures() {
  let count = 0;
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM branches').get();
    count = row ? Number(row.n) : 0;
  } catch (_) {
    count = 0;
  }

  if (count === 0) {
    db.seedData(db);
    seedCanonicalDemoCatalog(db);
  }

  // Existing long-lived test databases may already have legacy demo rows; canonicalize them too.
  seedCanonicalDemoCatalog(db);

  return db;
}

module.exports = seedDemoFixtures;
