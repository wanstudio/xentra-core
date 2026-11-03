const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const posAppJsPath = path.resolve(__dirname, '../apps/pos-app/assets/js/pos-app.js');
const posCssPath = path.resolve(__dirname, '../apps/pos-app/assets/css/pos.css');

test('POS Transaction Card Clickable & Detail Modal Contract', async (t) => {
  const posAppJs = fs.readFileSync(posAppJsPath, 'utf8');
  const posCss = fs.readFileSync(posCssPath, 'utf8');

  await t.test('1. [Detail] button is removed from transaction cards', () => {
    assert.strictEqual(
      posAppJs.includes('data-sale-detail'),
      false,
      'renderSales must not render any data-sale-detail button'
    );
  });

  await t.test('2. Each transaction card (.pos-sale-row) is clickable to open detail modal', () => {
    assert.match(
      posAppJs,
      /box\.querySelectorAll\('\.pos-sale-row'\)\.forEach\(function\(row\)\{/,
      'Must attach click handler to all .pos-sale-row cards'
    );
    assert.match(
      posAppJs,
      /if\(e\.target\.closest\('button'\)\)\s*return;/,
      'Row click handler must guard against child button clicks'
    );
    assert.match(
      posAppJs,
      /openSaleDetailModal\(row\.dataset\.saleId\);/,
      'Row click must open the sale detail modal'
    );
  });

  await t.test('3. openSaleDetailModal builds structured, polished layout', () => {
    assert.ok(
      posAppJs.includes('pos-modal-sale-detail'),
      'Detail modal must pass pos-modal-sale-detail extra class'
    );
    assert.ok(
      posAppJs.includes('pos-sale-detail-head'),
      'Must contain pos-sale-detail-head'
    );
    assert.ok(
      posAppJs.includes('pos-sale-meta-grid'),
      'Must contain pos-sale-meta-grid with service, customer, payment method, and cashier'
    );
    assert.ok(
      posAppJs.includes('pos-sale-items-box'),
      'Must contain pos-sale-items-box'
    );
    assert.ok(
      posAppJs.includes('pos-sale-summary-box'),
      'Must contain pos-sale-summary-box with financial breakdown'
    );
    assert.ok(
      posAppJs.includes('pos-sale-grand-total-row'),
      'Must contain pos-sale-grand-total-row for prominent total highlight'
    );
    assert.ok(
      posAppJs.includes('pos-sale-detail-actions'),
      'Must contain pos-sale-detail-actions'
    );
  });

  await t.test('4. Action routing contracts in detail modal are preserved', () => {
    assert.match(
      posAppJs,
      /\$\('pos-sale-detail-pay'\)\.onclick\s*=\s*function\(\)\{\s*hideModal\(\);\s*openDirectOrderPayModal\(orderId\);\s*\};/,
      'pos-sale-detail-pay must route to openDirectOrderPayModal'
    );
    assert.match(
      posAppJs,
      /\$\('pos-sale-detail-settle'\)\.onclick\s*=\s*function\(\)\{\s*hideModal\(\);\s*openCodSettlementModal\(orderId\);\s*\};/,
      'pos-sale-detail-settle must route to openCodSettlementModal'
    );
    assert.match(
      posAppJs,
      /\$\('pos-sale-detail-print'\)\.onclick\s*=\s*function\(\)\{\s*printReceipt\(orderId\);\s*\};/,
      'pos-sale-detail-print must invoke printReceipt'
    );
  });

  await t.test('5. pos.css defines styling for row interactions and detail modal', () => {
    assert.match(
      posCss,
      /\.pos-sale-row\s*\{[^}]*cursor:\s*pointer/,
      '.pos-sale-row must have cursor: pointer'
    );
    assert.ok(
      posCss.includes('.pos-sale-row:hover'),
      '.pos-sale-row:hover feedback must be styled'
    );
    assert.ok(
      posCss.includes('.pos-modal-sale-detail'),
      '.pos-modal-sale-detail must be styled'
    );
    assert.ok(
      posCss.includes('.pos-sale-meta-grid'),
      '.pos-sale-meta-grid must be styled'
    );
    assert.ok(
      posCss.includes('.pos-sale-items-box'),
      '.pos-sale-items-box must be styled'
    );
    assert.ok(
      posCss.includes('.pos-sale-summary-box'),
      '.pos-sale-summary-box must be styled'
    );
  });
});
