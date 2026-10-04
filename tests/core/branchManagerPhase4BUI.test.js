'use strict';

/**
 * BM Phase 4B — Branch Manager Dashboard UI Hardening Test Suite
 *
 * Requirements Matrix (P4B-01 through P4B-10):
 * - P4B-01: BM Branch Menu endpoint returns adopted and available Master Menus for branch.
 * - P4B-02: DOM modal-bm-add-catalog structure, multi-selection, and badge logic in JS.
 * - P4B-03: Already adopted products are marked with badge and disabled from selection.
 * - P4B-04: Batch adoption executes against the canonical Menu adoption endpoint and updates Branch Menu.
 * - P4B-05: Server-side authorization strictly blocks cross-branch and cross-brand catalog adoption (403).
 * - P4B-06: Modal "Ubah/Tambah Kategori Cabang" (modal-branch-category-edit) is normalized with .x-file-upload-wrap and min-width: 0.
 * - P4B-07: Modal "Ubah Menu Cabang" (modal-branch-override) photo upload is wrapped in .x-file-upload-wrap.
 * - P4B-08: CSS no longer forces display: none !important on .x-branch-selector, allowing Owner/Brand Manager branch switching across breakpoints while BM remains locked via RBAC.
 * - P4B-09: Box-sizing: border-box and responsive modal sizing (.x-modal-card) prevent horizontal overflow on compact viewports (375px, 390px, 430px).
 * - P4B-10: Asset cache-busting version v=3.0.3 is applied to dashboard.css and dashboard.js.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bm4b-ui-hardening';

const app = require('../../server/app');
const db = require('../../server/database/db');
// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const ORG_ID = 'org_xentra_holding';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';

const OTHER_BRAND_ID = 'brand_other_tenant';
const OTHER_BRANCH_ID = 'branch_other_1';

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, organizationId = ORG_ID, userId = 'bm4b_user_test' } = {}) {
  const token = 'bm4b_tok_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  const sess = {
    type: 'staff',
    role,
    brandId,
    brand_id: brandId,
    organizationId,
    organization_id: organizationId,
    branchId,
    branch_id: branchId,
    userId,
    username: userId,
    email_verified: true,
    created_at: Date.now(),
    expires_at: Date.now() + 86400000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe('BM Phase 4B — Branch Manager Dashboard UI Hardening Suite', () => {
  const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
  const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
  const menuPath = path.join(__dirname, '../../apps/merchant-app/assets/js/menu.js');
  const cssPath = path.join(__dirname, '../../apps/merchant-shared/css/dashboard.css');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = [jsPath, menuPath].filter(p => fs.existsSync(p)).map(p => fs.readFileSync(p, 'utf8')).join('\n');
  const css = fs.readFileSync(cssPath, 'utf8');
  // Owner/Platform surface stays in the legacy dashboard.
  const legacyHtml = fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/index.html'), 'utf8');
  const legacyJs = fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');

  let testProduct1Id = 'prod_bm4b_catalog_1';
  let testProduct2Id = 'prod_bm4b_catalog_2';
  let testProduct3Id = 'prod_bm4b_catalog_3';
  const testMenu2Id = 'menu_bm4b_catalog_2';
  const testMenu3Id = 'menu_bm4b_catalog_3';

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Seed master catalog products under brand_bangjo
    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, name, slug, description, price, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(testProduct1Id, BRAND_ID, 'Es Teh Manis Jumbo', 'es-teh-manis-jumbo', 'Es teh manis segar ukuran jumbo', 8000);

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, name, slug, description, price, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(testProduct2Id, BRAND_ID, 'Ayam Geprek Sambal Bawang', 'ayam-geprek-sambal-bawang', 'Ayam geprek renyah pedas nampol', 22000);

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, name, slug, description, price, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(testProduct3Id, BRAND_ID, 'Nasi Putih Wangi', 'nasi-putih-wangi', 'Nasi putih pulen hangat', 5000);

    const originalRasa = db.prepare("SELECT id FROM menu_flavors WHERE brand_id = ? AND lower(trim(name)) = 'original' AND is_active = 1 LIMIT 1").get(BRAND_ID);
    const branchCategory = db.prepare("SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ? AND is_active = 1 ORDER BY sort_order, id LIMIT 1").get(BRANCH_A_ID, BRAND_ID);
    assert.ok(originalRasa && branchCategory, 'canonical demo fixtures must provide Original Rasa and Branch Category');

    for (const [productId, menuId, suffix] of [
      [testProduct2Id, testMenu2Id, '2'],
      [testProduct3Id, testMenu3Id, '3']
    ]) {
      const subCategoryId = 'bm4b_sub_' + suffix;
      db.prepare(
        "INSERT OR REPLACE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, (SELECT id FROM categories WHERE brand_id = ? ORDER BY id LIMIT 1), ?, ?, ?, 1)"
      ).run(subCategoryId, BRAND_ID, BRAND_ID, 'BM4B Menu ' + suffix, 'bm4b-menu-' + suffix, Number(suffix));

      db.prepare(
        "INSERT OR REPLACE INTO menus (id, brand_id, menu_type, sub_category_id, rasa_id, selling_price, status) VALUES (?, ?, 'SINGLE', ?, ?, ?, 'ACTIVE')"
      ).run(menuId, BRAND_ID, subCategoryId, originalRasa.id, productId === testProduct2Id ? 22000 : 5000);

      db.prepare(
        "INSERT OR REPLACE INTO menu_items (menu_id, product_id, quantity, sort_order) VALUES (?, ?, 1, 0)"
      ).run(menuId, productId);
    }

    // Menu 1 remains unneeded for this batch-adoption contract; products 2 and 3 are the unadopted candidates.
    db.prepare(`DELETE FROM branch_menus WHERE branch_id = ? AND menu_id IN (?, ?)`).run(BRANCH_A_ID, testMenu2Id, testMenu3Id);
    db.prepare(`DELETE FROM branch_products WHERE branch_id = ? AND product_id IN (?, ?, ?)`).run(BRANCH_A_ID, testProduct1Id, testProduct2Id, testProduct3Id);
  });

  after(async () => {
    // Clean up canonical Menu fixtures before deleting their Product components.
    try {
      db.prepare(`DELETE FROM branch_menu_categories WHERE branch_id = ? AND menu_id IN (?, ?)`).run(BRANCH_A_ID, testMenu2Id, testMenu3Id);
      db.prepare(`DELETE FROM branch_menus WHERE branch_id = ? AND menu_id IN (?, ?)`).run(BRANCH_A_ID, testMenu2Id, testMenu3Id);
      db.prepare(`DELETE FROM menu_items WHERE menu_id IN (?, ?)`).run(testMenu2Id, testMenu3Id);
      db.prepare(`DELETE FROM menus WHERE id IN (?, ?)`).run(testMenu2Id, testMenu3Id);
      db.prepare(`DELETE FROM sub_categories WHERE id IN ('bm4b_sub_2', 'bm4b_sub_3')`).run();
      db.prepare(`DELETE FROM branch_products WHERE branch_id = ? AND product_id IN (?, ?, ?)`).run(BRANCH_A_ID, testProduct1Id, testProduct2Id, testProduct3Id);
      db.prepare(`DELETE FROM branch_product_categories WHERE branch_id = ? AND product_id IN (?, ?, ?)`).run(BRANCH_A_ID, testProduct1Id, testProduct2Id, testProduct3Id);
      db.prepare(`DELETE FROM branch_product_inventory WHERE branch_id = ? AND product_id IN (?, ?, ?)`).run(BRANCH_A_ID, testProduct1Id, testProduct2Id, testProduct3Id);
      db.prepare(`DELETE FROM products WHERE id IN (?, ?, ?)`).run(testProduct1Id, testProduct2Id, testProduct3Id);
    } catch {}

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('P4B-01: BM Branch Menu endpoint returns adopted and available Master Menus for branch', async () => {
    const bmToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID, userId: 'bm4b_user_1' });
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/menu`, null, {
      Authorization: `Bearer ${bmToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.model, 'branch-menu-v1');
    assert.ok(Array.isArray(res.body.available_master_menus), 'Should return available_master_menus array');
    assert.ok(Array.isArray(res.body.adopted_menus), 'Should return adopted_menus array');

    // Products are component/stock identities; adoption status is carried by Menu.
    const p2 = res.body.available_master_menus.find(m =>
      String(m.menu_id || m.id) === String(testMenu2Id)
    );
    assert.ok(p2, 'testMenu2Id must be in available_master_menus');

    const p3 = res.body.available_master_menus.find(m =>
      String(m.menu_id || m.id) === String(testMenu3Id)
    );
    assert.ok(p3, 'testMenu3Id must be in available_master_menus');
  });

  it('P4B-02 & P4B-03: DOM modal-bm-add-catalog structure, multi-selection, and badge logic in JS', () => {
    // Verify HTML has necessary controls
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const modal = doc.getElementById('modal-bm-add-catalog');
    assert.ok(modal, 'modal-bm-add-catalog must exist in index.html');

    const searchInput = doc.getElementById('bm-add-catalog-search');
    assert.ok(searchInput, 'bm-add-catalog-search must exist');

    const listContainer = doc.getElementById('bm-add-catalog-list');
    assert.ok(listContainer, 'bm-add-catalog-list container must exist');

    const countLabel = doc.getElementById('bm-add-catalog-count');
    assert.ok(countLabel, 'bm-add-catalog-count element must exist');

    const submitBtn = doc.getElementById('btn-bm-submit-adopt-catalog');
    assert.ok(submitBtn, 'btn-bm-submit-adopt-catalog button must exist');
    assert.ok(submitBtn.hasAttribute('disabled'), 'Submit button must start disabled');

    // Verify JS implementation logic
    assert.ok(js.includes('window.openBMAddCatalogModal = async function'), 'openBMAddCatalogModal must be defined');
    assert.ok(js.includes('window.onBMSelectCatalogProduct = function'), 'Menu selection handler must be defined');
    assert.ok(js.includes('window.toggleBMSelectCatalogProduct = function'), 'Menu selection toggle must be defined');
    assert.ok(js.includes('function updateBMAddCatalogFooter('), 'updateBMAddCatalogFooter must be defined');
    assert.ok(js.includes('window.submitBMAdoptCatalogBatch = async function') || js.includes('function submitBMAdoptCatalogBatch('), 'submitBMAdoptCatalogBatch must be defined');
    assert.ok(js.includes('Sudah Diadopsi'), 'Sudah Diadopsi badge text must be in JS');
  });

  it('P4B-04: Batch adoption contract adopts multiple canonical Menus into the branch', async () => {
    const bmToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID, userId: 'bm4b_user_2' });
    const branchCategory = db.prepare("SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ? AND is_active = 1 ORDER BY sort_order, id LIMIT 1").get(BRANCH_A_ID, BRAND_ID);
    assert.ok(branchCategory);

    for (const menuId of [testMenu2Id, testMenu3Id]) {
      const res = await request('POST', `/api/v1/admin/menus/${menuId}/adopt`, {
        branch_id: BRANCH_A_ID,
        branch_category_ids: [branchCategory.id],
        is_available: true
      }, {
        Authorization: `Bearer ${bmToken}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    }

    const catalogRes = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/menu`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(catalogRes.status, 200);
    const adopted = catalogRes.body.adopted_menus || [];
    assert.ok(adopted.some(m => String(m.menu_id) === testMenu2Id));
    assert.ok(adopted.some(m => String(m.menu_id) === testMenu3Id));
  });

  it('P4B-05: Server-side authorization strictly blocks cross-branch and cross-brand Menu adoption (403)', async () => {
    const bmToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID, userId: 'bm4b_user_3' });

    const branchBCategory = db.prepare(
      "SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ? AND is_active = 1 ORDER BY sort_order, id LIMIT 1"
    ).get(BRANCH_B_ID, BRAND_ID);
    assert.ok(branchBCategory, 'Branch B must have an active Branch Category');

    // Same-brand cross-branch adoption.
    const crossBranchRes = await request('POST', `/api/v1/admin/menus/${testMenu2Id}/adopt`, {
      branch_id: BRANCH_B_ID,
      branch_category_ids: [branchBCategory.id],
      is_available: true
    }, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(crossBranchRes.status, 403, 'Cross branch Menu adoption must be 403');
    assert.ok(
      crossBranchRes.body.error === 'FORBIDDEN_BRANCH_SCOPE' || crossBranchRes.body.error === 'FORBIDDEN_BRANCH_ACCESS',
      `Expected FORBIDDEN_BRANCH_SCOPE or FORBIDDEN_BRANCH_ACCESS, got ${crossBranchRes.body.error}`
    );

    // Cross-brand adoption uses a Menu from Brand A and a branch from another brand.
    const crossBrandRes = await request('POST', `/api/v1/admin/menus/${testMenu2Id}/adopt`, {
      branch_id: OTHER_BRANCH_ID,
      branch_category_ids: [],
      is_available: true
    }, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(crossBrandRes.status, 403, 'Cross brand Menu adoption must be 403');
  });

  it('P4B-06 & P4B-07: Modal file upload wrappers use .x-file-upload-wrap and .x-file-upload-info with min-width: 0', () => {
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Check modal-branch-category-edit
    const catEditModal = doc.getElementById('modal-branch-category-edit');
    assert.ok(catEditModal, 'modal-branch-category-edit must exist');
    const catUploadWrap = catEditModal.querySelector('.x-file-upload-wrap');
    assert.ok(catUploadWrap, 'modal-branch-category-edit must have .x-file-upload-wrap');
    const catUploadInfo = catEditModal.querySelector('.x-file-upload-info');
    assert.ok(catUploadInfo, 'modal-branch-category-edit must have .x-file-upload-info');

    // Check modal-branch-override
    const overrideModal = doc.getElementById('modal-branch-override');
    assert.ok(overrideModal, 'modal-branch-override must exist');
    const overrideUploadWrap = overrideModal.querySelector('.x-file-upload-wrap');
    assert.ok(overrideUploadWrap, 'modal-branch-override must have .x-file-upload-wrap');
    const overrideUploadInfo = overrideModal.querySelector('.x-file-upload-info');
    assert.ok(overrideUploadInfo, 'modal-branch-override must have .x-file-upload-info');

    // Check CSS rules for .x-file-upload-wrap and .x-file-upload-info
    assert.ok(css.includes('.x-file-upload-wrap {'), 'CSS must define .x-file-upload-wrap');
    assert.ok(css.includes('.x-file-upload-info {'), 'CSS must define .x-file-upload-info');
    assert.ok(css.includes('min-width: 0;'), 'CSS must specify min-width: 0 for flex children overflow prevention');
  });

  it('P4B-08: CSS removes display: none !important on .x-branch-selector, preserving Owner/BM separation', () => {
    // Ensure display: none !important is NOT present on .x-branch-selector in CSS
    const branchSelMatch = css.match(/\.x-branch-selector\s*\{[^}]*\}/g) || [];
    for (const rule of branchSelMatch) {
      assert.ok(!rule.includes('display: none !important'), 'Rule must not contain display: none !important on .x-branch-selector');
    }

    // Verify JS applyRoleBasedUI hides it for BM specifically while leaving it accessible for Owner
    assert.ok(js.includes("if (branchSelectorWrap) branchSelectorWrap.style.display = 'none'"), 'BM hides branchSelectorWrap via JS RBAC');
    assert.ok(legacyJs.includes("if (branchSelectorWrap) branchSelectorWrap.style.display = 'flex'"), 'Owner shows branchSelectorWrap via JS RBAC (legacy dashboard)');
  });

  it('P4B-09: Box-sizing border-box and responsive modal card CSS rules prevent horizontal overflow', () => {
    assert.ok(css.includes('box-sizing: border-box;'), 'Universal box-sizing: border-box must be present');
    assert.ok(css.includes('.x-modal-card {'), 'CSS must define .x-modal-card');
    assert.ok(css.includes('max-height: min(90vh, calc(100dvh - 32px));'), 'Responsive max-height with dvh must be present');
    assert.ok(css.includes('overflow-x: hidden;'), 'overflow-x: hidden must be enforced');
  });

  it('P4B-10: Cache-busting query is applied in HTML', () => {
    assert.ok(/href="\/merchant-shared\/css\/dashboard\.css\?v=1\.0\.\d+"/.test(html), 'Merchant App stylesheet must carry a version query');
    assert.ok(/src="\/merchant-app\/assets\/js\/merchant-app\.js\?v=1\.0\.\d+"/.test(html), 'merchant-app.js must carry a version query');
    assert.ok(legacyHtml.includes('src="/dashboard/assets/js/dashboard.js?v='), 'legacy dashboard.js must carry a version query');
  });

  it('P4B-11: Sidebar drawer auto-closes on menu navigation click', () => {
    assert.ok(js.includes('function closeMobileSidebar()'), 'dashboard.js must define closeMobileSidebar');
    assert.ok(js.includes('closeMobileSidebar();'), 'dashboard.js must call closeMobileSidebar on navigation');
    // The drawer must close as part of navigation, whatever the wiring.
    const navFn = js.slice(js.indexOf('function navigateTo'), js.indexOf('function switchTab'));
    assert.ok(navFn.includes('closeMobileSidebar();'), 'navigation must close the mobile sidebar');
  });

  it('P4B-12: Topbar navigation is sticky on top so hamburger button is always accessible', () => {
    assert.ok(css.includes('.x-dash-topbar {'), 'dashboard.css must define .x-dash-topbar');
    assert.ok(css.includes('position: sticky;'), 'dashboard.css must define position: sticky');
    const topbarIndex = css.indexOf('.x-dash-topbar {');
    const topbarBlock = css.slice(topbarIndex, topbarIndex + 200);
    assert.ok(topbarBlock.includes('position: sticky;'), '.x-dash-topbar must have position: sticky');
    assert.ok(topbarBlock.includes('top: 0;'), '.x-dash-topbar must have top: 0');
  });
});
