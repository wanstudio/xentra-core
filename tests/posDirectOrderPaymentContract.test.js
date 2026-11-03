'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('POS Direct Order Payment Contract (Bayar di Kasir)', async (t) => {
  const posAppJs = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/js/pos-app.js'), 'utf8');
  const posCss = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/css/pos.css'), 'utf8');
  const cashSettleJs = fs.readFileSync(path.join(__dirname, '../domains/payment/services/CashSettlementService.js'), 'utf8');

  await t.test('1. pos-app.js defines openDirectOrderPayModal function', () => {
    assert.match(posAppJs, /async\s+function\s+openDirectOrderPayModal\s*\(\s*orderId\s*\)/,
      'openDirectOrderPayModal function must be declared');
  });

  await t.test('2. data-open-pay clicks route directly to openDirectOrderPayModal (not openCheckManager)', () => {
    assert.match(posAppJs, /box\.querySelectorAll\('\[data-open-pay\]'\)\.forEach\(function\(b\)\{b\.onclick=function\(e\)\{e\.stopPropagation\(\);openDirectOrderPayModal\(b\.dataset\.openPay\);\}\;\}\);/,
      'data-open-pay in sales list must invoke openDirectOrderPayModal');
  });

  await t.test('3. pos-sale-detail-pay in order detail modal routes to openDirectOrderPayModal', () => {
    assert.match(posAppJs, /\$\('pos-sale-detail-pay'\)\.onclick\s*=\s*function\(\)\{\s*hideModal\(\);\s*openDirectOrderPayModal\(orderId\);\s*\};/,
      'Detail modal Bayar di Kasir button must invoke openDirectOrderPayModal');
  });

  await t.test('4. openDirectOrderPayModal preserves split-bill fallback for multi-check orders', () => {
    assert.ok(posAppJs.includes('if(checks.length > 1){'),
      'Multi-check orders (>1 check) must be delegated to openCheckManager');
    assert.ok(posAppJs.includes('return openCheckManager(orderId);'),
      'Must return openCheckManager when checks.length > 1');
  });

  await t.test('5. openDirectOrderPayModal provides direct cash inputs, quick denoms, and change display', () => {
    assert.ok(posAppJs.includes('pos-direct-tendered'), 'Must contain tendered input');
    assert.ok(posAppJs.includes('pos-btn-quick-cash'), 'Must contain quick denomination buttons');
    assert.ok(posAppJs.includes('pos-direct-change'), 'Must contain change indicator');
    assert.ok(posAppJs.includes('pos-direct-split-btn'), 'Must contain Pisah Tagihan button');
    assert.ok(posAppJs.includes('pos-direct-submit-btn'), 'Must contain Bayar button');
    assert.ok(posAppJs.includes('>Bayar</button>'), 'Submit button label must be Bayar');
    assert.ok(posAppJs.includes('pos-direct-actions-row'), 'Must use pos-direct-actions-row for 50-50 buttons');
    assert.ok(posAppJs.includes('pos-direct-split-wrap'), 'Must use pos-direct-split-wrap for split bill link');
    assert.ok(posAppJs.includes('/pos/orders/\' + encodeURIComponent(orderId) + \'/settle-cash'),
      'Must execute settle-cash endpoint on submit');
  });

  await t.test('6. openDirectOrderPayModal displays warning when pending additions exist', () => {
    assert.ok(posAppJs.includes('pos-direct-pay-warning'), 'Must define warning container for pending additions');
    assert.ok(posAppJs.includes('pesanan tambahan'), 'Copywriting must explain pending kitchen additions');
  });

  await t.test('7. openPayCheck transitions to showPaymentSuccess on zero remaining order balance', () => {
    assert.ok(posAppJs.includes('res.order_remaining != null && Number(res.order_remaining) <= 0'),
      'Must check if order_remaining <= 0 after check pay');
    assert.ok(posAppJs.includes('showPaymentSuccess({ id: orderId'),
      'Must invoke showPaymentSuccess when final check is paid');
  });

  await t.test('8. pos.css defines styling for pos-direct-pay-modal, quick denoms, and change states', () => {
    assert.ok(posCss.includes('.pos-direct-pay-modal'), 'pos.css must include .pos-direct-pay-modal');
    assert.ok(posCss.includes('.pos-direct-denom-grid'), 'pos.css must include .pos-direct-denom-grid');
    assert.ok(posCss.includes('.pos-direct-total-banner'), 'pos.css must include .pos-direct-total-banner');
    assert.ok(posCss.includes('.pos-direct-pay-warning'), 'pos.css must include .pos-direct-pay-warning');
    assert.ok(posCss.includes('.pos-direct-actions-row'), 'pos.css must include .pos-direct-actions-row');
    assert.ok(posCss.includes('grid-template-columns:1fr 1fr'), 'Actions row must be 50%-50% grid');
    assert.ok(posCss.includes('.pos-direct-split-wrap'), 'pos.css must include .pos-direct-split-wrap');
    assert.ok(posCss.includes('justify-content:flex-end'), 'Split wrap must align right');
  });

  await t.test('9. CashSettlementService synchronizes pos_order_checks status for canonical orders', () => {
    assert.ok(cashSettleJs.includes('const checks = posBillRepository.findChecks(order_id);'),
      'CashSettlementService must load checks for the settled order');
    assert.ok(cashSettleJs.includes("posBillRepository.setCheckStatus(check.id, 'paid', now);"),
      'CashSettlementService must mark open checks paid upon cash settlement');
  });
});
