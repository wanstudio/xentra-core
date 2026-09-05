'use strict';

/**
 * MASTER CATALOG ↔ BRANCH CATALOG — Relationship Model Tests
 *
 * Tests prove the physical model implements the locked Xentra contract:
 * - Master Catalog = Owner/Brand master library
 * - Branch Catalog = Branch-owned operational selling catalog
 * - Adoption = Save Point (snapshot semantics)
 * - Master mutation ≠ automatic Branch mutation
 * - Master Category ≠ Branch Category
 * - Branch Context reads Branch Catalog (no master fallback)
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const { CatalogService } = require('../../domains/commerce');

const BRAND = 'brand_test_rc';
const ORG = 'org_test_rc';
const MASTER_CAT = 'mc_test';
const BRANCH_A = 'ba_test';
const BRANCH_B = 'bb_test';
const PRODUCT_X = 'px_test';
const PRODUCT_Y = 'py_test';
const PRODUCT_Z = 'pz_test';
const PRODUCT_UNADOPTED = 'pu_test';

test.before(() => {
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Org RC', 'org-rc')`).run(ORG);
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Brand RC', 'brand-rc')`).run(BRAND, ORG);
  db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES (?, ?, 'Master Makanan', 'master-makanan')`).run(MASTER_CAT, BRAND);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Branch A', 'ba', 'Jl. A', -7.25, 112.75)`).run(BRANCH_A, BRAND);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Branch B', 'bb', 'Jl. B', -7.28, 112.76)`).run(BRANCH_B, BRAND);

  // Master products — use 'range' pricing so branch prices take effect
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price) VALUES (?, ?, ?, 'Product X', 'px', 'Desc X', 25000, 25000, 'img-x.png', 1, 'range', 20000, 30000)").run(PRODUCT_X, BRAND, MASTER_CAT);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price) VALUES (?, ?, ?, 'Product Y', 'py', 'Desc Y', 30000, 30000, 'img-y.png', 1, 'range', 25000, 35000)").run(PRODUCT_Y, BRAND, MASTER_CAT);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price) VALUES (?, ?, ?, 'Product Z', 'pz', 'Desc Z', 15000, 15000, 'img-z.png', 1, 'range', 10000, 20000)").run(PRODUCT_Z, BRAND, MASTER_CAT);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price) VALUES (?, ?, ?, 'Unadopted', 'pu', 'No branch wants this', 10000, 10000, 'img-pu.png', 1, 'range', 8000, 12000)").run(PRODUCT_UNADOPTED, BRAND, MASTER_CAT);

  // Branch categories for Branch A
  db.prepare(`INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order) VALUES (?, ?, ?, 'Menu Favorit', 'menu-favorit', 1)`).run('bc_a_fav', BRAND, BRANCH_A);
  db.prepare(`INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order) VALUES (?, ?, ?, 'Minuman', 'minuman', 2)`).run('bc_a_drink', BRAND, BRANCH_A);

  // Branch categories for Branch B
  db.prepare(`INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order) VALUES (?, ?, ?, 'Paket Hemat', 'paket-hemat', 1)`).run('bc_b_paket', BRAND, BRANCH_B);
  db.prepare(`INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order) VALUES (?, ?, ?, 'Kopi & Teh', 'kopi-teh', 2)`).run('bc_b_kopi', BRAND, BRANCH_B);

  // Branch A adopts: Product X (Menu Favorit), Product Y (Minuman)
  db.prepare("INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, product_name, product_description, product_image_url, price, stock, is_available) VALUES (?, ?, ?, 'Product X', 'Desc X', 'img-x.png', 25000, 50, 1)").run(BRANCH_A, PRODUCT_X, 'bc_a_fav');
  db.prepare("INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, product_name, product_description, product_image_url, price, stock, is_available) VALUES (?, ?, ?, 'Product Y', 'Desc Y', 'img-y.png', 28000, 30, 1)").run(BRANCH_A, PRODUCT_Y, 'bc_a_drink');

  // Branch B adopts: Product X (Paket Hemat) — same product, different branch category
  db.prepare("INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, product_name, product_description, product_image_url, price, stock, is_available) VALUES (?, ?, ?, 'Product X', 'Desc X', 'img-x.png', 27000, 75, 1)").run(BRANCH_B, PRODUCT_X, 'bc_b_paket');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 1 — Master-only product
// A Master Product can exist without any Branch adopting it.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 1 — Master-only product exists without any branch adoption', () => {
  const masterProduct = db.prepare('SELECT * FROM products WHERE id = ? AND brand_id = ?').get(PRODUCT_UNADOPTED, BRAND);
  assert.ok(masterProduct, 'Master product exists');
  assert.strictEqual(masterProduct.name, 'Unadopted');

  // No branch has adopted it
  const branchAdoptions = db.prepare('SELECT * FROM branch_products WHERE product_id = ?').all(PRODUCT_UNADOPTED);
  assert.strictEqual(branchAdoptions.length, 0, 'No branch_products rows for unadopted product');

  // It should NOT appear in any branch catalog
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const inMenuA = menuA.products.find(p => p.id === PRODUCT_UNADOPTED);
  assert.ok(!inMenuA, 'Unadopted product does NOT appear in Branch A menu');

  const menuB = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });
  const inMenuB = menuB.products.find(p => p.id === PRODUCT_UNADOPTED);
  assert.ok(!inMenuB, 'Unadopted product does NOT appear in Branch B menu');

  // But it SHOULD appear in brand-wide catalog
  const brandMenu = CatalogService.getMenu({ brand_id: BRAND });
  const inBrand = brandMenu.products.find(p => p.id === PRODUCT_UNADOPTED);
  assert.ok(inBrand, 'Unadopted product appears in brand-wide (Master) catalog');
  assert.strictEqual(inBrand.is_available, true, 'Brand-wide shows all active products as available');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 2 — Branch adoption
// Branch A adopts Master Product X. Branch Product preserves master provenance.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 2 — Branch adoption preserves master provenance', () => {
  const adoption = db.prepare('SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A, PRODUCT_X);
  assert.ok(adoption, 'Branch A has adopted Product X');
  assert.strictEqual(adoption.product_name, 'Product X', 'Snapshot preserves master product name');
  assert.strictEqual(adoption.product_description, 'Desc X', 'Snapshot preserves master description');
  assert.strictEqual(adoption.product_image_url, 'img-x.png', 'Snapshot preserves master image');
  assert.strictEqual(adoption.price, 25000, 'Branch price is set');
  assert.strictEqual(adoption.stock, 50, 'Branch stock is set');
  assert.strictEqual(adoption.is_available, 1, 'Branch availability is set');
  assert.strictEqual(String(adoption.branch_category_id), 'bc_a_fav', 'Branch category is branch-owned');

  // FK to master product still exists (provenance)
  const masterProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(PRODUCT_X);
  assert.ok(masterProduct, 'Master product still exists');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 3 — Different branch subsets
// Branch A has Product X and Y. Branch B has only Product X.
// Product Y is invisible in Branch B Catalog.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 3 — Different branch subsets: Product Y invisible in Branch B', () => {
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const productYinA = menuA.products.find(p => p.id === PRODUCT_Y);
  assert.ok(productYinA, 'Branch A has Product Y');
  assert.strictEqual(productYinA.is_available, true, 'Product Y is available at Branch A');

  const menuB = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });
  const productYinB = menuB.products.find(p => p.id === PRODUCT_Y);
  assert.ok(!productYinB, 'Product Y does NOT appear in Branch B catalog');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 4 — Different Branch Categories
// Branch A places Product X in "Menu Favorit".
// Branch B places Product X in "Paket Hemat".
// Master Product category does NOT determine Branch Category.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 4 — Different Branch Categories: same product, different branch placement', () => {
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pXinA = menuA.products.find(p => p.id === PRODUCT_X);
  assert.ok(pXinA, 'Product X in Branch A');
  assert.strictEqual(String(pXinA.category_id), 'bc_a_fav', 'Branch A places Product X in Menu Favorit');

  const menuB = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });
  const pXinB = menuB.products.find(p => p.id === PRODUCT_X);
  assert.ok(pXinB, 'Product X in Branch B');
  assert.strictEqual(String(pXinB.category_id), 'bc_b_paket', 'Branch B places Product X in Paket Hemat');

  // Verify category names are different
  const catA = menuA.categories.find(c => String(c.id) === 'bc_a_fav');
  const catB = menuB.categories.find(c => String(c.id) === 'bc_b_paket');
  assert.ok(catA, 'Branch A has Menu Favorit category');
  assert.ok(catB, 'Branch B has Paket Hemat category');
  assert.notStrictEqual(catA.name, catB.name, 'Category names differ between branches');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 5 — Master mutation isolation (snapshot semantics)
// Adopt Product X into Branch A. Then change Master Product X name/metadata.
// Branch Catalog MUST NOT silently mutate.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 5 — Master mutation isolation: snapshot prevents silent Branch mutation', () => {
  // Snapshot the current branch product name
  const before = db.prepare('SELECT product_name, product_description, product_image_url FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A, PRODUCT_X);
  assert.strictEqual(before.product_name, 'Product X', 'Before: snapshot has original name');

  // Mutate the Master Product
  db.prepare("UPDATE products SET name = 'RENAMED BY OWNER', description = 'New desc', image_url = 'new-img.png' WHERE id = ? AND brand_id = ?").run(PRODUCT_X, BRAND);

  // Branch Catalog must still show the ORIGINAL snapshot
  const adoption = db.prepare('SELECT product_name, product_description, product_image_url FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A, PRODUCT_X);
  assert.strictEqual(adoption.product_name, 'Product X', 'Branch snapshot NOT mutated by master change');
  assert.strictEqual(adoption.product_description, 'Desc X', 'Branch description NOT mutated');
  assert.strictEqual(adoption.product_image_url, 'img-x.png', 'Branch image NOT mutated');

  // CatalogService should also return the snapshot values
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pX = menuA.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pX.name, 'Product X', 'CatalogService returns snapshot name, not mutated master name');
  assert.strictEqual(pX.description, 'Desc X', 'CatalogService returns snapshot description');

  // Restore master product for other tests
  db.prepare("UPDATE products SET name = 'Product X', description = 'Desc X', image_url = 'img-x.png' WHERE id = ? AND brand_id = ?").run(PRODUCT_X, BRAND);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 6 — Branch operational isolation
// Branch A: stock=50, available=true, price=25000
// Branch B: stock=75, available=true, price=27000
// Changing Branch A does not mutate Branch B.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 6 — Branch operational isolation: independent stock/price/availability', () => {
  // Verify Branch A state
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pXA = menuA.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pXA.stock_estimate, 50, 'Branch A stock = 50');
  assert.strictEqual(pXA.price, 25000, 'Branch A price = 25000');

  // Verify Branch B state
  const menuB = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });
  const pXB = menuB.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pXB.stock_estimate, 75, 'Branch B stock = 75');
  assert.strictEqual(pXB.price, 27000, 'Branch B price = 27000');

  // Change Branch A stock
  db.prepare('UPDATE branch_products SET stock = 5 WHERE branch_id = ? AND product_id = ?').run(BRANCH_A, PRODUCT_X);

  // Branch B must be unaffected
  const menuB2 = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });
  const pXB2 = menuB2.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pXB2.stock_estimate, 75, 'Branch B stock unchanged after Branch A mutation');

  // Restore Branch A
  db.prepare('UPDATE branch_products SET stock = 50 WHERE branch_id = ? AND product_id = ?').run(BRANCH_A, PRODUCT_X);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 7 — No master fallback
// Request Branch A Catalog. Product Y is adopted by Branch A.
// Product Z is NOT adopted by Branch A — must NOT appear even if it exists in Master.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 7 — No master fallback: non-adopted product does not appear in branch menu', () => {
  // Product Z exists in Master Catalog
  const masterZ = db.prepare('SELECT * FROM products WHERE id = ? AND brand_id = ?').get(PRODUCT_Z, BRAND);
  assert.ok(masterZ, 'Product Z exists in Master Catalog');

  // But Branch A has not adopted it
  const adoptionA = db.prepare('SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A, PRODUCT_Z);
  assert.ok(!adoptionA, 'Branch A has NOT adopted Product Z');

  // Branch A menu must NOT show Product Z
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pZ = menuA.products.find(p => p.id === PRODUCT_Z);
  assert.ok(!pZ, 'Product Z does NOT appear in Branch A menu (no master fallback)');

  // Branch A should only have its adopted products
  const adoptedIds = menuA.products.map(p => p.id);
  assert.deepStrictEqual(adoptedIds.sort(), [PRODUCT_X, PRODUCT_Y].sort(), 'Branch A menu contains exactly adopted products');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 8 — Cross-branch independence
// Branch A and Branch B adopt the same Master Product but maintain independent:
// category, stock, availability, price, operational state, branch-specific metadata.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 8 — Cross-branch independence: same product, fully independent branch state', () => {
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const menuB = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });

  const pXA = menuA.products.find(p => p.id === PRODUCT_X);
  const pXB = menuB.products.find(p => p.id === PRODUCT_X);

  // Both branches have the product
  assert.ok(pXA, 'Branch A has Product X');
  assert.ok(pXB, 'Branch B has Product X');

  // Different categories
  assert.notStrictEqual(String(pXA.category_id), String(pXB.category_id), 'Different branch categories');

  // Different stock
  assert.notStrictEqual(pXA.stock_estimate, pXB.stock_estimate, 'Different branch stock');

  // Different prices
  assert.notStrictEqual(pXA.price, pXB.price, 'Different branch prices');

  // Both available
  assert.strictEqual(pXA.is_available, true, 'Available at Branch A');
  assert.strictEqual(pXB.is_available, true, 'Available at Branch B');

  // Branch categories are different structures
  const catNamesA = menuA.categories.map(c => c.name);
  const catNamesB = menuB.categories.map(c => c.name);
  assert.ok(catNamesA.includes('Menu Favorit'), 'Branch A has Menu Favorit');
  assert.ok(catNamesB.includes('Paket Hemat'), 'Branch B has Paket Hemat');
  assert.ok(!catNamesA.includes('Paket Hemat'), 'Branch A does NOT have Branch B categories');
  assert.ok(!catNamesB.includes('Menu Favorit'), 'Branch B does NOT have Branch A categories');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 9 — Branch category is independent from Master category
// Master Product X belongs to Master Category "Master Makanan".
// Branch A places it in "Menu Favorit". Branch B places it in "Paket Hemat".
// Master category assignment does NOT determine branch placement.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 9 — Branch category independent from Master category', () => {
  // Master Product X is in Master Category "Master Makanan"
  const masterProd = db.prepare('SELECT category_id FROM products WHERE id = ?').get(PRODUCT_X);
  assert.strictEqual(String(masterProd.category_id), MASTER_CAT, 'Master product in Master category');

  // But Branch A catalog shows it under "Menu Favorit"
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pXA = menuA.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(String(pXA.category_id), 'bc_a_fav', 'Branch A uses branch category, not master category');

  // And Branch B catalog shows it under "Paket Hemat"
  const menuB = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });
  const pXB = menuB.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(String(pXB.category_id), 'bc_b_paket', 'Branch B uses branch category, not master category');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 10 — Brand-wide catalog still shows all master products
// The brand-wide (no branch context) catalog uses Master Catalog,
// unaffected by branch adoption state.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 10 — Brand-wide catalog shows all master products regardless of adoption', () => {
  const brandMenu = CatalogService.getMenu({ brand_id: BRAND });

  // All 4 master products appear
  const ids = brandMenu.products.map(p => p.id);
  assert.ok(ids.includes(PRODUCT_X), 'Brand-wide has Product X');
  assert.ok(ids.includes(PRODUCT_Y), 'Brand-wide has Product Y');
  assert.ok(ids.includes(PRODUCT_Z), 'Brand-wide has Product Z');
  assert.ok(ids.includes(PRODUCT_UNADOPTED), 'Brand-wide has Unadopted product');

  // All marked as available (brand-wide has no branch context)
  for (const p of brandMenu.products) {
    assert.strictEqual(p.is_available, true, `Brand-wide ${p.id} is available`);
    assert.strictEqual(p.stock_estimate, null, `Brand-wide ${p.id} has null stock`);
  }

  // Uses master categories, not branch categories
  const catNames = brandMenu.categories.map(c => c.name);
  assert.ok(catNames.includes('Master Makanan'), 'Brand-wide uses master categories');
});
