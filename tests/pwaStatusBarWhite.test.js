'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const { PWA_THEME } = require('../server/config/pwa-theme');

test('PWA-STATUS-01: all app HTML pages consume the canonical PWA theme config', () => {
  for (const file of [
    'apps/customer-pwa/index.html',
    'apps/customer-pwa/checkout.html',
    'apps/customer-pwa/checkout/index.html',
    'apps/customer-pwa/order-received.html',
    'apps/customer-pwa/order-received/index.html',
    'apps/merchant-app/index.html',
    'apps/merchant-dashboard/index.html',
    'apps/merchant-dashboard/business-entry.html',
    'apps/merchant-dashboard/managerial-entry.html',
    'apps/pos-app/index.html'
  ]) {
    assert.match(read(file), /<script src="\/pwa-theme\.js"><\/script>/,
      file + ' harus memakai canonical PWA theme loader');
  }
});

test('PWA-STATUS-02: canonical PWA surface color is white', () => {
  assert.equal(String(PWA_THEME.surfaceColor).toLowerCase(), '#ffffff');
});

test('PWA-STATUS-03: POS keeps the standard status-bar mode', () => {
  const html = read('apps/pos-app/index.html');
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="default">/i);
});
