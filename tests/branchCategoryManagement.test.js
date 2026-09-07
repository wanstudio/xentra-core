'use strict';

/**
 * BRANCH CATEGORY MANAGEMENT UPGRADE — regression coverage.
 *
 * Covers: create w/ image, rename, replace image, reorder (+ authoritative
 * validation, duplicate rejection, cross-branch rejection, atomicity), delete
 * (+ contiguous re-numbering), and that Home/CatalogService reads sort_order
 * ASC exactly as persisted by the dashboard (dashboard = source of truth).
 */

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/app');
const CatalogService = require('../domains/commerce/services/CatalogService');

const BARAT = 'branch_bangjo_barat';
const TIMUR = 'branch_bangjo_timur';
const BRAND = 'brand_bangjo';

// 1x1 transparent PNG, base64-encoded — small, valid, deterministic fixture.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function mockFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? JSON.parse(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: { host: 'app.mybangjo.com', 'content-type': 'application/json', ...headers },
      body,
      query: {},
      params: {}
    };

    if (path.includes('?')) {
      const parts = path.split('?');
      req.url = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [k, v] of params.entries()) req.query[k] = v;
    }

    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      writeHead(code, hdrs) { this.statusCode = code; if (hdrs) Object.assign(this.headers, hdrs); },
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

async function loginOwner() {
  const res = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const data = await res.json();
  assert.strictEqual(data.success, true, 'owner login must succeed for test setup');
  return { authorization: 'Bearer ' + data.token };
}

async function createCategory(auth, branchId, name) {
  const res = await mockFetch(`/api/v1/admin/branches/${branchId}/categories`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name })
  });
  return res.json();
}

async function getCategories(auth, branchId) {
  const res = await mockFetch(`/api/v1/admin/branches/${branchId}/catalog`, { headers: auth });
  const data = await res.json();
  return data.categories || [];
}

test('1. Create branch category, then attach an image via the upload endpoint', async () => {
  const auth = await loginOwner();
  const created = await createCategory(auth, BARAT, 'Test Kategori Baru');
  assert.strictEqual(created.success, true);
  const catId = created.category.id;

  const imgRes = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/${catId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })
  });
  const imgData = await imgRes.json();
  assert.strictEqual(imgData.success, true);
  assert.ok(imgData.category.image_url.startsWith('/assets/uploads/categories/'));

  const cats = await getCategories(auth, BARAT);
  const persisted = cats.find((c) => c.id === catId);
  assert.ok(persisted, 'category should be persisted');
  assert.strictEqual(persisted.image_url, imgData.category.image_url, 'image_url must be persisted, not just returned');
});

test('2. Rename a branch category', async () => {
  const auth = await loginOwner();
  const created = await createCategory(auth, BARAT, 'Nama Lama');
  const catId = created.category.id;

  const renameRes = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/${catId}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ name: 'Nama Baru' })
  });
  const renameData = await renameRes.json();
  assert.strictEqual(renameData.success, true);
  assert.strictEqual(renameData.category.name, 'Nama Baru');

  const cats = await getCategories(auth, BARAT);
  assert.ok(cats.find((c) => c.id === catId && c.name === 'Nama Baru'));

  // Empty/whitespace-only name is rejected
  const badRes = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/${catId}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ name: '    ' })
  });
  assert.strictEqual(badRes.status, 400);
});

test('3. Replace an existing category image with a new one', async () => {
  const auth = await loginOwner();
  const created = await createCategory(auth, BARAT, 'Kategori Gambar');
  const catId = created.category.id;

  const first = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/${catId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })
  });
  const firstData = await first.json();
  assert.strictEqual(firstData.success, true);
  const firstUrl = firstData.category.image_url;

  // Replace with a second upload — must produce a different persisted URL and
  // the catalog read must reflect the replacement, not the original.
  await new Promise((r) => setTimeout(r, 5)); // ensure a distinct Date.now()-based filename
  const second = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/${catId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })
  });
  const secondData = await second.json();
  assert.strictEqual(secondData.success, true);
  assert.notStrictEqual(secondData.category.image_url, firstUrl, 'replacing the image should yield a new persisted URL');

  const cats = await getCategories(auth, BARAT);
  const persisted = cats.find((c) => c.id === catId);
  assert.strictEqual(persisted.image_url, secondData.category.image_url);

  // Reject unsupported mime types (e.g. SVG — not in the allowed set)
  const rejected = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/${catId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/svg+xml' })
  });
  assert.strictEqual(rejected.status, 400);
});

test('4. Reorder branch categories — persisted sort_order matches the requested order', async () => {
  const auth = await loginOwner();
  const a = await createCategory(auth, TIMUR, 'Reorder A');
  const b = await createCategory(auth, TIMUR, 'Reorder B');
  const c = await createCategory(auth, TIMUR, 'Reorder C');

  const desired = [c.category.id, a.category.id, b.category.id];
  const reorderRes = await mockFetch(`/api/v1/admin/branches/${TIMUR}/categories/reorder`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ order: desired })
  });
  assert.strictEqual((await reorderRes.json()).success, true);

  const cats = await getCategories(auth, TIMUR);
  const gotOrder = cats
    .filter((cat) => desired.includes(cat.id))
    .sort((x, y) => x.sort_order - y.sort_order)
    .map((cat) => cat.id);
  assert.deepStrictEqual(gotOrder, desired);
});

test('5. Reorder is scoped to the correct branch only', async () => {
  const auth = await loginOwner();
  const cat = await createCategory(auth, BARAT, 'Scoped To Barat');

  // Attempting to reorder TIMUR using a category ID that belongs to BARAT must fail.
  const res = await mockFetch(`/api/v1/admin/branches/${TIMUR}/categories/reorder`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ order: [cat.category.id] })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.error, 'FORBIDDEN_BRANCH_SCOPE');
});

test('6. A category from another branch is rejected by reorder (mixed valid + invalid IDs)', async () => {
  const auth = await loginOwner();
  const baratCat = await createCategory(auth, BARAT, 'Barat Only');
  const timurCats = await getCategories(auth, TIMUR);
  assert.ok(timurCats.length > 0, 'fixture should have at least one Timur category');

  const res = await mockFetch(`/api/v1/admin/branches/${TIMUR}/categories/reorder`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ order: [timurCats[0].id, baratCat.category.id] })
  });
  assert.strictEqual(res.status, 400);

  // And the previously-valid Timur category's sort_order must be untouched (atomic rollback).
  const after = await getCategories(auth, TIMUR);
  const before = timurCats.find((c) => c.id === timurCats[0].id);
  const found = after.find((c) => c.id === timurCats[0].id);
  assert.strictEqual(found.sort_order, before.sort_order, 'a rejected reorder must not partially apply');
});

test('7. Duplicate category IDs in a reorder payload are rejected', async () => {
  const auth = await loginOwner();
  const cat = await createCategory(auth, BARAT, 'Dup Test');

  const res = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/reorder`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ order: [cat.category.id, cat.category.id] })
  });
  assert.strictEqual(res.status, 400);
});

test('8. Home/API returns branch categories ordered by sort_order ASC', async () => {
  const auth = await loginOwner();
  const a = await createCategory(auth, TIMUR, 'ASC A');
  const b = await createCategory(auth, TIMUR, 'ASC B');

  await mockFetch(`/api/v1/admin/branches/${TIMUR}/categories/reorder`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ order: [b.category.id, a.category.id] })
  });

  const menu = CatalogService.getMenu({ brand_id: BRAND, branch_id: TIMUR });
  const idxB = menu.categories.findIndex((c) => c.id === b.category.id);
  const idxA = menu.categories.findIndex((c) => c.id === a.category.id);
  assert.ok(idxB !== -1 && idxA !== -1);
  assert.ok(idxB < idxA, 'Home must render categories in persisted sort_order ASC, dashboard order wins');

  // sort_order is strictly non-decreasing across the whole list.
  for (let i = 1; i < menu.categories.length; i++) {
    assert.ok(menu.categories[i].sort_order >= menu.categories[i - 1].sort_order);
  }
});

test('9. Deleting a category re-packs remaining sort_order contiguously', async () => {
  const auth = await loginOwner();
  const a = await createCategory(auth, TIMUR, 'Pack A');
  const b = await createCategory(auth, TIMUR, 'Pack B');
  const c = await createCategory(auth, TIMUR, 'Pack C');

  await mockFetch(`/api/v1/admin/branches/${TIMUR}/categories/${b.category.id}`, {
    method: 'DELETE',
    headers: auth
  });

  const cats = (await getCategories(auth, TIMUR)).sort((x, y) => x.sort_order - y.sort_order);
  const orders = cats.map((cat) => cat.sort_order);
  for (let i = 0; i < orders.length; i++) {
    assert.strictEqual(orders[i], i + 1, 'sort_order must be contiguous 1..N after delete, no gaps');
  }
  assert.ok(!cats.find((cat) => cat.id === b.category.id));
  assert.ok(cats.find((cat) => cat.id === a.category.id));
  assert.ok(cats.find((cat) => cat.id === c.category.id));
});

test('10. Category without an image never produces a broken image reference', async () => {
  const auth = await loginOwner();
  const created = await createCategory(auth, BARAT, 'No Image Category');
  const cats = await getCategories(auth, BARAT);
  const persisted = cats.find((c) => c.id === created.category.id);
  assert.ok(persisted.image_url === null || persisted.image_url === undefined, 'no image means a null reference, never a broken path/blob');

  const menu = CatalogService.getMenu({ brand_id: BRAND, branch_id: BARAT });
  const menuCat = menu.categories.find((c) => c.id === created.category.id);
  assert.ok(menuCat.image_url === null, 'CatalogService must expose null (safe fallback), not undefined or a broken string');
});

test('11. Reorder is atomic: an invalid payload leaves the previous ordering fully intact', async () => {
  const auth = await loginOwner();
  const a = await createCategory(auth, BARAT, 'Atomic A');
  const b = await createCategory(auth, BARAT, 'Atomic B');

  const before = await getCategories(auth, BARAT);
  const beforeA = before.find((c) => c.id === a.category.id).sort_order;
  const beforeB = before.find((c) => c.id === b.category.id).sort_order;

  // Duplicate IDs -> rejected before any write happens.
  const res = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/reorder`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ order: [b.category.id, a.category.id, b.category.id] })
  });
  assert.strictEqual(res.status, 400);

  const after = await getCategories(auth, BARAT);
  assert.strictEqual(after.find((c) => c.id === a.category.id).sort_order, beforeA);
  assert.strictEqual(after.find((c) => c.id === b.category.id).sort_order, beforeB);
});

test('12. A rename + image change is immediately reflected in the Home-facing catalog', async () => {
  const auth = await loginOwner();
  const created = await createCategory(auth, BARAT, 'Chain Before');
  const catId = created.category.id;

  await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/${catId}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ name: 'Chain After' })
  });
  const imgRes = await mockFetch(`/api/v1/admin/branches/${BARAT}/categories/${catId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })
  });
  const imgData = await imgRes.json();

  // No caching layer sits between admin mutation and CatalogService's DB read —
  // the very next read must show both changes.
  const menu = CatalogService.getMenu({ brand_id: BRAND, branch_id: BARAT });
  const menuCat = menu.categories.find((c) => c.id === catId);
  assert.strictEqual(menuCat.name, 'Chain After');
  assert.strictEqual(menuCat.image_url, imgData.category.image_url);
});
