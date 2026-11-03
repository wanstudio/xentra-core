'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('POS Cashier Menu Card Stepper Animation & Identity Contract', async (t) => {
  const posAppJs = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/js/pos-app.js'), 'utf8');
  const posCss = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/css/pos.css'), 'utf8');

  await t.test('1. pos-app.js updateMenuCardBadges supports canonical menuCartIdentity and menu_id matching', () => {
    assert.ok(posAppJs.includes('cardIdentity'), 'Must determine cardIdentity');
    assert.ok(posAppJs.includes('menuCartIdentity(item) === cardIdentity'),
      'Must match items using menuCartIdentity against cardIdentity');
    assert.ok(posAppJs.includes('item.menu_id && String(item.menu_id) === String(pid)'),
      'Must support direct menu_id comparison fallback');
  });

  await t.test('2. pos-app.js renders data-identity on product cards', () => {
    assert.ok(posAppJs.includes('data-identity="'), 'pos-product card must render data-identity');
  });

  await t.test('3. pos-app.js applies animation classes during stepper reveal, qty bump, and add button restore', () => {
    assert.ok(posAppJs.includes('pos-stepper-pop'), 'Must apply pos-stepper-pop animation class on stepper show');
    assert.ok(posAppJs.includes('pos-val-bump'), 'Must apply pos-val-bump animation class on quantity change');
    assert.ok(posAppJs.includes('pos-badge-pop'), 'Must apply pos-badge-pop animation class on badge show');
    assert.ok(posAppJs.includes('pos-btn-pop'), 'Must apply pos-btn-pop animation class on addBtn restore');
  });

  await t.test('4. pos.css defines keyframes and rules for stepper pop, button pop, and value bump animations', () => {
    assert.ok(posCss.includes('@keyframes posCardStepperPop'), 'Must define @keyframes posCardStepperPop');
    assert.ok(posCss.includes('@keyframes posAddBtnPop'), 'Must define @keyframes posAddBtnPop');
    assert.ok(posCss.includes('@keyframes posValBump'), 'Must define @keyframes posValBump');
    assert.ok(posCss.includes('@keyframes posBadgePop'), 'Must define @keyframes posBadgePop');
    assert.ok(posCss.includes('.pos-card-stepper.pos-stepper-pop'), 'Must define .pos-card-stepper.pos-stepper-pop');
    assert.ok(posCss.includes('.pos-product-add-btn.pos-btn-pop'), 'Must define .pos-product-add-btn.pos-btn-pop');
    assert.ok(posCss.includes('.pos-card-qty-val.pos-val-bump'), 'Must define .pos-card-qty-val.pos-val-bump');
  });

  await t.test('5. pos.css defines tactile active states for stepper action buttons', () => {
    assert.ok(posCss.includes('.pos-card-qty-btn:active'), 'Must have :active pseudo-class on .pos-card-qty-btn');
  });
});
