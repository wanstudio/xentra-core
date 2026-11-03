const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../server/database/db');
const app = require('../server/app');

test('CUSTOMER MENU SHARE PARITY SUITE (GoFood / GrabFood style)', async (t) => {
  await t.test('1. Server injects dynamic Open Graph tags (og:title, og:image, og:description, twitter:card) for menu query', async () => {
    // Ensure test database has sample product / brand seeded
    db.prepare("UPDATE brands SET name = 'MyBangjo', customer_pwa_name = 'MyBangjo', custom_domain = 'app.mybangjo.com' WHERE id = 'brand_bangjo'").run();
    db.prepare("INSERT OR REPLACE INTO products (id, brand_id, name, slug, description, price, image_url) VALUES ('demo_bangjo_menu_272', 'brand_bangjo', 'Ayam Tulang Lunak Kremes', 'ayam-tulang-lunak-kremes', 'Ayam Tulang Lunak + Tempe Goreng + Lalapan + Kremesan + Sambal Terasi', 50000, '/assets/uploads/products/272-1789351623131.png')").run();

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port,
          path: '/?menu=demo_bangjo_menu_272',
          method: 'GET',
          headers: {
            'Host': 'app.mybangjo.com',
            'User-Agent': 'WhatsApp/2.23.20.10 A'
          }
        }, (res) => {
          let chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode, body });
          });
        });
        req.on('error', reject);
        req.end();
      });

      assert.equal(res.status, 200);
      assert.ok(res.body.includes('property="og:title"'), 'Response must include og:title');
      assert.ok(res.body.includes('property="og:image"'), 'Response must include og:image');
      assert.ok(res.body.includes('property="og:description"'), 'Response must include og:description');
      assert.ok(res.body.includes('name="twitter:card" content="summary_large_image"'), 'Response must include twitter:card');
      
      const titleMatch = res.body.match(/<meta property="og:title" content="([^"]+)">/);
      assert.ok(titleMatch, 'og:title tag must be present in body');
      assert.ok(titleMatch[1].includes('Ayam Tulang Lunak Kremes'), 'og:title contains item name');
      assert.ok(titleMatch[1].includes('MyBangjo'), 'og:title contains brand name');

      const imgMatch = res.body.match(/<meta property="og:image" content="([^"]+)">/);
      assert.ok(imgMatch, 'og:image tag must be present in body');
      assert.ok(imgMatch[1].includes('/assets/uploads/products/272-1789351623131.png'), 'og:image contains product image');
    } finally {
      server.close();
    }
  });

  await t.test('2. Affiliate share-text route returns clean non-redundant share title, text, url, and whatsapp_text', async () => {
    const affiliateRouteSrc = fs.readFileSync(path.join(__dirname, '../server/routes/affiliate.js'), 'utf8');
    assert.ok(affiliateRouteSrc.includes('share_title'), 'affiliate route must emit share_title');
    assert.ok(affiliateRouteSrc.includes('share_text'), 'affiliate route must emit share_text without inline url');
    assert.ok(affiliateRouteSrc.includes('waText = `${shareText}\\n${shareUrl}`'), 'affiliate route formats clean waText');

    // Live endpoint invocation verification (prevents db is not defined regressions)
    const express = require('express');
    const router = express.Router();
    const registerAffiliateRoutes = require('../server/routes/affiliate');
    registerAffiliateRoutes(router, {
      requireCustomerAuth: () => (req, res, next) => {
        req.customer = { customerId: 'cust_parity_test', name: 'Tester' };
        req.brand_id = 'brand_bangjo';
        next();
      },
      requireAuth: () => (req, res, next) => next()
    });
    const subApp = express();
    subApp.use(router);
    const subServer = http.createServer(subApp);
    await new Promise((resolve) => subServer.listen(0, resolve));
    try {
      const port = subServer.address().port;
      const resData = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/customer/affiliate/share-text?menu_id=demo_bangjo_menu_272&menu_title=Ayam`, (res) => {
          let b = '';
          res.on('data', c => b += c);
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
        }).on('error', reject);
      });
      assert.equal(resData.status, 200);
      assert.equal(resData.body.success, true);
      assert.ok(resData.body.share_title.includes('MyBangjo'), 'brand name resolved from DB without errors');
      assert.ok(resData.body.share_url.includes('menu=demo_bangjo_menu_272'), 'menu query present');
    } finally {
      subServer.close();
    }
  });

  await t.test('3. Frontend home.js shares clean non-redundant shareData and auto-opens shared menu detail', () => {
    const homeJsSrc = fs.readFileSync(path.join(__dirname, '../apps/customer-pwa/assets/js/pages/home.js'), 'utf8');
    assert.ok(homeJsSrc.includes('res.share_title'), 'home.js uses clean share_title');
    assert.ok(homeJsSrc.includes('res.share_text'), 'home.js uses clean share_text');
    assert.ok(homeJsSrc.includes('urlParams.get(\'menu\')') || homeJsSrc.includes('menuParam = new URLSearchParams'), 'home.js listens to ?menu= query');
    assert.ok(homeJsSrc.includes('openProductDetail('), 'home.js auto-opens product detail for shared menu');

    // Custom In-App Share Sheet validation
    assert.ok(homeJsSrc.includes('openCustomShareSheet('), 'home.js opens custom share bottom sheet');
    assert.ok(homeJsSrc.includes('x-share-modal-sheet'), 'sheet class is rendered');
    assert.ok(homeJsSrc.includes('x-share-preview-thumb'), 'rich image thumbnail preview is rendered');
    assert.ok(homeJsSrc.includes('x-share-action-wa'), 'direct WhatsApp action button present');
    assert.ok(homeJsSrc.includes('x-share-action-copy'), 'copy link button present');
    assert.ok(homeJsSrc.includes('x-share-action-more'), 'more / native Android sheet trigger present');
  });
});
