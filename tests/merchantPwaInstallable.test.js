'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Merchant PWA Installable — Architecture & Contract Verification', () => {
  const manifestPath = path.join(__dirname, '../apps/merchant-app/manifest.json');
  const swPath = path.join(__dirname, '../apps/merchant-app/sw.js');
  const htmlPath = path.join(__dirname, '../apps/merchant-app/index.html');
  const serverPath = path.join(__dirname, '../server/app.js');
  const icon192Path = path.join(__dirname, '../apps/merchant-app/assets/icons/icon-192.png');
  const icon512Path = path.join(__dirname, '../apps/merchant-app/assets/icons/icon-512.png');

  it('1. Web App Manifest is valid and scoped strictly to /merchant-app/', () => {
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist in apps/merchant-app/');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.equal(manifest.start_url, '/merchant-app/');
    assert.equal(manifest.scope, '/merchant-app/');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.name.includes('Merchant'), 'Manifest name must identify Merchant');
    assert.ok(manifest.short_name.includes('Merchant'), 'Manifest short_name must identify Merchant');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'Manifest must declare at least 192 and 512 icons');

    const has192 = manifest.icons.some(i => i.sizes === '192x192' && i.src.includes('192'));
    const has512 = manifest.icons.some(i => i.sizes === '512x512' && i.src.includes('512'));
    assert.ok(has192, 'Missing 192x192 icon in manifest');
    assert.ok(has512, 'Missing 512x512 icon in manifest');
  });

  it('2. Merchant icons exist physically and are valid PNG files', () => {
    assert.ok(fs.existsSync(icon192Path), 'icon-192.png must exist');
    assert.ok(fs.existsSync(icon512Path), 'icon-512.png must exist');

    const header192 = fs.readFileSync(icon192Path).subarray(0, 8);
    const header512 = fs.readFileSync(icon512Path).subarray(0, 8);
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    assert.ok(header192.equals(pngMagic), 'icon-192.png must be a valid PNG');
    assert.ok(header512.equals(pngMagic), 'icon-512.png must be a valid PNG');
  });

  it('3. merchant-app/index.html includes PWA meta tags, manifest link, and SW registration', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('href="/merchant-app/manifest.json"'), 'Missing manifest link tag in HTML');
    assert.ok(html.includes('apple-mobile-web-app-capable'), 'Missing apple-mobile-web-app-capable meta');
    assert.ok(html.includes('mobile-web-app-capable'), 'Missing mobile-web-app-capable meta');
    assert.ok(html.includes('apple-touch-icon'), 'Missing apple-touch-icon link');
    assert.ok(html.includes('/merchant-app/sw.js'), 'Missing /merchant-app/sw.js service worker registration');
    assert.ok(html.includes("scope: swScope") && html.includes("'/merchant-app/'"), 'Service worker registration must support /merchant-app/ scope');
  });

  it('4. Merchant Service Worker enforces Network-Only for APIs and isolated cache namespace', () => {
    const sw = fs.readFileSync(swPath, 'utf8');

    assert.ok(sw.includes('xentra-merchant-'), 'Must use dedicated xentra-merchant- cache prefix');
    assert.ok(sw.includes('/api/'), 'SW must handle /api/ path bypass');
    assert.ok(sw.includes('/auth/'), 'SW must handle /auth/ path bypass');
    assert.ok(sw.includes('self.clients.claim()'), 'SW must claim clients on activate');
  });

  it('5. server/app.js serves Merchant manifest and sw.js before catch-all routes', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');

    assert.ok(serverCode.includes('/merchant-app/manifest.json'), 'server/app.js must route /merchant-app/manifest.json');
    assert.ok(serverCode.includes('/merchant-app/sw.js'), 'server/app.js must route /merchant-app/sw.js');
    assert.ok(serverCode.includes('Service-Worker-Allowed'), 'server/app.js must send Service-Worker-Allowed header');
  });

  it('6. Cross-PWA Isolation: Customer SW and Merchant SW do not intercept each other', () => {
    const customerSw = fs.readFileSync(path.join(__dirname, '../apps/customer-pwa/assets/pwa/service-worker.js'), 'utf8');
    const merchantSw = fs.readFileSync(swPath, 'utf8');

    // Customer SW must explicitly bypass merchant and pos routes
    assert.ok(customerSw.includes('url.pathname.startsWith("/merchant-app")'), 'Customer SW must bypass /merchant-app');
    assert.ok(customerSw.includes('url.pathname.startsWith("/merchant")'), 'Customer SW must bypass /merchant');
    assert.ok(customerSw.includes('url.pathname.startsWith("/pos")'), 'Customer SW must bypass /pos');

    // Merchant SW must explicitly bypass customer checkout, pos, and foreign surfaces
    assert.ok(merchantSw.includes('url.pathname.startsWith("/checkout")'), 'Merchant SW must bypass /checkout');
    assert.ok(merchantSw.includes('url.pathname.startsWith("/pos")'), 'Merchant SW must bypass /pos');
    assert.ok(merchantSw.includes('url.pathname.startsWith("/merchant-app/")'), 'Merchant SW must guard navigations to merchant scope');
  });

  it('7. Owner dashboard index.html enables PWA installation and uses canonical /owner/ surface', () => {
    const dashboardHtml = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/index.html'), 'utf8');

    assert.ok(dashboardHtml.includes('manifestLink.href = \'/manifest.json?surface=owner\''), 'Must inject owner-surface manifest link');
    assert.ok(dashboardHtml.includes("navigator.serviceWorker.register('/service-worker.js', { scope: '/' })"), 'Must register service-worker.js with scope /');
    assert.ok(dashboardHtml.includes('isBizPortal || !isPlatformHost'), 'Must enable installation on tenant domains while keeping platform host isolated');
    assert.ok(dashboardHtml.includes('apple-mobile-web-app-capable'), 'Must include apple-mobile-web-app-capable meta');
    assert.ok(dashboardHtml.includes('theme-color'), 'Must include theme-color meta');
  });

  it('8. Owner landing remains canonical on managerial and portal surfaces', () => {
    const entryHtml = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/managerial-entry.html'), 'utf8');
    const sharedJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-shared/js/shared.js'), 'utf8');
    const dashboardJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
    const appJs = fs.readFileSync(serverPath, 'utf8');

    assert.ok(entryHtml.includes("window.location.replace('/owner/' + window.location.hash)"), 'Managerial entry must route owner to /owner/');
    assert.ok(sharedJs.includes("if (_landing === '/owner/')") && sharedJs.includes("window.location.replace('/owner/' + window.location.hash)"), 'Shared surface guard must preserve /owner/');
    assert.ok(dashboardJs.includes("enforceSurface(['/owner/'])"), 'Owner dashboard must enforce canonical /owner/ landing');
    assert.ok(appJs.includes("req.query.surface === 'owner'") && appJs.includes("data.start_url = isOwner ? '/owner/' : '/merchant/';"), 'Dynamic manifest must support explicit owner surface');
  });
});
