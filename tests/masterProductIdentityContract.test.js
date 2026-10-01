'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const ownerHtml = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
const ownerJs = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
const adminCatalog = fs.readFileSync(path.join(ROOT, 'server/routes/admin-catalog.js'), 'utf8');
const resolver = fs.readFileSync(path.join(ROOT, 'domains/catalog/services/MasterMenuResolver.js'), 'utf8');
const catalogRoute = fs.readFileSync(path.join(ROOT, 'server/routes/catalog.js'), 'utf8');

test('Product identity contract is wired across Owner, API, resolver, and Customer transport', () => {
  assert.ok(ownerHtml.includes('id="prod-name" class="x-input" required'));
  assert.ok(!ownerHtml.includes('id="prod-name-group" hidden'));
  assert.ok(ownerJs.includes("name: $('prod-name').value.trim()"));
  assert.ok(ownerJs.includes("titleEl.textContent = productName || 'Masukkan Nama Produk';"));

  const postStart = adminCatalog.indexOf("router.post('/admin/products'");
  const postEnd = adminCatalog.indexOf("router.put('/admin/products/:id'", postStart);
  const post = adminCatalog.slice(postStart, postEnd);
  assert.ok(post.includes("const normalizedName = typeof name === 'string' ? name.trim() : '';"));
  assert.ok(post.includes("if (!normalizedName || price === undefined || price === null || price === '')"));
  assert.ok(post.includes("if (!category_id)"));
  assert.ok(post.includes("const slug = normalizedName.toLowerCase()"));

  const putStart = adminCatalog.indexOf("router.put('/admin/products/:id'");
  const putEnd = adminCatalog.indexOf("router.get('/admin/products/:id/options'", putStart);
  const put = adminCatalog.slice(putStart, putEnd);
  assert.ok(put.includes("if (name !== undefined && (typeof name !== 'string' || !name.trim()))"));
  assert.ok(put.includes("name !== undefined ? name.trim() : null,"));

  assert.ok(resolver.includes("const customerTitle = hasDisplayNameOverride ? displayNameOverride.trim() : product.name;"));
  assert.ok(resolver.includes("name: product.master.category_name"));
  assert.ok(resolver.includes("category_slug: product.category_slug"));

  assert.ok(catalogRoute.includes("menu_title: p.title"));
  assert.ok(catalogRoute.includes("menu_subtitle: p.subtitle"));
  assert.ok(catalogRoute.includes("menu_detail: p.detail"));
  assert.ok(catalogRoute.includes("menu_indicator_level: p.indicator_level || null"));
});

test('Product Editor does not retain the stale duplicate Flavor change listener', () => {
  const handler = ownerJs.slice(ownerJs.lastIndexOf("var flavorSelect = $('prod-flavor');"));
  const listenerCount = (handler.match(/flavorSelect.addEventListener\('change'/g) || []).length;
  assert.equal(listenerCount, 1);
});

test('Customer title source has no legacy Category fallback in canonical resolver', () => {
  assert.ok(!resolver.includes('const customerTitle = hasDisplayNameOverride ? displayNameOverride.trim() : product.category_name;'));
  assert.ok(!resolver.includes('name: product.title,'));
});
