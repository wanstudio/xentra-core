'use strict';

/**
 * PRODUCT (MENU) IMAGE UPLOAD — regression coverage for the dashboard
 * Edit Menu / Tambah Menu "Foto Makanan" upload flow.
 *
 * Root cause it guards against: the old dashboard sent `image` (a pasted URL)
 * inside POST/PUT /admin/products, but the backend never persisted that field,
 * so menu photos could not be changed from the dashboard at all. The fix moves
 * photos to the established upload contract (base64 + mime_type, file persisted
 * to disk, only the URL stored) via POST /admin/products/:productId/image,
 * which writes BOTH products.image_url (customer PWA / public APIs) and
 * products.image (dashboard tables & Edit Menu modal).
 *
 * Verifies:
 * 1. Create menu + upload image → both columns persisted and served back
 * 2. Replace image → a new URL replaces the old in both columns
 * 3. PUT /admin/products/:id (rename/price only) → image untouched
 * 4. Error cases & status codes (404 / 400 mime / 400 missing / 400 too large)
 */

const test = require('node:test');
const assert = require('node:assert');
const app = require('../../server/app');
const db = require('../../server/database/db');

// 1x1 transparent PNG, base64-encoded — small, valid, deterministic fixture.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const MAX_BYTES = 3 * 1024 * 1024;

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

async function createCategory(auth, name) {
  const res = await mockFetch('/api/v1/admin/categories', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  assert.strictEqual(data.success, true, 'create category must succeed');
  return data.category.id;
}

async function createMenu(auth, name) {
  const categoryId = await createCategory(auth, 'Kategori Foto ' + Date.now());
  const res = await mockFetch('/api/v1/admin/products', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name, category_id: categoryId, price: 25000, description: 'Menu hasil upload' })
  });
  const data = await res.json();
  assert.strictEqual(data.success, true, 'create menu must succeed');
  return data.product.id;
}

function row(productId) {
  return db.prepare('SELECT name, image_url, image, price, updated_at FROM products WHERE id = ?').get(productId);
}

test('PRODUCT IMAGE 1 — create menu, then upload an image; both columns persist', async () => {
  const auth = await loginOwner();
  const productId = await createMenu(auth, 'Nasi Goreng Foto ' + Date.now());

  const imgRes = await mockFetch(`/api/v1/admin/products/${productId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })
  });
  assert.strictEqual(imgRes.status, 200);
  const imgData = await imgRes.json();
  assert.strictEqual(imgData.success, true);
  assert.ok(imgData.product.image_url.startsWith('/assets/uploads/products/'), 'upload URL must live under /assets/uploads/products/');
  assert.strictEqual(imgData.product.image, imgData.product.image_url);

  const saved = row(productId);
  assert.strictEqual(saved.image_url, imgData.product.image_url, 'image_url must be persisted (customer PWA column)');
  assert.strictEqual(saved.image, imgData.product.image_url, 'image must be persisted (dashboard column)');

  const listRes = await mockFetch('/api/v1/admin/products', { headers: auth });
  const listData = await listRes.json();
  const listed = listData.products.find((p) => String(p.id) === String(productId));
  assert.ok(listed, 'created menu must be listed');
  assert.strictEqual(listed.image_url, imgData.product.image_url, 'GET /admin/products must return the persisted URL');
  assert.strictEqual(listed.image, imgData.product.image_url);
});

test('PRODUCT IMAGE 2 — uploading again replaces the image in both columns', async () => {
  const auth = await loginOwner();
  const productId = await createMenu(auth, 'Ayam Geprek Foto ' + Date.now());

  const firstRes = await mockFetch(`/api/v1/admin/products/${productId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })
  });
  assert.strictEqual(firstRes.status, 200);
  const first = (await firstRes.json()).product;

  const secondRes = await mockFetch(`/api/v1/admin/products/${productId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/webp' })
  });
  assert.strictEqual(secondRes.status, 200);
  const second = (await secondRes.json()).product;
  assert.notStrictEqual(second.image_url, first.image_url, 'replacement must produce a different persisted URL');

  const saved = row(productId);
  assert.strictEqual(saved.image_url, second.image_url);
  assert.strictEqual(saved.image, second.image_url);
});

test('PRODUCT IMAGE 3 — PUT without an image leaves the photo untouched', async () => {
  const auth = await loginOwner();
  const productId = await createMenu(auth, 'Kopi Susu Foto ' + Date.now());

  const imgRes = await mockFetch(`/api/v1/admin/products/${productId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })
  });
  const imgData = await imgRes.json();

  const putRes = await mockFetch(`/api/v1/admin/products/${productId}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ name: 'Kopi Susu Rename ' + Date.now(), price: 18000 })
  });
  assert.strictEqual(putRes.status, 200);

  const saved = row(productId);
  assert.ok(saved.name.indexOf('Kopi Susu Rename') === 0, 'rename must apply');
  assert.strictEqual(saved.price, 18000, 'price must apply');
  assert.strictEqual(saved.image_url, imgData.product.image_url, 'image_url must survive a normal save with no new photo');
  assert.strictEqual(saved.image, imgData.product.image_url, 'image must survive a normal save with no new photo');
});

test('PRODUCT IMAGE 4 — validation and error handling', async () => {
  const auth = await loginOwner();
  const productId = await createMenu(auth, 'Mie Goreng Foto ' + Date.now());

  // A. Product does not belong to the brand / does not exist
  const resNotFound = await mockFetch('/api/v1/admin/products/prod_does_not_exist_999/image', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'image/png' })
  });
  assert.strictEqual(resNotFound.status, 404);
  const dataNotFound = await resNotFound.json();
  assert.strictEqual(dataNotFound.success, false);
  assert.strictEqual(dataNotFound.error, 'Menu produk tidak ditemukan.');

  // B. Unsupported MIME
  const resBadMime = await mockFetch(`/api/v1/admin/products/${productId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: TINY_PNG_BASE64, mime_type: 'application/pdf' })
  });
  assert.strictEqual(resBadMime.status, 400);
  const dataMime = await resBadMime.json();
  assert.strictEqual(dataMime.success, false);
  assert.strictEqual(dataMime.error, 'Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');

  // C. Missing image data
  const resNoData = await mockFetch(`/api/v1/admin/products/${productId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ mime_type: 'image/png' })
  });
  assert.strictEqual(resNoData.status, 400);
  const dataNoData = await resNoData.json();
  assert.strictEqual(dataNoData.success, false);
  assert.strictEqual(dataNoData.error, 'Gambar menu wajib diunggah.');

  // D. File larger than 3MB
  const oversized = Buffer.alloc(MAX_BYTES + 1).toString('base64');
  const resOversized = await mockFetch(`/api/v1/admin/products/${productId}/image`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ image_base64: oversized, mime_type: 'image/png' })
  });
  assert.strictEqual(resOversized.status, 400);
  const dataOversized = await resOversized.json();
  assert.strictEqual(dataOversized.success, false);
  assert.strictEqual(dataOversized.error, 'Ukuran gambar melebihi batas maksimal 3MB.');
});