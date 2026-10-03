'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOME = fs.readFileSync(
  path.join(__dirname, '../apps/customer-pwa/assets/js/pages/home.js'),
  'utf8'
);

test('Customer Home banner product CTA uses canonical composed catalog transport', () => {
  const start = HOME.indexOf('function goToBannerProduct(productId)');
  const end = HOME.indexOf('function goToBannerPromotion(', start);
  assert.ok(start >= 0 && end > start, 'Banner product helper must exist');

  const helper = HOME.slice(start, end);
  assert.ok(helper.includes("'/catalog/composed-menu"));
  assert.ok(helper.includes('adaptCanonicalHomeCatalog(rawData)'));
  assert.ok(helper.includes('data.all_products'));
  assert.ok(!helper.includes("'/catalog/menu"));
});
