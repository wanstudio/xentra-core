const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const db = require('../server/database/db');
const ComposedMenuService = require('../domains/catalog/services/ComposedMenuService');
const ComposedProductService = require('../domains/catalog/services/ComposedProductService');
const ComposedMenuResolver = require('../domains/catalog/services/ComposedMenuResolver');
const registerAdminComposedMenuRoutes = require('../server/routes/admin-composed-menu');

const BRAND = 'brd_save_test';
let server;
let baseUrl;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.brand_id = req.headers['x-test-brand'] || BRAND;
    req.user = { id: 'usr_test_owner', role: 'owner' };
    next();
  });
  const router = express.Router();
  registerAdminComposedMenuRoutes(router, {
    db,
    service: ComposedMenuService,
    productService: ComposedProductService,
    resolver: ComposedMenuResolver,
    requireAuth: () => (req, _res, next) => next()
  });
  app.use(router);
  return app;
}

async function call(method, urlPath, body) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-test-brand': BRAND
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = {};
  try { json = await res.json(); } catch (_) { json = {}; }
  return { status: res.status, body: json };
}

test.before(async () => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_save_test', 'Org Save Test', 'org-save-test')").run();
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, 'org_save_test', 'Brand Save Test', 'brand-save-test')").run(BRAND);
  ComposedProductService.listProducts({ brandId: BRAND, activeOnly: false });

  server = buildApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
});

test('ITEM MASTER: Save via /admin/items alias and canonical /admin/composed/products', async () => {
  // 1. Create via /admin/items
  const createRes = await call('POST', '/admin/items', {
    name: 'Teh Manis Solo',
    sku: 'TMS-01',
    cost_price: 1500,
    inventory_type: 'DIRECT',
    description: 'Teh manis khas Solo',
    options_config: {
      mode: 'CUSTOMER',
      variants: [{ name: 'Suhu (Panas/Dingin)', active: true, choices: ['Panas', 'Dingin'] }]
    },
    is_active: 1
  });

  assert.strictEqual(createRes.status, 201);
  assert.strictEqual(createRes.body.success, true);
  const item = createRes.body.product;
  assert.ok(item && item.id);
  assert.strictEqual(item.name, 'Teh Manis Solo');
  assert.strictEqual(Number(item.cost_price), 1500);
  assert.strictEqual(item.inventory_type, 'DIRECT');

  // 2. Read via /admin/items/:id
  const getRes = await call('GET', '/admin/items/' + item.id);
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.body.success, true);
  assert.strictEqual(getRes.body.product.id, item.id);

  // 3. Update via /admin/items/:id with camelCase or snake_case
  const updateRes = await call('PUT', '/admin/items/' + item.id, {
    name: 'Teh Manis Jumbo Solo',
    costPrice: 2000,
    inventoryType: 'DIRECT',
    description: 'Porsi Jumbo',
    optionsConfig: {
      mode: 'MERCHANT',
      variants: [{ name: 'Pedas', active: true, level: 3 }]
    }
  });

  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateRes.body.success, true);
  assert.strictEqual(updateRes.body.product.name, 'Teh Manis Jumbo Solo');
  assert.strictEqual(Number(updateRes.body.product.cost_price), 2000);

  // 4. Status update via /admin/items/:id/status
  const statusRes = await call('PATCH', '/admin/items/' + item.id + '/status', {
    is_active: 0
  });
  assert.strictEqual(statusRes.status, 200);
  assert.strictEqual(statusRes.body.success, true);
  assert.strictEqual(Number(statusRes.body.product.is_active), 0);
});

test('MENU MASTER: Auto-resolves title, normalizes prices and items via /admin/menus & aliases', async () => {
  // Ensure category exists
  let cat = db.prepare('SELECT id FROM categories WHERE brand_id = ? LIMIT 1').get(BRAND);
  if (!cat) {
    const catId = 'cat_save_' + Date.now();
    db.prepare('INSERT INTO categories (id, brand_id, name, slug) VALUES (?, ?, ?, ?)').run(catId, BRAND, 'Makanan', 'makanan');
    cat = { id: catId };
  }

  // Create two items to compose into Menu
  const it1 = await call('POST', '/admin/composed/products', { name: 'Ayam Geprek Crispy', is_active: 1 });
  const it2 = await call('POST', '/admin/composed/products', { name: 'Nasi Putih Pulen', is_active: 1 });
  assert.ok(it1.body.product && it2.body.product);

  // 1. Create Menu via /admin/menus with auto-title resolution and alternate price/cost keys
  const createMenuRes = await call('POST', '/admin/menus', {
    category_id: cat.id,
    title_name: 'Paket Geprek Kenyang', // omitting title_id!
    price: 25000,                      // sending price instead of selling_price
    cost: 12000,                       // sending cost instead of cost_price
    is_active: true,                   // sending is_active instead of status
    items: [
      { id: it1.body.product.id, quantity: 1 }, // using id instead of product_id
      { item_id: it2.body.product.id, quantity: 1 } // using item_id instead of product_id
    ]
  });

  assert.strictEqual(createMenuRes.status, 201);
  assert.strictEqual(createMenuRes.body.success, true);
  const menu = createMenuRes.body.menu;
  assert.ok(menu && menu.id);
  assert.strictEqual(Number(menu.selling_price), 25000);
  assert.strictEqual(Number(menu.cost_price), 12000);
  assert.strictEqual(menu.status, 'ACTIVE');
  assert.ok(menu.title_id, 'Title should be automatically created and assigned');

  // 2. Read via /admin/master-menus/:id
  const getMenuRes = await call('GET', '/admin/master-menus/' + menu.id);
  assert.strictEqual(getMenuRes.status, 200);
  assert.strictEqual(getMenuRes.body.success, true);
  assert.strictEqual(getMenuRes.body.menu.id, menu.id);

  // 3. Update via /admin/master-menus/:id with range pricing fallback (min_price) and status DRAFT
  const updateMenuRes = await call('PUT', '/admin/master-menus/' + menu.id, {
    category_id: cat.id,
    min_price: 28000,
    cost_price: 13000,
    is_active: false
  });

  assert.strictEqual(updateMenuRes.status, 200);
  assert.strictEqual(updateMenuRes.body.success, true);
  assert.strictEqual(Number(updateMenuRes.body.menu.selling_price), 28000);
  assert.strictEqual(Number(updateMenuRes.body.menu.cost_price), 13000);
  assert.strictEqual(updateMenuRes.body.menu.status, 'DRAFT');

  // 4. Update status via /admin/master-menus/:id/status
  const patchStatusRes = await call('PATCH', '/admin/master-menus/' + menu.id + '/status', {
    status: 'ACTIVE'
  });
  assert.strictEqual(patchStatusRes.status, 200);
  assert.strictEqual(patchStatusRes.body.success, true);
  assert.strictEqual(patchStatusRes.body.menu.status, 'ACTIVE');

  // 5. Delete via /admin/composed/menus/:id
  const deleteRes = await call('DELETE', '/admin/composed/menus/' + menu.id);
  assert.strictEqual(deleteRes.status, 200);
  assert.strictEqual(deleteRes.body.success, true);
  assert.strictEqual(deleteRes.body.status, 'DELETED');
});
