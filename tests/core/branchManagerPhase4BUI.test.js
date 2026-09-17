'use strict';

/**
 * BM Phase 4B — Branch Manager Dashboard UI Hardening Test Suite
 *
 * Requirements Matrix (P4B-01 through P4B-10):
 * - P4B-01: BM catalog endpoint returns master products with adoption status for branch.
 * - P4B-02: DOM modal-bm-add-catalog structure, multi-selection, and badge logic in JS.
 * - P4B-03: Already adopted products are marked with badge and disabled from selection.
 * - P4B-04: Batch adoption executes against /admin/branches/:id/adopt and updates branch menu.
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
  const htmlPath = path.join(__dirname, '../../apps/merchant-dashboard/index.html');
  const jsPath = path.join(__dirname, '../../apps/merchant-dashboard/assets/js/dashboard.js');
  const cssPath = path.join(__dirname, '../../apps/merchant-dashboard/assets/css/dashboard.css');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  let testProduct1Id = 'prod_bm4b_catalog_1';
  let testProduct2Id = 'prod_bm4b_catalog_2';
  let testProduct3Id = 'prod_bm4b_catalog_3';

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

    // Ensure testProduct1 is already adopted in Branch A, but testProduct2 and testProduct3 are not
    db.prepare(`
      INSERT OR REPLACE INTO branch_products (branch_id, product_id, is_available, created_at, updated_at)
      VALUES (?, ?, 1, datetime('now'), datetime('now'))
    `).run(BRANCH_A_ID, testProduct1Id);

    // Clean up testProduct2 and testProduct3 from Branch A
    db.prepare(`DELETE FROM branch_products WHERE branch_id = ? AND product_id IN (?, ?)`).run(BRANCH_A_ID, testProduct2Id, testProduct3Id);
  });

  after(async () => {
    // Clean up seeded records
    try {
      db.prepare(`DELETE FROM branch_products WHERE branch_id = ? AND product_id IN (?, ?, ?)`).run(BRANCH_A_ID, testProduct1Id, testProduct2Id, testProduct3Id);
      db.prepare(`DELETE FROM products WHERE id IN (?, ?, ?)`).run(testProduct1Id, testProduct2Id, testProduct3Id);
    } catch {}

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('P4B-01: BM catalog endpoint returns master products with adoption status for branch', async () => {
    const bmToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID, userId: 'bm4b_user_1' });
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/catalog`, null, {
      Authorization: `Bearer ${bmToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.available_master_products), 'Should return available_master_products array');
    assert.ok(Array.isArray(res.body.adopted_products), 'Should return adopted_products array');

    const p1 = res.body.adopted_products.find(p => p.product_id === testProduct1Id);
    assert.ok(p1, 'testProduct1Id must be in adopted_products');

    const p2 = res.body.available_master_products.find(p => p.id === testProduct2Id);
    assert.ok(p2, 'testProduct2Id must be in available_master_products');
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
    assert.ok(js.includes('window.onBMSelectCatalogProduct = function'), 'onBMSelectCatalogProduct must be defined');
    assert.ok(js.includes('window.toggleBMSelectCatalogProduct = function'), 'toggleBMSelectCatalogProduct must be defined');
    assert.ok(js.includes('function updateBMAddCatalogFooter('), 'updateBMAddCatalogFooter must be defined');
    assert.ok(js.includes('window.submitBMAdoptCatalogBatch = async function') || js.includes('function submitBMAdoptCatalogBatch('), 'submitBMAdoptCatalogBatch must be defined');
    assert.ok(js.includes('Sudah Diadopsi'), 'Sudah Diadopsi badge text must be in JS');
  });

  it('P4B-04: Batch adoption endpoint adopts multiple products into branch menu', async () => {
    const bmToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID, userId: 'bm4b_user_2' });

    // Adopt testProduct2Id
    const res2 = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/adopt`, {
      product_id: testProduct2Id
    }, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.ok(res2.status === 200 || res2.status === 201, 'Adopt res2 status should be 200 or 201');
    assert.equal(res2.body.success, true);

    // Adopt testProduct3Id
    const res3 = await request('POST', `/api/v1/admin/branches/${BRANCH_A_ID}/adopt`, {
      product_id: testProduct3Id
    }, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.ok(res3.status === 200 || res3.status === 201, 'Adopt res3 status should be 200 or 201');
    assert.equal(res3.body.success, true);

    // Verify both now show in branch catalog (/api/v1/admin/branches/:id/catalog)
    const catalogRes = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/catalog`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(catalogRes.status, 200);
    const adopted = catalogRes.body.adopted_products || [];
    const item2 = adopted.find(m => m.product_id === testProduct2Id);
    const item3 = adopted.find(m => m.product_id === testProduct3Id);
    assert.ok(item2, 'Adopted product 2 must now exist in branch catalog adopted_products');
    assert.ok(item3, 'Adopted product 3 must now exist in branch catalog adopted_products');
  });

  it('P4B-05: Server-side authorization strictly blocks cross-branch and cross-brand catalog adoption (403)', async () => {
    // BM belongs to BRANCH_A_ID. Attempts to adopt into BRANCH_B_ID
    const bmToken = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID, brandId: BRAND_ID, userId: 'bm4b_user_3' });

    const crossBranchRes = await request('POST', `/api/v1/admin/branches/${BRANCH_B_ID}/adopt`, {
      product_id: testProduct1Id
    }, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(crossBranchRes.status, 403, 'Cross branch adoption must be 403');
    assert.equal(crossBranchRes.body.error, 'FORBIDDEN_BRANCH_SCOPE');

    // Attempts to adopt into OTHER_BRANCH_ID belonging to OTHER_BRAND_ID
    const crossBrandRes = await request('POST', `/api/v1/admin/branches/${OTHER_BRANCH_ID}/adopt`, {
      product_id: testProduct1Id
    }, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(crossBrandRes.status, 403, 'Cross brand adoption must be 403');
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
    assert.ok(js.includes("if (branchSelectorWrap) branchSelectorWrap.style.display = 'flex'"), 'Owner shows branchSelectorWrap via JS RBAC');
  });

  it('P4B-09: Box-sizing border-box and responsive modal card CSS rules prevent horizontal overflow', () => {
    assert.ok(css.includes('box-sizing: border-box;'), 'Universal box-sizing: border-box must be present');
    assert.ok(css.includes('.x-modal-card {'), 'CSS must define .x-modal-card');
    assert.ok(css.includes('max-height: min(90vh, calc(100dvh - 32px));'), 'Responsive max-height with dvh must be present');
    assert.ok(css.includes('overflow-x: hidden;'), 'overflow-x: hidden must be enforced');
  });

  it('P4B-10: Cache-busting query is applied in HTML', () => {
    assert.ok(html.includes('href="/dashboard/assets/css/dashboard.css?v=3.0.5"'), 'dashboard.css must use version query v=3.0.5');
    assert.ok(html.includes('src="/dashboard/assets/js/dashboard.js?v=3.0.5"'), 'dashboard.js must use version query v=3.0.5');
  });

  it('P4B-11: Sidebar drawer auto-closes on menu navigation click', () => {
    assert.ok(js.includes('function closeMobileSidebar()'), 'dashboard.js must define closeMobileSidebar');
    assert.ok(js.includes('closeMobileSidebar();'), 'dashboard.js must call closeMobileSidebar on navigation');
    assert.ok(js.includes('sidebar.addEventListener(\'click\'') || js.includes('sidebar.addEventListener("click"'), 'dashboard.js must register click listener on sidebar');
  });
});
