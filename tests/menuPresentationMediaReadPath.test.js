'use strict';

/**
 * MENU PRESENTATION MEDIA — jalur baca.
 *
 * Contract: docs/decisions/xentra-menu-presentation-media-v1.md
 *
 * Yang dikunci:
 *   MPR-01  /catalog/composed-menu mengembalikan foto MILIK MENU (canonical + delivery)
 *   MPR-02  Menu tanpa foto sendiri TIDAK mengambil foto komponen Product (termasuk Paket)
 *   MPR-03  komponen tetap membawa foto Product masing-masing
 *   MPR-04  admin branch menu tidak punya fallback foto komponen
 *   MPR-05  route media entity untuk Menu ter-mount (bukan 404)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const app = require('../server/app');
const db = require('../server/database/db');
const ComposedMenuService = require('../domains/catalog/services/ComposedMenuService');

require('./helpers/demoFixtures.js')();

const BRAND = 'brand_bangjo';

async function mockFetch(pathStr, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: pathStr,
      headers: { host: 'app.mybangjo.com', 'content-type': 'application/json', ...headers },
      body: null,
      query: {},
      params: {}
    };
    if (pathStr.includes('?')) {
      const [pathOnly, search] = pathStr.split('?');
      req.url = pathOnly;
      for (const [key, value] of new URLSearchParams(search).entries()) req.query[key] = value;
    }

    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      writeHead(code, headers) { this.statusCode = code; if (headers) Object.assign(this.headers, headers); },
      json(data) { resolve({ status: this.statusCode, json: async () => data }); },
      send(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      },
      end(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      }
    };

    app(req, res, (err) => { if (err) reject(err); });
  });
}

const MENU_MEDIA_ID = 'mpr_media_menu';
let menuWithMediaId = null;
let packageMenuId = null;

test.before(async () => {
  await db.ready;

  // Sub Category khusus test ini supaya identitas Menu Satuan tidak bentrok dengan fixture demo.
  const category = db.prepare("SELECT id FROM categories WHERE brand_id = ? ORDER BY id ASC LIMIT 1").get(BRAND);
  assert.ok(category, 'brand demo punya kategori');
  db.prepare(
    "INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'MPR Sub', 'mpr-sub', 90, 1)"
  ).run('mpr_sub', BRAND, category.id);

  const sub = db.prepare("SELECT id FROM sub_categories WHERE id = 'mpr_sub'").get();
  const rasa = db.prepare("SELECT id FROM menu_flavors WHERE brand_id = ? ORDER BY name ASC LIMIT 1").get(BRAND);
  const products = db.prepare("SELECT id FROM products WHERE brand_id = ? ORDER BY id ASC LIMIT 2").all(BRAND);
  assert.ok(sub, 'sub category test siap');
  assert.ok(products.length >= 2, 'brand demo punya minimal 2 Product');

  // Product komponen diberi foto Product supaya fallback (kalau ada) pasti terlihat.
  db.prepare("UPDATE products SET image_url = ? WHERE id = ?").run('/img/product-mpr.webp', products[0].id);
  db.prepare("INSERT OR IGNORE INTO media_assets (id, brand_id, storage_key, mime_type, asset_type, status) VALUES (?, ?, 'originals/mpr-menu.webp', 'image/webp', 'menu', 'ready')").run(MENU_MEDIA_ID, BRAND);

  const single = ComposedMenuService.createSingleMenu({
    brandId: BRAND,
    productId: products[0].id,
    subCategoryId: sub.id,
    rasaId: rasa ? rasa.id : undefined,
    sellingPrice: 21000,
    status: 'ACTIVE'
  });
  menuWithMediaId = single.id || single.menu_id;
  db.prepare("UPDATE menus SET media_id = ?, image_url = ?, image = ? WHERE id = ?")
    .run(MENU_MEDIA_ID, '/menu/mpr-satuan.webp', '/menu/mpr-satuan.webp', menuWithMediaId);

  const pkg = ComposedMenuService.createPackageMenu({
    brandId: BRAND,
    packageName: 'Paket MPR',
    sellingPrice: 39000,
    status: 'ACTIVE',
    components: [{ productId: products[0].id, quantity: 1 }, { productId: products[1].id, quantity: 1 }]
  });
  packageMenuId = pkg.id || pkg.menu_id;
});

test('MPR-01: /catalog/composed-menu mengembalikan foto milik Menu', async () => {
  const res = await mockFetch('/api/v1/catalog/composed-menu');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);

  const menu = data.menus.find((item) => String(item.id) === String(menuWithMediaId));
  assert.ok(menu, 'menu dengan media muncul di katalog');
  assert.equal(menu.media_id, MENU_MEDIA_ID, 'media_id Menu ikut terkirim');
  assert.equal(menu.image_url, '/menu/mpr-satuan.webp', 'foto Menu, bukan foto Product');
  assert.ok('preview_url' in menu && 'srcset_variants' in menu, 'field delivery tersedia untuk klien');
});

test('MPR-02: Menu tanpa foto sendiri tidak mengambil foto komponen Product', async () => {
  const res = await mockFetch('/api/v1/catalog/composed-menu');
  const data = await res.json();

  const pkg = data.menus.find((item) => String(item.id) === String(packageMenuId));
  assert.ok(pkg, 'paket muncul di katalog');
  assert.equal(pkg.menu_type, 'PACKAGE');
  assert.equal(pkg.media_id, null, 'paket tidak punya media sendiri');
  assert.equal(pkg.image_url, '', 'tidak mengambil /img/product-mpr.webp dari komponen');
  assert.equal(pkg.image, '');
});

test('MPR-03: komponen tetap membawa foto Product masing-masing', async () => {
  const res = await mockFetch('/api/v1/catalog/composed-menu');
  const data = await res.json();
  const pkg = data.menus.find((item) => String(item.id) === String(packageMenuId));

  assert.ok(pkg.components.length >= 2, 'paket punya komposisi');
  const first = pkg.components.find((component) => component.image_url);
  assert.ok(first, 'foto Product tetap tersedia di daftar komposisi');
  assert.equal(first.image_url, '/img/product-mpr.webp');
});

test('MPR-04: admin branch menu tidak memakai fallback foto komponen', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/routes/admin-branch-menu.js'), 'utf8');
  assert.ok(!/primary\s*&&\s*primary\.image_url/.test(source),
    'fallback components[0].image_url sudah dihapus');
  assert.ok(/image_url:\s*menu\.image_url \|\| ''/.test(source),
    'foto branch menu berasal dari Menu itu sendiri');
});

test('MPR-05: route media entity untuk Menu ter-mount (401, bukan 404)', async () => {
  const post = await mockFetch('/api/v1/admin/media/entity/menus/menu_x/image', { method: 'POST' });
  assert.notEqual(post.status, 404, 'POST entity media menu ter-mount');

  const del = await mockFetch('/api/v1/admin/media/entity/menus/menu_x/image', { method: 'DELETE' });
  assert.notEqual(del.status, 404, 'DELETE entity media menu ter-mount');
});
