'use strict';

/**
 * Test Suite: Owner Dashboard Image Upload Security & Workflows
 *
 * Verifies locked M0–M7 media policy:
 *
 * LOCKED CONTRACT:
 * - Source images may be any aspect ratio; aspect ratio enforcement belongs to the crop/processing stage.
 * - Intake (validateImageUpload with enforceAspectRatio=false) must NOT reject non-square sources.
 * - File size, format, pixel count, and binary signature are enforced at intake.
 * - Canonical crop/processing produces the canonical aspect ratio output.
 *
 * Size limits (authoritative, M0-locked):
 *   Logo: 10 MB  |  Product: 20 MB  |  Category: 15 MB  |  Banner: 20 MB
 * Safety ceiling: 20 MP
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('./helpers/demoFixtures.js')();
const app = require('../server/app');
const { createPngBuffer, createJpegBuffer, createWebpBuffer } = require('./helpers/testImageHelper');
const { validateImageUpload, IMAGE_RULES } = require('../core/domain/ImageValidator');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body != null ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: options.headers && options.headers.Host ? options.headers.Host : 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (payload != null) {
      req.write(payload);
    }
    req.end();
  });
}

test('CLIENT OWNER DASHBOARD: SECURE IMAGE UPLOAD & VALIDATION SUITE', async (t) => {
  let server;
  let ownerToken;
  let cashierToken;
  const BRAND_ID = 'brand_bangjo';
  let initialLogoUrl;

  await t.test('0. Setup: server & auth sessions', async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Owner user must exist');
    const ownerSession = global.TokenSessionStore.createSession(ownerUser, BRAND_ID);
    ownerToken = ownerSession.token;

    const cashierUser = db.prepare("SELECT * FROM users WHERE role = 'cashier' AND brand_id = ?").get(BRAND_ID);
    if (cashierUser) {
      const cashSession = global.TokenSessionStore.createSession(cashierUser, BRAND_ID);
      cashierToken = cashSession.token;
    }

    const currentBrand = db.prepare('SELECT logo_url FROM brands WHERE id = ?').get(BRAND_ID);
    initialLogoUrl = currentBrand ? currentBrand.logo_url : null;
  });

  await t.test('1. Brand Logo: Valid 1:1 square PNG upload', async () => {
    const squarePng = createPngBuffer(200, 200);
    const base64 = squarePng.toString('base64');

    const res = await makeRequest(server, {
      path: '/api/v1/admin/brand/logo',
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      image_base64: base64,
      mime_type: 'image/png'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.logo_url.startsWith('/assets/uploads/logos/logo-'));
    assert.ok(res.body.logo_url.endsWith('.png'));

    // Verify DB update
    const brandRow = db.prepare('SELECT logo_url FROM brands WHERE id = ?').get(BRAND_ID);
    assert.strictEqual(brandRow.logo_url, res.body.logo_url);

    // Verify persisted on disk
    const diskPath = path.join(__dirname, '../apps/customer-pwa', res.body.logo_url);
    assert.ok(fs.existsSync(diskPath), 'Uploaded file must exist on disk');
  });

  // CORRECTED: Per locked media contract, non-square SOURCE images must be ACCEPTED at intake.
  // Aspect ratio enforcement belongs to the crop/processing stage (M3), NOT intake validation.
  // enforceAspectRatio defaults to false — source can be any ratio; crop makes it 1:1.
  await t.test('2. Brand Logo: Non-square source (350x180) ACCEPTED at intake — crop fixes ratio', async () => {
    const rectJpeg = createJpegBuffer(350, 180);
    const base64 = rectJpeg.toString('base64');

    const prevBrandRow = db.prepare('SELECT logo_url FROM brands WHERE id = ?').get(BRAND_ID);

    const res = await makeRequest(server, {
      path: '/api/v1/admin/brand/logo',
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      image_base64: base64,
      mime_type: 'image/jpeg'
    });

    // Non-square source MUST be accepted — enforceAspectRatio is false at intake
    assert.strictEqual(res.status, 200, `Non-square source must be accepted. Got: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.logo_url, 'logo_url must be returned');
  });

  await t.test('3. Brand Logo: Reject SVG / script upload', async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const base64 = Buffer.from(svgContent).toString('base64');

    const res = await makeRequest(server, {
      path: '/api/v1/admin/brand/logo',
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      image_base64: base64,
      mime_type: 'image/svg+xml'
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  await t.test('4. Brand Logo: Reject oversized image (>10MB)', async () => {
    // Construct dummy buffer larger than 10MB (M0 locked policy)
    const bigBuf = Buffer.alloc(10.5 * 1024 * 1024, 0x89);
    const base64 = bigBuf.toString('base64');

    const res = await makeRequest(server, {
      path: '/api/v1/admin/brand/logo',
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      image_base64: base64,
      mime_type: 'image/png'
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'FILE_TOO_LARGE');
  });

  await t.test('5. Brand Logo: DELETE endpoint resets logo', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/brand/logo',
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.logo_url, null);

    const brandRow = db.prepare('SELECT logo_url FROM brands WHERE id = ?').get(BRAND_ID);
    assert.strictEqual(brandRow.logo_url, null);
  });

  await t.test('6. Banner: Valid ~1.94:1 ratio JPEG upload via POST /admin/banners', async () => {
    // Ensure room for test banner
    const existingBanners = db.prepare('SELECT banners FROM brands WHERE id = ?').get(BRAND_ID);
    let parsed = [];
    try { parsed = JSON.parse(existingBanners.banners || '[]'); } catch (_) {}
    if (parsed.length >= 4) {
      db.prepare('UPDATE brands SET banners = ? WHERE id = ?').run(JSON.stringify(parsed.slice(0, 2)), BRAND_ID);
    }

    const bannerJpeg = createJpegBuffer(350, 180);
    const base64 = bannerJpeg.toString('base64');


    const res = await makeRequest(server, {
      path: '/api/v1/admin/banners',
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      image_base64: base64,
      mime_type: 'image/jpeg',
      title: 'Diskon Spesial Liburan'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.banners));

    const added = res.body.banners.find(b => b.title === 'Diskon Spesial Liburan');
    assert.ok(added, 'Added banner must exist in returned list');
    assert.ok(added.image_url.startsWith('/assets/uploads/banners/banner-'));
    assert.ok(added.image_url.endsWith('.jpg'));

    // Check on disk
    const diskPath = path.join(__dirname, '../apps/customer-pwa', added.image_url);
    assert.ok(fs.existsSync(diskPath), 'Uploaded banner file must exist on disk');
  });

  // CORRECTED: Per locked media contract, non-square SOURCE images must be ACCEPTED at intake for banners.
  // A square (1:1) source for a banner is also a valid source — the crop editor handles the 1.94:1 output.
  // enforceAspectRatio defaults to false — do NOT reject valid sources for wrong source ratio.
  await t.test('7. Banner: Square (1:1) source image ACCEPTED at intake — crop adjusts to ~1.94:1', async () => {
    const existingBanners = db.prepare('SELECT banners FROM brands WHERE id = ?').get(BRAND_ID);
    let parsed = [];
    try { parsed = JSON.parse(existingBanners.banners || '[]'); } catch (_) {}
    if (parsed.length >= 4) {
      db.prepare('UPDATE brands SET banners = ? WHERE id = ?').run(JSON.stringify(parsed.slice(0, 2)), BRAND_ID);
    }

    const squareJpeg = createJpegBuffer(200, 200);
    const base64 = squareJpeg.toString('base64');

    const res = await makeRequest(server, {
      path: '/api/v1/admin/banners',
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      image_base64: base64,
      mime_type: 'image/jpeg',
      title: 'Square Source Banner Test'
    });

    // Square source must be accepted — enforceAspectRatio is false at intake
    assert.strictEqual(res.status, 200, `Square source must be accepted for banner intake. Got: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);
  });

  await t.test('8. Master Product: Valid 1:1 JPEG upload via /admin/products/:id/image', async () => {
    // Find or create a test product
    let testProd = db.prepare('SELECT id, image_url FROM products WHERE brand_id = ? LIMIT 1').get(BRAND_ID);
    assert.ok(testProd, 'A product must exist for testing');

    const squareJpeg = createJpegBuffer(300, 300);
    const base64 = squareJpeg.toString('base64');

    const res = await makeRequest(server, {
      path: `/api/v1/admin/products/${testProd.id}/image`,
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      image_base64: base64,
      mime_type: 'image/jpeg'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.product.image_url.startsWith('/assets/uploads/products/'));

    // Check disk
    const diskPath = path.join(__dirname, '../apps/customer-pwa', res.body.product.image_url);
    assert.ok(fs.existsSync(diskPath), 'Product image file must exist on disk');
  });

  await t.test('9. RBAC: Cashier cannot upload brand logo or banners', async () => {
    if (cashierToken) {
      const squarePng = createPngBuffer(100, 100);
      const resLogo = await makeRequest(server, {
        path: '/api/v1/admin/brand/logo',
        method: 'POST',
        headers: { Authorization: `Bearer ${cashierToken}` }
      }, {
        image_base64: squarePng.toString('base64'),
        mime_type: 'image/png'
      });
      assert.strictEqual(resLogo.status, 403, 'Cashier must be forbidden from logo upload');

      const resBanner = await makeRequest(server, {
        path: '/api/v1/admin/banners',
        method: 'POST',
        headers: { Authorization: `Bearer ${cashierToken}` }
      }, {
        image_base64: squarePng.toString('base64'),
        mime_type: 'image/png'
      });
      assert.strictEqual(resBanner.status, 403, 'Cashier must be forbidden from banner upload');
    }
  });

  // ============================================================
  // REGRESSION TESTS — File Size Policy (M0-locked authoritative limits)
  // ============================================================

  await t.test('R1. Product: Non-square source (1200x900) accepted by validateImageUpload', () => {
    const buf = createJpegBuffer(1200, 900);
    const base64 = buf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'product',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, true, `1200x900 product source must be accepted: ${result.error}`);
    assert.strictEqual(result.info.width, 1200);
    assert.strictEqual(result.info.height, 900);
  });

  await t.test('R2. Category: Non-square source (1600x900) accepted by validateImageUpload', () => {
    const buf = createJpegBuffer(1600, 900);
    const base64 = buf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'category',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, true, `1600x900 category source must be accepted: ${result.error}`);
  });

  await t.test('R3. Logo: Non-square source (800x600) accepted by validateImageUpload', () => {
    const buf = createJpegBuffer(800, 600);
    const base64 = buf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'logo',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, true, `800x600 logo source must be accepted: ${result.error}`);
  });

  await t.test('R4. Banner: Non-square source (1200x1200 square) accepted by validateImageUpload', () => {
    const buf = createJpegBuffer(1200, 1200);
    const base64 = buf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'banner',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, true, `1200x1200 banner source must be accepted: ${result.error}`);
  });

  await t.test('R5. Product: File exceeding 20 MB rejected with FILE_TOO_LARGE', () => {
    // Build a buffer slightly above 20MB by padding a minimal JPEG
    const base = createJpegBuffer(100, 100);
    const filler = Buffer.alloc(20 * 1024 * 1024 + 1024);
    const bigBuf = Buffer.concat([base, filler]);
    const base64 = bigBuf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'product',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.code, 'FILE_TOO_LARGE');
  });

  await t.test('R6. Category: File exceeding 15 MB rejected with FILE_TOO_LARGE', () => {
    const base = createJpegBuffer(100, 100);
    const filler = Buffer.alloc(15 * 1024 * 1024 + 1024);
    const bigBuf = Buffer.concat([base, filler]);
    const base64 = bigBuf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'category',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.code, 'FILE_TOO_LARGE');
  });

  await t.test('R7. Banner: File exceeding 20 MB rejected with FILE_TOO_LARGE', () => {
    const base = createJpegBuffer(100, 100);
    const filler = Buffer.alloc(20 * 1024 * 1024 + 1024);
    const bigBuf = Buffer.concat([base, filler]);
    const base64 = bigBuf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'banner',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.code, 'FILE_TOO_LARGE');
  });

  await t.test('R8. Logo: File exceeding 10 MB rejected with FILE_TOO_LARGE', () => {
    const base = createJpegBuffer(100, 100);
    const filler = Buffer.alloc(10 * 1024 * 1024 + 1024);
    const bigBuf = Buffer.concat([base, filler]);
    const base64 = bigBuf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'logo',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.code, 'FILE_TOO_LARGE');
  });

  await t.test('R9. 20 MP safety ceiling: oversized pixel count rejected with PIXEL_COUNT_TOO_LARGE', () => {
    // createJpegBuffer uses only header bytes — we can set any width/height to test dimension logic
    // 4500x4500 = 20.25MP > 20MP ceiling
    const buf = createJpegBuffer(4500, 4500);
    const base64 = buf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'product',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.code, 'PIXEL_COUNT_TOO_LARGE', `Expected PIXEL_COUNT_TOO_LARGE, got ${result.code}: ${result.error}`);
  });

  await t.test('R10. 20 MP boundary: 4000x4000 (16MP) within 20MP ceiling accepted', () => {
    // 4000x4000 = 16MP — within maxWidth/maxHeight (4096) and under 20MP ceiling
    const buf = createJpegBuffer(4000, 4000);
    const base64 = buf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'product',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, true, `High-res image within 20MP ceiling should be accepted: ${result.error}`);
  });

  await t.test('R11. HEIC/HEIF file rejected with UNSUPPORTED_FORMAT', () => {
    // Minimal ISOBMFF ftyp box with heic brand
    const buf = Buffer.alloc(20);
    buf.writeUInt32BE(20, 0);                // box size
    buf.write('ftyp', 4, 'ascii');           // box type
    buf.write('heic', 8, 'ascii');           // major brand
    buf.writeUInt32BE(0, 12);                // minor version
    buf.write('heic', 16, 'ascii');          // compatible brands
    const base64 = buf.toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/heic',
      assetType: 'product',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.code, 'UNSUPPORTED_FORMAT');
    assert.ok(result.error.toLowerCase().includes('heic') || result.error.toLowerCase().includes('heif'),
      'Error must mention HEIC/HEIF');
  });

  await t.test('R12. Spoofed file (PHP script with .jpg extension) rejected', () => {
    const phpContent = '<?php system($_GET["cmd"]); ?>';
    const base64 = Buffer.from(phpContent).toString('base64');
    const result = validateImageUpload({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      assetType: 'product',
      enforceAspectRatio: false
    });
    assert.strictEqual(result.valid, false, 'PHP script must be rejected regardless of declared MIME');
    assert.ok(['UNSUPPORTED_FORMAT', 'INVALID_IMAGE_FORMAT'].includes(result.code),
      `Expected UNSUPPORTED_FORMAT or INVALID_IMAGE_FORMAT, got ${result.code}`);
  });

  await t.test('R13. Product: Valid non-square JPEG (1200x900) upload succeeds via API', async () => {
    let testProd = db.prepare('SELECT id FROM products WHERE brand_id = ? LIMIT 1').get(BRAND_ID);
    assert.ok(testProd, 'A product must exist for testing');

    const nonSquareJpeg = createJpegBuffer(1200, 900);
    const base64 = nonSquareJpeg.toString('base64');

    const res = await makeRequest(server, {
      path: `/api/v1/admin/products/${testProd.id}/image`,
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, {
      image_base64: base64,
      mime_type: 'image/jpeg'
    });

    assert.strictEqual(res.status, 200, `Non-square product upload must succeed. Got: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);
  });

  await t.test('R14. ImageRules: Authoritative policy constants match M0 locked values', () => {
    assert.strictEqual(IMAGE_RULES.logo.maxBytes, 10 * 1024 * 1024, 'Logo limit must be 10MB');
    assert.strictEqual(IMAGE_RULES.product.maxBytes, 20 * 1024 * 1024, 'Product limit must be 20MB');
    assert.strictEqual(IMAGE_RULES.category.maxBytes, 15 * 1024 * 1024, 'Category limit must be 15MB');
    assert.strictEqual(IMAGE_RULES.banner.maxBytes, 20 * 1024 * 1024, 'Banner limit must be 20MB');
    assert.strictEqual(IMAGE_RULES.avatar.maxBytes, 10 * 1024 * 1024, 'Avatar limit must be 10MB');
    assert.strictEqual(IMAGE_RULES.general.maxBytes, 20 * 1024 * 1024, 'General limit must be 20MB');
    // All types must have 20MP safety ceiling
    for (const [type, rule] of Object.entries(IMAGE_RULES)) {
      assert.strictEqual(rule.maxMegaPixels, 20, `${type} must have 20MP safety ceiling`);
    }
  });

  await t.test('10. Cleanup & Restore initial logo', async () => {
    if (initialLogoUrl) {
      db.prepare('UPDATE brands SET logo_url = ? WHERE id = ?').run(initialLogoUrl, BRAND_ID);
    }
    server.close();
  });
});
