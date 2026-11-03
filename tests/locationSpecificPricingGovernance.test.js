const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db.js');

test('LOCATION-SPECIFIC PRICING (LSP) GOVERNANCE SUITE', async (t) => {
  const brandId = 'brand_test_lsp_' + Date.now();
  const branchMallId = 'branch_mall_' + Date.now();
  const branchRukoId = 'branch_ruko_' + Date.now();
  const productId = 'prod_lsp_' + Date.now();

  // 1. Seed brand, branches & product
  db.prepare(`
    INSERT OR REPLACE INTO brands (id, organization_id, name, slug)
    VALUES (?, 'org_xentra_holding', 'Test Brand LSP', 'test-brand-lsp')
  `).run(brandId);

  db.prepare(`
    INSERT OR REPLACE INTO branches (
      id, brand_id, name, slug, address_text, latitude, longitude, phone,
      is_active, is_open_override, is_online_paused, timezone
    ) VALUES 
    (?, ?, 'Cabang Mall Kelapa Gading', 'cabang-mall-kg', 'Mall KG Lt. 2', -6.1570, 106.9080, '08120000001', 1, 1, 0, 'Asia/Jakarta'),
    (?, ?, 'Cabang Tebet Ruko', 'cabang-tebet-ruko', 'Jl. Tebet Raya No. 10', -6.2200, 106.8500, '08120000002', 1, 1, 0, 'Asia/Jakarta')
  `).run(branchMallId, brandId, branchRukoId, brandId);

  db.prepare(`
    INSERT OR REPLACE INTO products (
      id, brand_id, name, slug, price, is_active, fulfillment_type
    ) VALUES (?, ?, 'Ayam Bakar Madu LSP', 'ayam-bakar-madu-lsp', 30000, 1, 'BY_ORDER')
  `).run(productId, brandId);

  // 2. Allocate product to both branches
  db.prepare(`
    INSERT OR REPLACE INTO branch_products (branch_id, product_id, price, stock, is_available)
    VALUES 
    (?, ?, 35000, NULL, 1),
    (?, ?, NULL, NULL, 1)
  `).run(branchMallId, productId, branchRukoId, productId);

  await t.test('1. Location-Specific Price Resolution: Mall uses override, Ruko uses base price', () => {
    // POS / Catalog price query pattern
    const mallRow = db.prepare(`
      SELECT COALESCE(bp.price, p.price) AS resolved_price, bp.price AS override_price, p.price AS base_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(branchMallId, productId);

    assert.strictEqual(mallRow.resolved_price, 35000, 'Branch Mall must resolve to Rp 35.000 override');
    assert.strictEqual(mallRow.override_price, 35000);
    assert.strictEqual(mallRow.base_price, 30000);

    const rukoRow = db.prepare(`
      SELECT COALESCE(bp.price, p.price) AS resolved_price, bp.price AS override_price, p.price AS base_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(branchRukoId, productId);

    assert.strictEqual(rukoRow.resolved_price, 30000, 'Branch Ruko must resolve to Rp 30.000 base price');
    assert.strictEqual(rukoRow.override_price, null, 'Branch Ruko override price must be NULL');
  });

  await t.test('2. Backend Read: GET /admin/products/:id includes branch_adoptions with per-branch price', () => {
    const branchAdoptions = db.prepare(`
      SELECT 
        b.id AS branch_id,
        b.name AS branch_name,
        bp.price AS branch_price,
        CASE WHEN bp.product_id IS NOT NULL THEN 1 ELSE 0 END AS is_adopted
      FROM branches b
      LEFT JOIN branch_products bp ON bp.branch_id = b.id AND bp.product_id = ?
      WHERE b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
      ORDER BY b.name ASC
    `).all(productId, brandId);

    assert.strictEqual(branchAdoptions.length, 2);
    const mall = branchAdoptions.find(b => b.branch_id === branchMallId);
    const ruko = branchAdoptions.find(b => b.branch_id === branchRukoId);

    assert.strictEqual(mall.branch_price, 35000);
    assert.strictEqual(ruko.branch_price, null);
  });

  await t.test('3. Master Price Mutation Isolation: Changing Base Price does NOT corrupt Branch Override', () => {
    // Owner updates base price holding-wide to Rp 32.000
    db.prepare('UPDATE products SET price = 32000 WHERE id = ?').run(productId);

    // Check Ruko (which follows master)
    const rukoRow = db.prepare(`
      SELECT COALESCE(bp.price, p.price) AS resolved_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(branchRukoId, productId);
    assert.strictEqual(rukoRow.resolved_price, 32000, 'Branch Ruko must automatically follow new base price Rp 32.000');

    // Check Mall (which has explicit override)
    const mallRow = db.prepare(`
      SELECT COALESCE(bp.price, p.price) AS resolved_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(branchMallId, productId);
    assert.strictEqual(mallRow.resolved_price, 35000, 'Branch Mall override price Rp 35.000 MUST be preserved!');
  });

  await t.test('4. Removing Override: Setting branch price to NULL restores Base Price inheritance', () => {
    db.prepare('UPDATE branch_products SET price = NULL WHERE branch_id = ? AND product_id = ?').run(branchMallId, productId);

    const mallRow = db.prepare(`
      SELECT COALESCE(bp.price, p.price) AS resolved_price, bp.price AS override_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(branchMallId, productId);

    assert.strictEqual(mallRow.override_price, null);
    assert.strictEqual(mallRow.resolved_price, 32000, 'Branch Mall must now inherit base price Rp 32.000');
  });

  // Cleanup
  db.prepare('DELETE FROM branch_products WHERE product_id = ?').run(productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  db.prepare('DELETE FROM branches WHERE id IN (?, ?)').run(branchMallId, branchRukoId);
  db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
});
