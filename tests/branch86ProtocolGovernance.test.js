const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db.js');

test('BRANCH 86 PROTOCOL & OWNER OBSERVABILITY SUITE', async (t) => {
  const brandId = 'brand_test_86_' + Date.now();
  const branchId = 'branch_86_' + Date.now();
  const productId = 'prod_86_' + Date.now();

  // Seed test brand, branch & product
  db.prepare(`
    INSERT OR REPLACE INTO brands (id, organization_id, name, slug)
    VALUES (?, 'org_xentra_holding', 'Test Brand 86', 'test-brand-86')
  `).run(brandId);

  db.prepare(`
    INSERT OR REPLACE INTO branches (
      id, brand_id, name, slug, address_text, latitude, longitude, phone,
      is_active, is_open_override, is_online_paused, timezone
    ) VALUES (?, ?, 'Cabang 86 Tebet', 'cabang-86-tebet', 'Jl. Tebet No. 86', -6.2200, 106.8500, '08123456788', 1, 1, 0, 'Asia/Jakarta')
  `).run(branchId, brandId);

  db.prepare(`
    INSERT OR REPLACE INTO products (
      id, brand_id, name, slug, price, is_active, fulfillment_type
    ) VALUES (?, ?, 'Ayam Bakar Madu Spesial', 'ayam-bakar-madu-spesial', 32000, 1, 'BY_ORDER')
  `).run(productId, brandId);

  // Allocate product to branch
  db.prepare(`
    INSERT OR REPLACE INTO branch_products (
      branch_id, product_id, price, stock, is_available
    ) VALUES (?, ?, 32000, NULL, 1)
  `).run(branchId, productId);

  await t.test('1. Initial State: items_86_count is 0 when item is available', () => {
    const branchRow = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM branch_products bp WHERE bp.branch_id = b.id AND (bp.is_available = 0 OR bp.stock <= 0)) AS items_86_count
      FROM branches b WHERE b.id = ?
    `).get(branchId);
    assert.strictEqual(branchRow.items_86_count, 0, 'Initial items_86_count must be 0');
  });

  await t.test('2. Kasir marks item as 86 (is_available = 0): items_86_count increments to 1', () => {
    db.prepare('UPDATE branch_products SET is_available = 0, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?').run(branchId, productId);

    const branchRow = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM branch_products bp WHERE bp.branch_id = b.id AND (bp.is_available = 0 OR bp.stock <= 0)) AS items_86_count
      FROM branches b WHERE b.id = ?
    `).get(branchId);
    assert.strictEqual(branchRow.items_86_count, 1, 'items_86_count must be 1 after kasir marks item 86');
  });

  await t.test('3. GET /admin/branches/:id/items-86 query returns item details', () => {
    const items = db.prepare(`
      SELECT 
        bp.product_id,
        p.name AS product_name,
        COALESCE(bp.price, p.price) AS price,
        bp.is_available
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND (bp.is_available = 0 OR bp.stock <= 0)
    `).all(brandId, branchId);

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].product_id, productId);
    assert.strictEqual(items[0].product_name, 'Ayam Bakar Madu Spesial');
    assert.strictEqual(items[0].is_available, 0);
  });

  await t.test('4. Owner opens item back (un-86): is_available restored to 1 and items_86_count resets to 0', () => {
    db.prepare('UPDATE branch_products SET is_available = 1, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?').run(branchId, productId);

    const branchRow = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM branch_products bp WHERE bp.branch_id = b.id AND (bp.is_available = 0 OR bp.stock <= 0)) AS items_86_count
      FROM branches b WHERE b.id = ?
    `).get(branchId);
    assert.strictEqual(branchRow.items_86_count, 0, 'items_86_count must reset to 0 after opening item');

    const items = db.prepare(`
      SELECT bp.product_id FROM branch_products bp
      WHERE bp.branch_id = ? AND (bp.is_available = 0 OR bp.stock <= 0)
    `).all(branchId);
    assert.strictEqual(items.length, 0, 'No items should be returned in 86 list');
  });

  // Cleanup
  db.prepare('DELETE FROM branch_products WHERE branch_id = ?').run(branchId);
  db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  db.prepare('DELETE FROM branches WHERE id = ?').run(branchId);
  db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
});
