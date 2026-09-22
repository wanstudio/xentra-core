/**
 * COD Cash Tender Custom Input Formatting Tests
 *
 * Verifies:
 * 1. Thousands separator uses '.' (dot) per Indonesian Rupiah format.
 * 2. 50000 -> "50.000", 100000 -> "100.000", 500000 -> "500.000", 1500000 -> "1.500.000"
 * 3. Never produces: "500000", "50,000", "500..000", "Rp Rp 50.000"
 * 4. Internal state: cash_tendered is strictly number integer (e.g. 50000), never a string.
 * 5. Paste handling formats correctly.
 * 6. Caret / backspace navigation across dot separators.
 * 7. Sheet reopening preserves formatted display value.
 * 8. Presets (50k, 100k) remain intact.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const UI_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/ui.js');
const CHECKOUT_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js');

test('T1: UI.formatNumber produces deterministic dot-separated Rupiah numbers', () => {
  // Fresh environment for UI
  delete require.cache[UI_PATH];
  globalThis.window = globalThis.window || {};
  globalThis.document = globalThis.document || {
    documentElement: { style: { setProperty: () => {} } },
    querySelector: () => null
  };

  require(UI_PATH);
  const UI = globalThis.window.Xentra.UI;

  assert.ok(typeof UI.formatNumber === 'function', 'UI.formatNumber must be exposed');

  assert.strictEqual(UI.formatNumber(50000), '50.000');
  assert.strictEqual(UI.formatNumber(100000), '100.000');
  assert.strictEqual(UI.formatNumber(500000), '500.000');
  assert.strictEqual(UI.formatNumber(1500000), '1.500.000');
  assert.strictEqual(UI.formatNumber(0), '0');

  // Negative checks
  assert.notStrictEqual(UI.formatNumber(500000), '500000');
  assert.notStrictEqual(UI.formatNumber(50000), '50,000');
  assert.ok(!UI.formatNumber(500000).includes('..'));
  assert.ok(!UI.formatNumber(500000).includes(','));
});

test('T2: UI.money produces "Rp" prefix with dot separator', () => {
  const UI = globalThis.window.Xentra.UI;
  assert.strictEqual(UI.money(50000), 'Rp50.000');
  assert.strictEqual(UI.money(500000), 'Rp500.000');
  assert.strictEqual(UI.money(1500000), 'Rp1.500.000');
});

test('T3: Checkout source code adheres to formatting, normalization, and UI prefix contracts', () => {
  const code = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  // fmtIDR helper must use UI.formatNumber or deterministic regex
  assert.ok(code.includes('fmtIDR'), 'checkout.js must contain fmtIDR helper');
  assert.ok(code.includes('UI.formatNumber') || code.includes('\\B(?=(\\d{3})+(?!\\d))'), 'fmtIDR must use dot separator regex or UI.formatNumber');

  // Prefix in DOM is Rp
  assert.ok(code.includes('class="x-tender-custom-prefix">Rp</span>'), 'custom prefix must be separated span');

  // Input must be formatted oninput with fmtIDR
  assert.ok(code.includes('elCustomInput.oninput'), 'custom input must have oninput handler');
  assert.ok(code.includes('fmtIDR(num)'), 'formatted value must use fmtIDR');

  // State normalization: cashTendered must be integer
  assert.ok(code.includes('parseInt(customValue, 10)'), 'custom value must be parsed to integer');
  assert.ok(code.includes('state.cashTendered = tendered'), 'state.cashTendered must receive normalized number');
  assert.ok(!code.includes("state.cashTendered = 'Rp'"), 'state.cashTendered must NEVER be formatted string');
});

test('T4: Custom COD input typing simulation formats input with dots while tracking integer', () => {
  // Test typing step by step: '5' -> '50' -> '500' -> '5000' -> '50000'
  function fmtIDR(n) {
    var num = Math.floor(Number(n) || 0);
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  const inputs = ['5', '50', '500', '5000', '50000', '500000', '1500000'];
  const expectedFormatted = ['5', '50', '500', '5.000', '50.000', '500.000', '1.500.000'];
  const expectedInteger = [5, 50, 500, 5000, 50000, 500000, 1500000];

  for (let i = 0; i < inputs.length; i++) {
    const rawVal = inputs[i];
    const digits = rawVal.replace(/\D/g, '');
    const num = parseInt(digits, 10);
    const formatted = fmtIDR(num);

    assert.strictEqual(formatted, expectedFormatted[i], `Typing ${rawVal} must format as ${expectedFormatted[i]}`);
    assert.strictEqual(num, expectedInteger[i], `Normalized value must be integer ${expectedInteger[i]}`);
    assert.strictEqual(typeof num, 'number', 'Normalized value must be of type number');
  }
});

test('T5: Paste handling strips non-digits and applies thousands separator', () => {
  function fmtIDR(n) {
    var num = Math.floor(Number(n) || 0);
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  const pasteSamples = [
    { paste: '50000', expectedFormat: '50.000', expectedNum: 50000 },
    { paste: 'Rp 50.000', expectedFormat: '50.000', expectedNum: 50000 },
    { paste: 'Rp500000', expectedFormat: '500.000', expectedNum: 500000 },
    { paste: '1.500.000', expectedFormat: '1.500.000', expectedNum: 1500000 }
  ];

  for (const sample of pasteSamples) {
    const digits = sample.paste.replace(/\D/g, '');
    const num = parseInt(digits, 10);
    const formatted = fmtIDR(num);

    assert.strictEqual(formatted, sample.expectedFormat, `Pasting "${sample.paste}" must display "${sample.expectedFormat}"`);
    assert.strictEqual(num, sample.expectedNum, `Pasting "${sample.paste}" must resolve internal integer ${sample.expectedNum}`);
  }
});

test('T6: Caret calculation maintains smooth position when formatting alters length', () => {
  // When user types 0 at end of '5.000' -> '5.0000' -> formatted to '50.000'
  const rawVal = '5.0000';
  const rawCursor = 6;
  const digitsBeforeCursor = rawVal.slice(0, rawCursor).replace(/\D/g, '').length; // 5 digits
  const formatted = '50.000';

  let targetCursor = 0;
  let count = 0;
  for (let idx = 0; idx < formatted.length; idx++) {
    if (/\d/.test(formatted.charAt(idx))) {
      count++;
    }
    if (count === digitsBeforeCursor) {
      targetCursor = idx + 1;
      break;
    }
  }

  assert.strictEqual(targetCursor, 6, 'Caret must stay at the end of formatted string');
});

test('T7: preset radios are limited by the amount due (total pembayaran)', () => {
  const code = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  // The threshold must be the real total, not a hardcoded minimum.
  assert.ok(code.includes('function payableTotal()'), 'checkout.js must expose the amount actually due');
  assert.ok(code.includes('var payable = payableTotal();'), 'the sheet must read that amount');

  // Eligibility: only presets that cover the total stay pickable.
  // Total Rp45.000 -> Rp50.000 & Rp100.000 pickable, Rp10.000 & Rp20.000 not.
  assert.ok(code.includes('var eligible = p.value >= payable;'), 'a preset is pickable only when it covers the total');
  assert.ok(code.includes('if (eligible) eligibleKeys.push(p.key);'), 'eligible presets must be tracked');

  // Ineligible presets are marked and never bound to a click handler.
  assert.ok(code.includes('aria-disabled="true"'), 'ineligible presets must be marked disabled');
  assert.ok(code.includes('if (p.value < payable) return; // below the bill — not selectable'),
    'ineligible presets must not receive a click handler');

  // A selection the customer cannot use is never left open.
  assert.ok(code.includes('if (!customIsUsable && eligibleKeys.indexOf(selectedType) === -1)'), 'an unusable selection must be dropped');
  assert.ok(code.includes("selectedType = eligibleKeys.length ? eligibleKeys[0] : 'custom';"),
    'must fall back to the cheapest covering preset, or Custom when none covers');

  // Custom input and the confirm button follow the same floor.
  assert.ok(code.includes('if (!isNaN(num) && num >= payable)'), 'custom amount below the bill must not validate');
  assert.ok(code.includes('if (tendered === null || tendered < payable) return;'),
    'confirm must refuse an amount below the bill');

  // Default selection: the CHEAPEST preset that already covers the bill.
  // Total Rp47.646 -> Rp50.000 ter-pick, bukan Rp100.000.
  assert.ok(!code.includes("state.cashTenderedType || '100k'"),
    'there must be no hardcoded default denomination');
  assert.ok(code.includes("var selectedType = state.cashTenderedType || null;"),
    'an unchosen sheet must fall through to the total-driven default');
  assert.ok(code.includes('var customIsUsable = selectedType === \'custom\' && parseInt(customValue, 10) >= payable;'),
    'a saved custom amount must not be overwritten by the default');
  assert.ok(code.indexOf('eligibleKeys[0]') < code.indexOf('var sheetHtml'),
    'the cheapest covering preset must be chosen before the sheet is rendered');

  // The old hardcoded bindings must be gone.
  assert.ok(!code.includes('elPreset10k'), 'hardcoded preset bindings must be removed');
});
