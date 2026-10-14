'use strict';

const test = require('node:test');
const assert = require('node:assert');
const app = require('../../server/app');
const db = require('../../server/database/db');
const ComposedMenuRepository = require('../../domains/catalog/repositories/ComposedMenuRepository');
const ComposedMenuResolver = require('../../domains/catalog/services/ComposedMenuResolver');

require('../helpers/demoFixtures.js')();
const BRAND = 'brand_bangjo';
const BRANCH_ID = 'branch_bangjo_barat';

async function request(pathStr, options = {}) {
  const method = options.method || 'GET';
  const rawHeaders = options.headers || {};
  const headers = { host: 'm.mybangjo.com', 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(rawHeaders)) {
    headers[k.toLowerCase()] = v;
  }
  const body = options.body !== undefined ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : null;

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: pathStr,
      headers,
      body,
      query: options.query || {},
      params: {}
    };

    if (pathStr.includes('?')) {
      const parts = pathStr.split('?');
      req.url = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [k, v] of params.entries()) { req.query[k] = v; }
    }

    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      getHeader(k) { return this.headers[k.toLowerCase()]; },
      writeHead(code, headers) { this.statusCode = code; if (headers) Object.assign(this.headers, headers); },
      json(data) {
        resolve({ status: this.statusCode, json: async () => data });
      },
      send(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, json: async () => parsed });
      },
      end(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, json: async () => parsed });
      }
    };

    app(req, res, (err) => { if (err) reject(err); });
  });
}

test('BRANCH CATEGORY IMAGE DELIVERY — branch category image persists and is delivered to customer catalog', async () => {
  const testCatId = 'bc_test_img_' + Date.now();
  const testImgUrl = '/assets/uploads/categories/test-category-image-123.jpg';

  // 1. Create a branch category with an image
  db.prepare(`
    INSERT INTO branch_categories (id, brand_id, branch_id, name, slug, image_url, sort_order, is_active)
    VALUES (?, ?, ?, 'Kategori Foto Uji', 'kategori-foto-uji', ?, 1, 1)
  `).run(testCatId, BRAND, BRANCH_ID, testImgUrl);

  // 2. Attach a menu to this branch category
  // Find an existing active menu in the brand
  const existingMenu = db.prepare('SELECT id FROM menus WHERE brand_id = ? LIMIT 1').get(BRAND);
  assert.ok(existingMenu, 'must have at least one menu');

  // Ensure branch adoption
  db.prepare('INSERT OR IGNORE INTO branch_menus (branch_id, menu_id) VALUES (?, ?)').run(BRANCH_ID, existingMenu.id);
  db.prepare('INSERT OR REPLACE INTO branch_menu_categories (branch_id, menu_id, branch_category_id) VALUES (?, ?, ?)')
    .run(BRANCH_ID, existingMenu.id, testCatId);

  // 3. Verify ComposedMenuRepository includes image_url
  const repo = new ComposedMenuRepository();
  const memberships = repo.listBranchMenuCategoryMemberships({ brandId: BRAND, branchId: BRANCH_ID, menuId: existingMenu.id });
  const foundMembership = memberships.find(m => m.branch_category_id === testCatId);
  assert.ok(foundMembership, 'membership must exist');
  assert.strictEqual(foundMembership.branch_category_image_url, testImgUrl, 'repository must return branch_category_image_url');

  // 4. Verify ComposedMenuResolver includes image_url on branch_categories
  const resolved = ComposedMenuResolver.resolveBranchMenu({ brandId: BRAND, branchId: BRANCH_ID });
  const targetMenu = resolved.find(m => m.id === existingMenu.id);
  assert.ok(targetMenu, 'target menu must be resolved');
  const targetBranchCat = (targetMenu.branch_categories || []).find(bc => bc.id === testCatId);
  assert.ok(targetBranchCat, 'branch category must exist on resolved menu');
  assert.strictEqual(targetBranchCat.image_url, testImgUrl, 'resolved branch category must have image_url');
  assert.strictEqual(targetBranchCat.image, testImgUrl, 'resolved branch category must have image');

  // 5. Verify customer API endpoint /api/v1/catalog/composed-menu?branch_id=... returns categories with image_url
  const res = await request(`/api/v1/catalog/composed-menu?branch_id=${BRANCH_ID}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.categories), 'categories must be an array');

  const catInCustomerApp = data.categories.find(c => c.id === testCatId);
  assert.ok(catInCustomerApp, 'category must appear in customer app categories list');
  assert.strictEqual(catInCustomerApp.image_url, testImgUrl, 'category in customer app must have image_url');
  assert.strictEqual(catInCustomerApp.image, testImgUrl, 'category in customer app must have image');
});

test('BRANCH CATEGORY MEDIA ASSET — media_id delivers responsive preview_url and srcset_variants to customer catalog', async () => {
  const testCatId = 'bc_test_media_' + Date.now();
  const testMediaId = 'media_asset_cat_' + Date.now();
  const testPreviewUrl = '/media/categories/preview-640.webp';

  // Insert test media asset and variant
  db.prepare(`
    INSERT INTO media_assets (id, brand_id, status, mime_type, storage_key, size_bytes, width, height, created_at)
    VALUES (?, ?, 'ready', 'image/jpeg', 'uploads/orig.jpg', 12345, 640, 640, datetime('now'))
  `).run(testMediaId, BRAND);

  db.prepare(`
    INSERT INTO media_variants (id, media_id, variant_name, width, height, storage_key, mime_type, size_bytes, format)
    VALUES (?, ?, 'w640', 640, 640, 'uploads/w640.webp', 'image/webp', 5000, 'webp')
  `).run('var_' + Date.now(), testMediaId);

  // Insert branch category with media_id
  db.prepare(`
    INSERT INTO branch_categories (id, brand_id, branch_id, name, slug, media_id, sort_order, is_active)
    VALUES (?, ?, ?, 'Kategori Media Asset', 'kategori-media-asset', ?, 2, 1)
  `).run(testCatId, BRAND, BRANCH_ID, testMediaId);

  const existingMenu = db.prepare('SELECT id FROM menus WHERE brand_id = ? LIMIT 1').get(BRAND);
  db.prepare('INSERT OR REPLACE INTO branch_menu_categories (branch_id, menu_id, branch_category_id) VALUES (?, ?, ?)')
    .run(BRANCH_ID, existingMenu.id, testCatId);

  const res = await request(`/api/v1/catalog/composed-menu?branch_id=${BRANCH_ID}`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  const cat = data.categories.find(c => c.id === testCatId);
  assert.ok(cat, 'category with media_id must exist');
  assert.strictEqual(cat.media_id, testMediaId, 'media_id must match');
  assert.ok(Array.isArray(cat.srcset_variants) && cat.srcset_variants.length > 0, 'srcset_variants must be populated');
  assert.ok(cat.image_url, 'image_url must be populated from resolved variant');
});
