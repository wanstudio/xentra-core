'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const manifest = (p) => JSON.parse(read(p));

test('PWA-STATUS-01: customer PWA uses a white theme/status bar', () => {
  const files = [
    'apps/customer-pwa/index.html',
    'apps/customer-pwa/checkout.html',
    'apps/customer-pwa/checkout/index.html',
    'apps/customer-pwa/order-received.html',
    'apps/customer-pwa/order-received/index.html'
  ];
  for (const file of files) {
    const html = read(file);
    assert.match(html, /<meta name="theme-color" content="#ffffff">/i, file + ' harus memakai theme-color putih');
    assert.doesNotMatch(html, /setAttribute\(['"]content['"],\s*hex\)/, file + ' tidak boleh mengembalikan theme-color ke primary brand');
  }
  const m = manifest('apps/customer-pwa/assets/pwa/manifest.json');
  assert.equal(String(m.theme_color).toLowerCase(), '#ffffff');
  assert.equal(String(m.background_color).toLowerCase(), '#ffffff');
});

test('PWA-STATUS-02: merchant/owner portal uses a white theme/status bar', () => {
  for (const file of [
    'apps/merchant-app/index.html',
    'apps/merchant-dashboard/index.html',
    'apps/merchant-dashboard/business-entry.html',
    'apps/merchant-dashboard/managerial-entry.html'
  ]) {
    assert.match(read(file), /<meta name="theme-color" content="#ffffff">/i, file + ' harus memakai theme-color putih');
  }
  const m = manifest('apps/merchant-app/manifest.json');
  assert.equal(String(m.theme_color).toLowerCase(), '#ffffff');
  assert.equal(String(m.background_color).toLowerCase(), '#ffffff');
});

test('PWA-STATUS-03: POS PWA uses a white theme/status bar', () => {
  const html = read('apps/pos-app/index.html');
  assert.match(html, /<meta name="theme-color" content="#ffffff">/i);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="default">/i);
  const m = manifest('apps/pos-app/manifest.json');
  assert.equal(String(m.theme_color).toLowerCase(), '#ffffff');
  assert.equal(String(m.background_color).toLowerCase(), '#ffffff');
});
