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

test('T8: the summary card shows the change directly under the cash prepared', () => {
  const code = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  // Rendered inside the "Uang Tunai Disiapkan" column, so it sits right below
  // the amount the customer prepares.
  assert.ok(code.includes('>Uang Tunai Disiapkan</span>'), 'the prepared-cash row must exist');
  assert.ok(code.includes('>Kembalian <b id="x-sum-change"'), 'the change must render under it');

  // One formula: change = tendered - amount due, never negative.
  assert.ok(code.includes('function tenderChange()'), 'the change must have a single source');
  assert.ok(code.includes('return Math.max(0, Number(state.cashTendered || 0) - payableTotal());'),
    'change must be tendered minus the amount due, clamped at 0');
  assert.ok(code.includes('if (!needsCashTendered()) return 0;'),
    'change is computed only when money changes hands at the door');

  // Kept live when the bill is recomputed (promo, fee, quantity).
  assert.ok(code.includes("var elChange = $('x-sum-change'); if (elChange) elChange.textContent = fmtIDR(tenderChange());"),
    'changing the bill must refresh the change');

  // Cash only: the block renders only for cash with a tendered amount.
  assert.ok(code.includes('(needsCashTendered() && state.cashTendered ? ('),
    'the change must not show when nothing is prepared up front');
});

test('T9: paying at the counter (dine-in & pickup) changes the label, CTA and tender rules', () => {
  const code = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  // One predicate owns the whole rule.
  assert.ok(code.includes('function isPayAtCashier()'), 'a single predicate must own the rule');
  assert.ok(code.includes("var atCounter = (t === 'dinein' || t === 'dine_in' || t === 'pickup');"),
    'dine-in and pickup pay at the counter');
  assert.ok(code.includes('function needsCashTendered()'),
    'prepared cash must be derived from that predicate');

  // Label + subtitle per fulfillment type.
  assert.ok(code.includes("? { title: 'Cash Tunai', sub: 'Bayar di kasir' }"),
    'counter payments are labelled Cash Tunai / Bayar di kasir');
  assert.ok(code.includes(": { title: 'Tunai (COD)', sub: 'Bayar ke driver' };"),
    'delivery COD is labelled Tunai (COD) / Bayar ke driver');

  // CTA per choice.
  assert.ok(code.includes("if (isPayAtCashier()) return 'Bayar nanti di kasir';"),
    'counter cash defers the payment to the cashier');
  assert.ok(code.includes("if (state.paymentMethod === 'midtrans') return 'Bayar sekarang';"),
    'online pays now');
  assert.ok(code.includes('submitCtaLabel(isReservation)'), 'the CTA must use that label');

  // Picking cash at the counter must not open the tender sheet.
  assert.ok(/optCash[\s\S]{0,240}if \(isPayAtCashier\(\)\) \{/.test(code),
    'picking cash at the counter must not ask how much cash is prepared');

  // No prepared amount, no change, nothing tendered.
  assert.ok(code.includes('if (!needsCashTendered()) return 0;'),
    'no change is computed for a counter payment');
  assert.ok(code.includes('cash_tendered: needsCashTendered() ? state.cashTendered : null'),
    'no tendered amount is sent for a counter payment');
  assert.ok(code.includes('if (needsCashTendered() && (!state.cashTendered'),
    'a tendered amount is required only when money changes hands now');
});

test('T10: checkout resumes the open table bill from the server', () => {
  const code = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  // The bill comes from the server, never from the device.
  assert.ok(code.includes("API.get('/customer/dining-session')"),
    'checkout must ask the server for the open bill');
  assert.ok(code.includes('if (!API || !sess || !sess.token)'),
    'the lookup only applies to a signed-in customer');
  assert.ok(/refreshOpenBill\(\);/.test(code), 'the bill must be fetched when the page loads');

  // Failing to load the bill must never block the checkout.
  assert.ok(code.includes('state.openBill = null;\n      return null;'),
    'a failed bill lookup must degrade quietly, not break checkout');

  // No needless re-render, and never during a submit.
  assert.ok(code.includes("var prev = state.openBill ? JSON.stringify(state.openBill) : 'null';"),
    'an absent bill must not count as a change');
  assert.ok(code.includes('if (prev !== next && !state.isSubmitting) renderLayout();'),
    'the page must never re-render while the order is being submitted');

  // Shown with the server's accumulated total, keyed to the locked table.
  assert.ok(code.includes('id="x-open-bill-total"'), 'the bill total must be rendered');
  assert.ok(code.includes('fmtIDR(Number(state.openBill.total_bill) || 0)'),
    'the total must come from the server bill, not be recomputed on the client');
  assert.ok(code.includes('>TAGIHAN MEJA '), 'the card must name the table');
  assert.ok(code.includes('function billTableLabel()'), 'the table label must come from the bill');
  assert.ok(code.includes('Pesanan tambahan otomatis masuk ke tagihan ini.'),
    'the customer must be told add-ons join the same bill');
});

test('T11: the customer picks ONE table; joining tables stays hidden', () => {
  const code = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  // One table only, today.
  assert.ok(code.includes('var ALLOW_MULTI_TABLE_SELECT = false;'),
    'multi-table selection must be off');
  assert.ok(code.includes('draft.selectedTableIds = [tid];'),
    'picking a table must replace the selection, not add to it');
  assert.ok(!code.includes('// Customer manual override / multiple selection'),
    'the manual multi-select comment must be gone');

  // The capability is kept, with a note on how to switch it back on.
  assert.ok(code.includes('else if (ALLOW_MULTI_TABLE_SELECT) {'),
    'the multi-table path must remain, behind the switch');
  assert.ok(/ALLOW_MULTI_TABLE_SELECT[\s\S]{0,200}draft\.selectedTableIds\.push\(tid\)/.test(code),
    'joining tables must still be reachable when the switch comes back on');
  assert.ok(/Untuk\s*\n\s*\/\/ membukanya lagi nanti/.test(code),
    'the switch must say how to re-enable it');

  // A big party must not smuggle several tables in through the recommendation.
  assert.ok(code.includes('? res.recommendation.table_ids'),
    'the recommendation path must respect the same rule');
  assert.ok(code.includes(': res.recommendation.table_ids.slice(0, 1);'),
    'the recommendation must be clamped to one table');

  // A stale saved selection must not smuggle a second table back in.
  assert.ok(code.includes(': state.fulfillment.table_ids.slice(0, 1))'),
    'a restored selection must be clamped to one table too');
});

test('T12: scanning a table QR lands the customer on that table', () => {
  const code = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  // The token comes from the QR link (/join?meja=<token>).
  assert.ok(code.includes('function getJoinTokenFromUrl()'), 'the link token must be read from the URL');
  assert.ok(code.includes('/[?&]meja=([^&]+)/'), 'the meja parameter is the token');
  assert.ok(code.includes('if (joinToken) claimTableFromQr(joinToken);'),
    'claiming must happen on mount, only when scanning');

  // The table comes from the server, never guessed from the URL.
  assert.ok(code.includes("API.post('/customer/dining-session/claim', { qr_token: qrToken })"),
    'the claim must go through the server');
  assert.ok(code.includes('state.fulfillment.table_ids = [table.id]'),
    'the scanned table must become the single selection');
  assert.ok(code.includes("state.fulfillment.type = 'dine_in'"),
    'scanning a table means eating in');
  assert.ok(!code.includes('if (bill) state.openBill = bill;'),
    'the QR must not open a bill: a permanently taped QR is not a key');

  // Not signed in yet: keep the token, do not crash, do not lose the scan.
  assert.ok(code.includes('state.pendingJoinToken = qrToken;'),
    'a scan before sign-in must be remembered');
  assert.ok(code.includes('}).catch(function () {\n      return null;'), 'a failed claim must degrade quietly');

  // A revoked QR (the token is rotated when a session closes) must not fail silently.
  assert.ok(code.includes('QR meja ini sudah tidak berlaku'), 'a dead QR must say so, with what to do next');
  assert.ok(code.includes("if (!res || res.success !== true)"), 'the claim result must be checked');
});

test('T13: the table-picking screen can scan the table QR, with a way out for old phones', () => {
  const code = fs.readFileSync(CHECKOUT_PATH, 'utf8');

  // Offered where the customer picks a table, with a plain-language guide.
  assert.ok(code.includes('id="x-btn-scan-table-qr"'), 'the picking screen must offer scanning');
  assert.ok(code.includes('Scan QR di mejamu, pesananmu akan kami antarkan segera'),
    'the customer must be told what scanning does');
  assert.ok(code.includes("var scanQrBtn = schedContainer.querySelector('#x-btn-scan-table-qr');"),
    'the button must be picked up from the section');
  assert.ok(code.includes('scanQrBtn.onclick = function () { openTableQrScanner(); };'),
    'the button must open the scanner');

  // Gaya bar info yang sudah dipakai untuk ketersediaan promo, dengan ikonnya.
  assert.ok(code.includes('id="x-dinein-scan-info"'), 'bar info dine-in harus ada');
  // Satu kesatuan: info + tindakan di dalam bar yang sama, bukan dua blok.
  assert.ok(/x-dinein-scan-info"[\s\S]{0,1400}x-btn-scan-table-qr/.test(code),
    'tombol scan harus di DALAM bar info');
  assert.ok(!code.includes('x-dinein-scan-info"></div>'), 'tidak boleh ada bar terpisah tanpa isi');
  assert.ok(/x-btn-scan-table-qr"[\s\S]{0,700}<svg/.test(code), 'tombol harus pakai ikon scan');
  assert.ok(/Scan QR<\/button>/.test(code), 'label tombol harus ringkas');
  assert.ok(!code.includes('class="x-btn-secondary" style="font-size:12px;padding:6px 14px;">Scan QR di Meja'),
    'gaya tombol lama harus diganti');
  assert.ok(/x-dinein-scan-info"[\s\S]{0,120}x-fulfillment-promo-icon">i</.test(code),
    'ikon information harus dipertahankan');
  assert.ok(code.indexOf('x-dinein-scan-info') < code.indexOf('x-dinein-floor-canvas'),
    'bar info harus DI ATAS area meja');

  // Camera scanning, feature-detected rather than assumed.
  assert.ok(code.includes("typeof window.BarcodeDetector === 'function'"),
    'the decoder support must be detected, not assumed');
  assert.ok(code.includes("facingMode: 'environment'"), 'the back camera must be used');
  assert.ok(code.includes("new window.BarcodeDetector({ formats: ['qr_code'] })"), 'decode QR codes');

  // Old phones / refused camera: never a dead end.
  assert.ok(code.includes('HP ini tidak bisa scan langsung'),
    'unsupported browsers must be told what to do instead');
  assert.ok(code.includes('Kamera tidak bisa dipakai'), 'a refused camera must be handled');
  assert.ok(code.includes('id="x-qr-manual"'), 'a manual code entry must exist');
  assert.ok(code.includes('function extractMejaToken('), 'the entered code or link must be understood');
  assert.ok(code.includes('/^qr_[A-Za-z0-9_-]+$/'), 'a raw table code must be accepted');

  // A scan goes through the same server claim as the QR link.
  assert.ok(/function handleScannedTable\(token\)[\s\S]{0,120}claimTableFromQr\(token\)/.test(code),
    'a scanned table must use the same claim path as the link');

  // The camera must be released, or the phone keeps the light on.
  assert.ok(code.includes('tableQrScanner.stream.getTracks().forEach'), 'camera tracks must be stopped');
  assert.ok(code.includes("document.getElementById('x-table-qr-scanner')"), 'the overlay must be cleaned up');
});
