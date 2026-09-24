'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML_PATH = path.resolve(__dirname, '../../apps/customer-pwa/index.html');
const SW_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/pwa/service-worker.js');
const HOME_JS_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js');

test('Customer PWA Home First Load Audit & Optimization', async (t) => {
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const swCode = fs.readFileSync(SW_PATH, 'utf8');
  const homeJs = fs.readFileSync(HOME_JS_PATH, 'utf8');

  await t.test('1. Parser-blocking JS audit: Lazy-loaded modules must NOT appear as eager script tags in index.html', () => {
    // These modules MUST NOT be loaded eagerly in initial HTML
    const forbiddenScripts = [
      '/assets/js/core/payment-gateway.js',
      '/assets/js/core/location-picker.js',
      '/assets/js/core/table-qr.js',
      '/assets/js/core/fulfillment-environments.js',
      '/assets/js/core/delivery-schedule.js',
      '/assets/js/pages/checkout.js',
      '/assets/js/pages/order-received.js',
      '/assets/js/pages/aux-pages.js'
    ];

    for (const src of forbiddenScripts) {
      const tagPattern = new RegExp('<script[^>]*src=["\']' + src.replace(/\//g, '\\/') + '["\']', 'i');
      assert.ok(
        !tagPattern.test(indexHtml),
        `Script ${src} must NOT be loaded eagerly in index.html for Home first boot`
      );
    }
  });

  await t.test('2. Critical Home modules MUST be present in index.html', () => {
    const requiredScripts = [
      '/assets/js/core/store.js',
      '/assets/js/core/ui.js',
      '/assets/js/core/api.js',
      '/assets/js/core/nav.js',
      '/assets/js/core/router.js',
      '/assets/js/core/pwa-runtime.js',
      '/assets/js/core/media.js',
      '/assets/js/pages/home.js'
    ];

    for (const src of requiredScripts) {
      const tagPattern = new RegExp('<script[^>]*src=["\']' + src.replace(/\//g, '\\/') + '["\']', 'i');
      assert.ok(
        tagPattern.test(indexHtml),
        `Essential script ${src} must be loaded in index.html for Home`
      );
    }
  });

  await t.test('3. Service Worker pre-cache: Route-only assets removed from install STATIC_ASSETS', () => {
    // STATIC_ASSETS must only contain critical home shell assets
    const nonHomeAssets = [
      '/assets/css/checkout.css',
      '/assets/css/order-received.css',
      '/assets/css/location-picker.css',
      '/assets/js/pages/checkout.js',
      '/assets/js/pages/order-received.js',
      '/assets/js/pages/aux-pages.js',
      '/assets/js/core/location-picker.js',
      '/assets/js/core/delivery-schedule.js',
      '/assets/js/core/fulfillment-environments.js'
    ];

    // Extract STATIC_ASSETS array from SW code
    const staticAssetsMatch = /var\s+STATIC_ASSETS\s*=\s*\[([\s\S]*?)\];/.exec(swCode);
    assert.ok(staticAssetsMatch, 'STATIC_ASSETS array must be defined in service-worker.js');
    const staticAssetsStr = staticAssetsMatch[1];

    for (const asset of nonHomeAssets) {
      assert.ok(
        !staticAssetsStr.includes(`"${asset}"`) && !staticAssetsStr.includes(`'${asset}'`),
        `Asset ${asset} must NOT be in install STATIC_ASSETS array`
      );
    }

    // Must still pre-cache critical home shell
    assert.ok(staticAssetsStr.includes('"/"'), 'Must pre-cache root');
    assert.ok(staticAssetsStr.includes('"/assets/css/home.css"'), 'Must pre-cache home.css');
    assert.ok(staticAssetsStr.includes('"/assets/js/pages/home.js"'), 'Must pre-cache home.js');
  });

  await t.test('4. Service Worker caching strategy implements Stale-While-Revalidate for JS & CSS', () => {
    assert.ok(
      swCode.includes('staleWhileRevalidate'),
      'service-worker.js must implement staleWhileRevalidate'
    );
    assert.ok(
      /url\.pathname\.startsWith\(["']\/assets\/css\/["']\)\s*\|\|\s*url\.pathname\.startsWith\(["']\/assets\/js\/["']\)/.test(swCode),
      'CSS and JS assets must be routed to staleWhileRevalidate'
    );
    assert.ok(
      swCode.includes('MEDIA_CACHE_NAME') && swCode.includes('cacheFirst(event, MEDIA_CACHE_NAME)'),
      'Media cache must be preserved with Cache-First'
    );
  });

  await t.test('5. Lazy module contracts: ensurePaymentGateway, ensureTableQr, and ensureLocationPicker exist', () => {
    assert.ok(indexHtml.includes('window.Xentra.ensurePaymentGateway = function'), 'ensurePaymentGateway must exist');
    assert.ok(indexHtml.includes('window.Xentra.ensureTableQr = function'), 'ensureTableQr must exist');
    assert.ok(indexHtml.includes('window.Xentra.ensureLocationPicker = function'), 'ensureLocationPicker must exist');
    assert.ok(indexHtml.includes('window.XentraLocationPicker = {'), 'window.XentraLocationPicker stub must exist');
    assert.ok(indexHtml.includes('window.Xentra.TableQr = {'), 'window.Xentra.TableQr stub must exist');
  });

  await t.test('6. Location picker stub supports updateBar immediately without downloading full script', () => {
    // In index.html, updateHomeLocationBar is provided to updateBar so Home can display location
    assert.ok(
      indexHtml.includes('function updateHomeLocationBar()'),
      'Standalone updateHomeLocationBar must be provided for Home first paint'
    );
    assert.ok(
      indexHtml.includes('updateBar: updateHomeLocationBar'),
      'XentraLocationPicker.updateBar must use the standalone updater'
    );
  });

  await t.test('7. Checkout route lazily fetches fulfillment-environments, delivery-schedule, and payment-gateway', () => {
    assert.ok(
      indexHtml.includes("loadScriptOnce('/assets/js/core/fulfillment-environments.js')"),
      'ensureController(checkout) must load fulfillment-environments.js'
    );
    assert.ok(
      indexHtml.includes("loadScriptOnce('/assets/js/core/delivery-schedule.js')"),
      'ensureController(checkout) must load delivery-schedule.js'
    );
    assert.ok(
      indexHtml.includes('window.Xentra.ensurePaymentGateway()'),
      'ensureController(checkout) must ensure payment gateway'
    );
  });

  await t.test('8. Home performance marks: User Timing marks emitted', () => {
    assert.ok(homeJs.includes("performance.mark(mark)"), 'perfLog must emit performance.mark');
    assert.ok(homeJs.includes("perfLog('home_init_start')"), 'home_init_start mark must be logged');
    assert.ok(homeJs.includes("perfLog('home_api_start')"), 'home_api_start mark must be logged');
    assert.ok(homeJs.includes("perfLog('home_first_render')"), 'home_first_render mark must be logged');
  });

  await t.test('9. No duplicate /brand/info on boot', () => {
    assert.ok(
      indexHtml.includes('window.__XENTRA_HOME_V2 = true'),
      '__XENTRA_HOME_V2 must be set in index.html to prevent duplicate /brand/info in store.js'
    );
  });
});
