'use strict';

const test = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', '..');
const dashboardHtml = fs.readFileSync(
  path.join(root, 'apps/merchant-dashboard/index.html'),
  'utf8'
);
const dashboardJs = fs.readFileSync(
  path.join(root, 'apps/merchant-dashboard/assets/js/dashboard.js'),
  'utf8'
);

test('promotion reward editor is Menu-targeted end to end at the Owner UI boundary', () => {
  assert.ok(dashboardHtml.includes('id="mkt-promo-target-menu"'));
  assert.ok(dashboardHtml.includes('Menu yang Diberikan'));
  assert.ok(!dashboardHtml.includes('id="mkt-promo-target-product"'));
  assert.ok(!dashboardHtml.includes('for="mkt-promo-target-product"'));

  assert.ok(dashboardJs.includes("API_BASE + '/admin/menus?status=ACTIVE'"));
  assert.ok(dashboardJs.includes("_marketingPromotionsState.masterMenus"));
  assert.ok(dashboardJs.includes("target_menu_id: targetMenuId"));
  assert.ok(dashboardJs.includes("primaryReward.target_menu_id || primaryReward.menu_id || null"));

  // Product-only reward creation is quarantined from the forward UI.
  assert.ok(!dashboardJs.includes("target_product_id: targetProductId"));
  assert.ok(!dashboardJs.includes("var targetProductId = $('mkt-promo-target-product').value"));
});
