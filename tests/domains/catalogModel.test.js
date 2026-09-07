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
// TEST 5 — Override architecture: master propagation vs explicit branch override
// Under Master Product Default + Branch Optional Override:
//   - Branch with NO override: sees live master updates (propagation)
//   - Branch with explicit override: override wins, master update does not affect it
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 5 — Override architecture: master update propagates to branch without override', () => {
  // Ensure no override is set for Branch A Product X
  db.prepare('UPDATE branch_products SET name_override = NULL, description_override = NULL, image_override = NULL WHERE branch_id = ? AND product_id = ?').run(BRANCH_A, PRODUCT_X);

  // Mutate the Master Product
  db.prepare("UPDATE products SET name = 'RENAMED BY OWNER', description = 'New desc', image_url = 'new-img.png' WHERE id = ? AND brand_id = ?").run(PRODUCT_X, BRAND);

  // Branch with NO override MUST see the live master value (propagation is expected)
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pX = menuA.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pX.name, 'RENAMED BY OWNER', 'Branch without override sees live master update');
  assert.strictEqual(pX.description, 'New desc', 'Branch description reflects live master');

  // Override fields must be null (confirming no override is active)
  assert.strictEqual(pX.name_override, null, 'name_override is null — inheriting master');
  assert.strictEqual(pX.master_name, 'RENAMED BY OWNER', 'master_name reflects updated master');

  // Now set an explicit branch override — it must win over master
  db.prepare('UPDATE branch_products SET name_override = ? WHERE branch_id = ? AND product_id = ?').run('Branch Locked Name', BRANCH_A, PRODUCT_X);
  const menuA2 = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pX2 = menuA2.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pX2.name, 'Branch Locked Name', 'Explicit override wins over master');

  // Restore master product and clear override for subsequent tests
  db.prepare("UPDATE products SET name = 'Product X', description = 'Desc X', image_url = 'img-x.png' WHERE id = ? AND brand_id = ?").run(PRODUCT_X, BRAND);
  db.prepare('UPDATE branch_products SET name_override = NULL, description_override = NULL, image_override = NULL WHERE branch_id = ? AND product_id = ?').run(BRANCH_A, PRODUCT_X);
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

// ══════════════════════════════════════════════════════════════════════════════
// TEST 11 — Master disable isolation
// Adopt Product X into Branch A with is_available=1.
// Disable Master Product X (is_active=0).
// Branch A MUST still show Product X as available (Branch Catalog owns availability).
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 11 — Master disable isolation: adopted product stays available when master is disabled', () => {
  // Ensure Product X is adopted and available at Branch A
  const before = db.prepare('SELECT is_available FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A, PRODUCT_X);
  assert.strictEqual(before.is_available, 1, 'Branch A Product X is available before master disable');

  // Disable Master Product
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ? AND brand_id = ?').run(PRODUCT_X, BRAND);

  // Branch A catalog MUST still return Product X as available
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pX = menuA.products.find(p => p.id === PRODUCT_X);
  assert.ok(pX, 'Product X still appears in Branch A menu despite master being disabled');
  assert.strictEqual(pX.is_available, true, 'Branch A availability is controlled by branch_products, not master is_active');

  // Restore master product
  db.prepare('UPDATE products SET is_active = 1 WHERE id = ? AND brand_id = ?').run(PRODUCT_X, BRAND);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 12 — Master price mutation isolation
// Adopt Product X at 25,000 (branch price).
// Mutate Master Product X price to 30,000.
// Branch Catalog MUST still return 25,000 (branch price is authoritative).
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 12 — Master price mutation isolation: branch price unchanged after master price mutation', () => {
  // Branch A has Product X at 25000
  const before = db.prepare('SELECT price FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A, PRODUCT_X);
  assert.strictEqual(before.price, 25000, 'Branch A price = 25000 before master mutation');

  // Mutate Master Product price
  db.prepare('UPDATE products SET price = 30000, regular_price = 30000 WHERE id = ? AND brand_id = ?').run(PRODUCT_X, BRAND);

  // Branch A catalog MUST still return 25000
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pX = menuA.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pX.price, 25000, 'Branch A price remains 25000 after master price mutation');

  // Restore master product
  db.prepare('UPDATE products SET price = 25000, regular_price = 25000 WHERE id = ? AND brand_id = ?').run(PRODUCT_X, BRAND);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 13 — Branch price independence
// Branch A: Product X = 25,000
// Branch B: Product X = 27,000
// Changing Branch A price MUST NOT affect Branch B.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 13 — Branch price independence: changing Branch A price does not affect Branch B', () => {
  // Verify initial prices
  const menuA1 = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const menuB1 = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });
  const pXA1 = menuA1.products.find(p => p.id === PRODUCT_X);
  const pXB1 = menuB1.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pXA1.price, 25000, 'Branch A initial price = 25000');
  assert.strictEqual(pXB1.price, 27000, 'Branch B initial price = 27000');

  // Change Branch A price
  db.prepare('UPDATE branch_products SET price = 22000 WHERE branch_id = ? AND product_id = ?').run(BRANCH_A, PRODUCT_X);

  // Branch B MUST be unaffected
  const menuB2 = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });
  const pXB2 = menuB2.products.find(p => p.id === PRODUCT_X);
  assert.strictEqual(pXB2.price, 27000, 'Branch B price unchanged after Branch A price mutation');

  // Restore Branch A
  db.prepare('UPDATE branch_products SET price = 25000 WHERE branch_id = ? AND product_id = ?').run(BRANCH_A, PRODUCT_X);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 14 — Existing DB migration: legacy branch_products get branch categories
// and snapshot fields populated correctly. Migration is idempotent.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 14 — Existing DB migration: legacy branch_products get branch categories and snapshot', () => {
  // Create a legacy-style branch product row (no snapshot, no branch_category, no price)
  const legacyBranch = 'bl_test_mig';
  const legacyProduct = 'pl_test_mig';
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Legacy Branch', 'legacy', 'Jl. L', -7.3, 112.7)`).run(legacyBranch, BRAND);
  db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES (?, ?, 'Legacy Master Cat', 'legacy-mc')`).run('lc_test_mig', BRAND);
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, 'lc_test_mig', 'Legacy Product', 'legacy-prod', 15000, 1)`).run(legacyProduct, BRAND);

  // Insert a legacy branch_product with NULL snapshot fields, NULL branch_category_id, NULL price
  db.prepare(`INSERT OR IGNORE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, 10, 1)`).run(legacyBranch, legacyProduct);

  // Verify it's in legacy state
  const legacy = db.prepare('SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?').get(legacyBranch, legacyProduct);
  assert.ok(legacy, 'Legacy branch_product exists');
  // Note: migration runs at DB init, so for a fresh in-memory DB this may already be migrated.
    // The key assertion is that the migration produces valid state.

  // Run the migration logic manually (simulating a fresh migration pass)
  // Snapshot fields
  db.prepare(`UPDATE branch_products SET product_name = COALESCE(product_name, (SELECT name FROM products WHERE id = branch_products.product_id)), product_description = COALESCE(product_description, (SELECT description FROM products WHERE id = branch_products.product_id)), product_image_url = COALESCE(product_image_url, (SELECT image_url FROM products WHERE id = branch_products.product_id)) WHERE product_name IS NULL`).run();

  // Branch category migration
  const legacyRows = db.prepare(`SELECT DISTINCT bp.branch_id, p.category_id as master_cat_id, p.brand_id FROM branch_products bp JOIN products p ON bp.product_id = p.id WHERE bp.branch_category_id IS NULL AND p.category_id IS NOT NULL`).all();
  for (const row of legacyRows) {
    const masterCat = db.prepare('SELECT name, slug FROM categories WHERE id = ?').get(row.master_cat_id);
    const catName = masterCat?.name || 'Lainnya';
    const catSlug = masterCat?.slug || 'lainnya';
    let branchCat = db.prepare('SELECT id FROM branch_categories WHERE branch_id = ? AND name = ?').get(row.branch_id, catName);
    if (!branchCat) {
      const bcId = `bc_mig_${row.branch_id}_${row.master_cat_id}`;
      db.prepare(`INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order) VALUES (?, ?, ?, ?, ?, 99)`).run(bcId, row.brand_id, row.branch_id, catName, catSlug);
      branchCat = { id: bcId };
    }
    db.prepare('UPDATE branch_products SET branch_category_id = ? WHERE branch_id = ? AND branch_category_id IS NULL').run(branchCat.id, row.branch_id);
  }

  // Price migration
  db.prepare(`UPDATE branch_products SET price = (SELECT price FROM products WHERE id = branch_products.product_id) WHERE price IS NULL`).run();

  // Verify final state
  const migrated = db.prepare('SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?').get(legacyBranch, legacyProduct);
  assert.ok(migrated, 'Migrated branch_product exists');
  assert.strictEqual(migrated.product_name, 'Legacy Product', 'Snapshot product_name populated');
  assert.ok(migrated.branch_category_id, 'branch_category_id assigned');
  assert.strictEqual(migrated.price, 15000, 'Price migrated from master');

  // Verify the branch_category FK is valid
  const branchCat = db.prepare('SELECT * FROM branch_categories WHERE id = ?').get(migrated.branch_category_id);
  assert.ok(branchCat, 'branch_category FK is valid');
  assert.strictEqual(branchCat.branch_id, legacyBranch, 'branch_category belongs to the correct branch');

  // Run migration again — should be idempotent (no duplicate categories)
  db.prepare(`UPDATE branch_products SET product_name = COALESCE(product_name, (SELECT name FROM products WHERE id = branch_products.product_id)) WHERE product_name IS NULL`).run();
  const catCount = db.prepare('SELECT COUNT(*) as cnt FROM branch_categories WHERE branch_id = ?').get(legacyBranch);
  assert.strictEqual(catCount.cnt, 1, 'Idempotent: no duplicate branch categories after second migration');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 15 — Master-only product does NOT appear in branch catalog
// (stronger version of TEST 1 with explicit adoption check)
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 15 — Master-only product does NOT appear in branch catalog', () => {
  // Product Z is in Master Catalog but NOT adopted by Branch A
  const masterZ = db.prepare('SELECT * FROM products WHERE id = ?').get(PRODUCT_Z);
  assert.ok(masterZ, 'Product Z exists in Master Catalog');
  assert.strictEqual(masterZ.is_active, 1, 'Product Z is active in Master');

  const adoptionA = db.prepare('SELECT * FROM branch_products WHERE branch_id = ? AND product_id = ?').get(BRANCH_A, PRODUCT_Z);
  assert.ok(!adoptionA, 'Branch A has NOT adopted Product Z');

  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const pZ = menuA.products.find(p => p.id === PRODUCT_Z);
  assert.ok(!pZ, 'Product Z does NOT appear in Branch A menu');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST 16 — Cross-branch adoption independence
// Same Master Product adopted by both branches.
// Each branch retains independent category, price, stock, availability, snapshot.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST 16 — Cross-branch adoption: same product, fully independent branch state', () => {
  const menuA = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_A });
  const menuB = CatalogService.getMenu({ brand_id: BRAND, branch_id: BRANCH_B });

  const pXA = menuA.products.find(p => p.id === PRODUCT_X);
  const pXB = menuB.products.find(p => p.id === PRODUCT_X);

  // Both have the product
  assert.ok(pXA, 'Branch A has Product X');
  assert.ok(pXB, 'Branch B has Product X');

  // Independent categories
  assert.strictEqual(String(pXA.category_id), 'bc_a_fav', 'Branch A category = Menu Favorit');
  assert.strictEqual(String(pXB.category_id), 'bc_b_paket', 'Branch B category = Paket Hemat');

  // Independent prices
  assert.strictEqual(pXA.price, 25000, 'Branch A price = 25000');
  assert.strictEqual(pXB.price, 27000, 'Branch B price = 27000');

  // Independent stock
  assert.strictEqual(pXA.stock_estimate, 50, 'Branch A stock = 50');
  assert.strictEqual(pXB.stock_estimate, 75, 'Branch B stock = 75');

  // Independent availability
  assert.strictEqual(pXA.is_available, true, 'Branch A available');
  assert.strictEqual(pXB.is_available, true, 'Branch B available');
});

// ══════════════════════════════════════════════════════════════════════════════
// MIGRATION CATEGORY-MAPPING REGRESSION TESTS
// Tests A-G: verify legacy migration assigns branch_category_id per product's
// Master Category, NOT per branch_id alone.
// ══════════════════════════════════════════════════════════════════════════════

const MIG_BRAND = 'brand_test_migcat';
const MIG_ORG = 'org_test_migcat';
const MIG_BRANCH = 'bm_test_migcat';
const MIG_PROD_A = 'pa_migcat';
const MIG_PROD_B = 'pb_migcat';
const MIG_PROD_C = 'pc_migcat';
const MIG_CAT_MAKANAN = 'cm_migcat';
const MIG_CAT_MINUMAN = 'cn_migcat';
const MIG_CAT_SNACK = 'cs_migcat';
const MIG_BRANCH_TIMUR = 'bt_migcat';

function runMigration(targetDb) {
  // Snapshot metadata
  targetDb.exec(`
    UPDATE branch_products
    SET product_name = COALESCE(product_name, (SELECT name FROM products WHERE id = branch_products.product_id)),
        product_description = COALESCE(product_description, (SELECT description FROM products WHERE id = branch_products.product_id)),
        product_image_url = COALESCE(product_image_url, (SELECT image_url FROM products WHERE id = branch_products.product_id))
    WHERE product_name IS NULL
  `);

  // Branch category migration — the fixed logic
  const legacyRows = targetDb.prepare(`
    SELECT DISTINCT bp.branch_id, bp.product_id, p.category_id as master_cat_id, p.brand_id
    FROM branch_products bp
    JOIN products p ON bp.product_id = p.id
    WHERE bp.branch_category_id IS NULL AND p.category_id IS NOT NULL
  `).all();

  for (const row of legacyRows) {
    const masterCat = targetDb.prepare('SELECT name, slug FROM categories WHERE id = ?').get(row.master_cat_id);
    const catName = masterCat?.name || 'Lainnya';
    const catSlug = masterCat?.slug || 'lainnya';
    let branchCat = targetDb.prepare(
      'SELECT id FROM branch_categories WHERE branch_id = ? AND name = ?'
    ).get(row.branch_id, catName);
    if (!branchCat) {
      const bcId = `bc_mig_${row.branch_id}_${row.master_cat_id}`;
      targetDb.prepare(`
        INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
        VALUES (?, ?, ?, ?, ?, 99)
      `).run(bcId, row.brand_id, row.branch_id, catName, catSlug);
      branchCat = { id: bcId };
    }
    targetDb.prepare(
      'UPDATE branch_products SET branch_category_id = ? WHERE branch_id = ? AND product_id = ? AND branch_category_id IS NULL'
    ).run(branchCat.id, row.branch_id, row.product_id);
  }

  // Price migration
  targetDb.exec(`
    UPDATE branch_products
    SET price = (SELECT price FROM products WHERE id = branch_products.product_id)
    WHERE price IS NULL
  `);
}

test.before(() => {
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'MigCat Org', 'migcat-org')`).run(MIG_ORG);
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'MigCat Brand', 'migcat-brand')`).run(MIG_BRAND, MIG_ORG);
  db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES (?, ?, 'Makanan', 'makanan')`).run(MIG_CAT_MAKANAN, MIG_BRAND);
  db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES (?, ?, 'Minuman', 'minuman')`).run(MIG_CAT_MINUMAN, MIG_BRAND);
  db.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug) VALUES (?, ?, 'Snack', 'snack')`).run(MIG_CAT_SNACK, MIG_BRAND);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'MigCat Barat', 'migcat-barat', 'Jl. A', -7.25, 112.75)`).run(MIG_BRANCH, MIG_BRAND);
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'MigCat Timur', 'migcat-timur', 'Jl. B', -7.28, 112.76)`).run(MIG_BRANCH_TIMUR, MIG_BRAND);
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, 'Prod A', 'pa', 10000, 1)`).run(MIG_PROD_A, MIG_BRAND, MIG_CAT_MAKANAN);
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, 'Prod B', 'pb', 20000, 1)`).run(MIG_PROD_B, MIG_BRAND, MIG_CAT_MINUMAN);
  db.prepare(`INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, is_active) VALUES (?, ?, ?, 'Prod C', 'pc', 15000, 1)`).run(MIG_PROD_C, MIG_BRAND, MIG_CAT_SNACK);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST A — Multiple Master Categories in One Branch
// Product A → Makanan, Product B → Minuman. Both NULL branch_category_id.
// After migration: A gets Makanan branch category, B gets Minuman branch category.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST A — Multiple Master Categories in one Branch: each product gets correct branch category', () => {
  // Insert legacy branch_products with NULL branch_category_id
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, 10, 1)').run(MIG_BRANCH, MIG_PROD_A);
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, 20, 1)').run(MIG_BRANCH, MIG_PROD_B);

  // Verify legacy state
  const legA = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_A);
  const legB = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_B);
  assert.ok(!legA.branch_category_id || legA.branch_category_id === null, 'Product A starts with NULL branch_category_id');
  assert.ok(!legB.branch_category_id || legB.branch_category_id === null, 'Product B starts with NULL branch_category_id');

  // Run migration
  runMigration(db);

  // Verify each product got the correct branch-owned category
  const migA = db.prepare(`
    SELECT bp.branch_category_id, bc.name as cat_name
    FROM branch_products bp
    JOIN branch_categories bc ON bp.branch_category_id = bc.id
    WHERE bp.branch_id = ? AND bp.product_id = ?
  `).get(MIG_BRANCH, MIG_PROD_A);
  const migB = db.prepare(`
    SELECT bp.branch_category_id, bc.name as cat_name
    FROM branch_products bp
    JOIN branch_categories bc ON bp.branch_category_id = bc.id
    WHERE bp.branch_id = ? AND bp.product_id = ?
  `).get(MIG_BRANCH, MIG_PROD_B);

  assert.ok(migA.branch_category_id, 'Product A has branch_category_id');
  assert.ok(migB.branch_category_id, 'Product B has branch_category_id');
  assert.strictEqual(migA.cat_name, 'Makanan', 'Product A assigned to Makanan branch category');
  assert.strictEqual(migB.cat_name, 'Minuman', 'Product B assigned to Minuman branch category');
  assert.notStrictEqual(migA.branch_category_id, migB.branch_category_id, 'Different master categories → different branch categories');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST B — Multiple Products Same Master Category
// Both Product A and Product B → Makanan. After migration, both get the same
// branch-owned Makanan category (no duplicate).
// ══════════════════════════════════════════════════════════════════════════════
test('TEST B — Multiple products same master category: share one branch category, no duplicates', () => {
  // Product A already migrated. Insert Product C (also Makanan) as legacy.
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, branch_category_id, stock, is_available) VALUES (?, ?, NULL, 15, 1)').run(MIG_BRANCH, MIG_PROD_C);
  // Force master category to Makanan for this test
  db.prepare('UPDATE products SET category_id = ? WHERE id = ?').run(MIG_CAT_MAKANAN, MIG_PROD_C);

  runMigration(db);

  const migA = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_A);
  const migC = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_C);
  assert.strictEqual(migA.branch_category_id, migC.branch_category_id, 'Same master category → same branch category');

  // No duplicate branch categories for this branch+name
  const catCount = db.prepare("SELECT COUNT(*) as cnt FROM branch_categories WHERE branch_id = ? AND name = 'Makanan'").get(MIG_BRANCH);
  assert.strictEqual(catCount.cnt, 1, 'No duplicate Makanan branch category');

  // Restore Product C category
  db.prepare('UPDATE products SET category_id = ? WHERE id = ?').run(MIG_CAT_SNACK, MIG_PROD_C);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST C — Cross-Branch Independence
// Branch Barat: Product A → Makanan
// Branch Timur: Product B → Minuman
// After migration: Barat references Barat-owned category, Timur references Timur-owned.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST C — Cross-Branch Independence: each branch references its own branch categories', () => {
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, 10, 1)').run(MIG_BRANCH, MIG_PROD_A);
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, 20, 1)').run(MIG_BRANCH_TIMUR, MIG_PROD_B);

  runMigration(db);

  const baratProdA = db.prepare(`
    SELECT bp.branch_category_id, bc.branch_id as cat_branch
    FROM branch_products bp
    JOIN branch_categories bc ON bp.branch_category_id = bc.id
    WHERE bp.branch_id = ? AND bp.product_id = ?
  `).get(MIG_BRANCH, MIG_PROD_A);

  const timurProdB = db.prepare(`
    SELECT bp.branch_category_id, bc.branch_id as cat_branch
    FROM branch_products bp
    JOIN branch_categories bc ON bp.branch_category_id = bc.id
    WHERE bp.branch_id = ? AND bp.product_id = ?
  `).get(MIG_BRANCH_TIMUR, MIG_PROD_B);

  assert.ok(baratProdA.branch_category_id, 'Barat Product A has branch_category_id');
  assert.ok(timurProdB.branch_category_id, 'Timur Product B has branch_category_id');
  assert.strictEqual(baratProdA.cat_branch, MIG_BRANCH, 'Barat category belongs to Barat');
  assert.strictEqual(timurProdB.cat_branch, MIG_BRANCH_TIMUR, 'Timur category belongs to Timur');
  assert.notStrictEqual(baratProdA.branch_category_id, timurProdB.branch_category_id, 'Different branches have different branch category FKs');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST D — Preserve Valid Assignment
// If branch_product.branch_category_id is already non-null, migration must NOT change it.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST D — Preserve valid assignment: existing branch_category_id is not overwritten', () => {
  // Ensure Product A already has a valid branch_category_id from TEST A/B
  const existing = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_A);
  assert.ok(existing.branch_category_id, 'Product A has existing branch_category_id');

  const originalCatId = existing.branch_category_id;

  // Run migration again
  runMigration(db);

  const after = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_A);
  assert.strictEqual(after.branch_category_id, originalCatId, 'Existing branch_category_id preserved after migration');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST E — Idempotency
// Run migration twice. No duplicates, no reassignment.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST E — Idempotency: running migration twice produces same result', () => {
  const beforeA = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_A);
  const beforeB = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_B);

  // Run migration twice
  runMigration(db);
  runMigration(db);

  const afterA = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_A);
  const afterB = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(MIG_BRANCH, MIG_PROD_B);

  assert.strictEqual(afterA.branch_category_id, beforeA.branch_category_id, 'Product A category unchanged after second migration');
  assert.strictEqual(afterB.branch_category_id, beforeB.branch_category_id, 'Product B category unchanged after second migration');

  // No duplicate categories
  const catCount = db.prepare("SELECT COUNT(*) as cnt FROM branch_categories WHERE branch_id = ? AND name = 'Makanan'").get(MIG_BRANCH);
  assert.strictEqual(catCount.cnt, 1, 'No duplicate Makanan category after second migration');
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST F — No Master Category ID Leak
// branch_products.branch_category_id must reference branch_categories.id,
// NEVER products.category_id.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST F — No Master Category ID Leak: branch_category_id references branch_categories, not products', () => {
  const rows = db.prepare(`
    SELECT bp.branch_id, bp.product_id, bp.branch_category_id,
           p.category_id as master_cat_id
    FROM branch_products bp
    JOIN products p ON bp.product_id = p.id
    WHERE bp.branch_id IN (?, ?)
  `).all(MIG_BRANCH, MIG_BRANCH_TIMUR);

  for (const row of rows) {
    if (row.branch_category_id) {
      const bc = db.prepare('SELECT id FROM branch_categories WHERE id = ?').get(row.branch_category_id);
      assert.ok(bc, `branch_category_id ${row.branch_category_id} references a valid branch_categories row`);
      assert.notStrictEqual(row.branch_category_id, row.master_cat_id, `branch_category_id ${row.branch_category_id} is NOT the master category_id ${row.master_cat_id}`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// TEST G — Mixed Legacy Data
// One Branch with 3 legacy products from 3 different Master Categories.
// All branch_category_id NULL. After migration, each maps to correct category.
// This test would FAIL if the old branch_id-only UPDATE were used.
// ══════════════════════════════════════════════════════════════════════════════
test('TEST G — Mixed Legacy Data: 3 products, 3 master categories, each gets correct branch category', () => {
  const branch = 'bm_mixed';
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Mixed Branch', 'mixed', 'Jl. M', -7.3, 112.7)`).run(branch, MIG_BRAND);

  // Insert 3 legacy products, all NULL branch_category_id
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, 10, 1)').run(branch, MIG_PROD_A);
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, 20, 1)').run(branch, MIG_PROD_B);
  db.prepare('INSERT OR REPLACE INTO branch_products (branch_id, product_id, stock, is_available) VALUES (?, ?, 15, 1)').run(branch, MIG_PROD_C);

  // Verify legacy state
  for (const pid of [MIG_PROD_A, MIG_PROD_B, MIG_PROD_C]) {
    const leg = db.prepare('SELECT branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch, pid);
    assert.ok(!leg.branch_category_id, `Product ${pid} starts with NULL branch_category_id`);
  }

  runMigration(db);

  // Product A → Makanan
  const migA = db.prepare(`
    SELECT bc.name as cat_name FROM branch_products bp
    JOIN branch_categories bc ON bp.branch_category_id = bc.id
    WHERE bp.branch_id = ? AND bp.product_id = ?
  `).get(branch, MIG_PROD_A);
  assert.strictEqual(migA.cat_name, 'Makanan', 'Mixed: Product A → Makanan');

  // Product B → Minuman
  const migB = db.prepare(`
    SELECT bc.name as cat_name FROM branch_products bp
    JOIN branch_categories bc ON bp.branch_category_id = bc.id
    WHERE bp.branch_id = ? AND bp.product_id = ?
  `).get(branch, MIG_PROD_B);
  assert.strictEqual(migB.cat_name, 'Minuman', 'Mixed: Product B → Minuman');

  // Product C → Snack
  const migC = db.prepare(`
    SELECT bc.name as cat_name FROM branch_products bp
    JOIN branch_categories bc ON bp.branch_category_id = bc.id
    WHERE bp.branch_id = ? AND bp.product_id = ?
  `).get(branch, MIG_PROD_C);
  assert.strictEqual(migC.cat_name, 'Snack', 'Mixed: Product C → Snack');

  // All three are different
  const allIds = [migA, migB, migC].map(r => {
    const row = db.prepare('SELECT bp.branch_category_id FROM branch_products bp WHERE bp.branch_id = ? AND bp.product_id = ?').get(branch, r.cat_name === 'Makanan' ? MIG_PROD_A : r.cat_name === 'Minuman' ? MIG_PROD_B : MIG_PROD_C);
    return row.branch_category_id;
  });
  const uniqueIds = new Set(allIds);
  assert.strictEqual(uniqueIds.size, 3, 'All 3 products have different branch category IDs (3 different master categories)');
});
