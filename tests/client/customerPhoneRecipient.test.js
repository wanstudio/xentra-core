/**
 * Customer Phone Completion + Recipient Identity Layer — targeted verification.
 *
 * Source-level tests (no DOM harness): inspects actual executable source.
 *
 * CPC-01  Backend exposes GET /customer/profile (authoritative profile)
 * CPC-02  Backend exposes PATCH /customer/profile/phone with ID mobile validation
 * CPC-03  Phone save refreshes the live customer session (SELF resolves w/o re-login)
 * CPC-04  checkout.js defines openPhoneCompletionSheet with required copy
 * CPC-05  Phone sheet saves via PATCH /customer/profile/phone
 * CPC-06  Submit path gates on phone before creating an order
 * CPC-07  Google-auth return paths route phoneless customers to Phone Completion
 * CPC-08  SELF recipient display resolves phone from Customer Profile
 * CPC-09  OTHER recipient still requires name + valid phone (no OTP/account)
 * CPC-10  Profile UI has WhatsApp row (Tambahkan nomor / Ubah) reusing shared sheet
 * CPC-11  API client supports PATCH
 * CPC-12  Checkout state preservation across Google auth still intact
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const apiRoutes = () => {
  try {
    return read('server/routes/customer.js') + '\n' + read('server/routes/api.js');
  } catch (_) {
    return read('server/routes/api.js');
  }
};
const checkoutJs = () => read('apps/customer-pwa/assets/js/pages/checkout.js');
const auxPages = () => read('apps/customer-pwa/assets/js/pages/aux-pages.js');
const apiClient = () => read('apps/customer-pwa/assets/js/core/api.js');

test('CPC-01: Backend exposes GET /customer/profile', () => {
  const src = apiRoutes();
  assert.ok(src.includes("router.get('/customer/profile'"), 'GET /customer/profile route must exist');
  assert.ok(src.includes('requireCustomerAuth()'), 'profile route must require customer auth');
});

test('CPC-02: Backend exposes PATCH /customer/profile/phone with ID mobile validation', () => {
  const src = apiRoutes();
  const idx = src.indexOf("router.patch('/customer/profile/phone'");
  assert.ok(idx !== -1, 'PATCH /customer/profile/phone route must exist');
  const block = src.substring(idx, idx + 3000);
  assert.ok(block.includes("startsWith('08')") || block.includes('startsWith("08")'), 'must validate 08 prefix');
  assert.ok(block.includes("startsWith('628')") || block.includes('startsWith("628")'), 'must validate 628 prefix');
  assert.ok(block.includes('updateCustomerProfile'), 'must persist via CustomerRepository.updateCustomerProfile');
  assert.ok(block.includes('400'), 'must reject invalid phone with 400');
});

test('CPC-03: Phone save refreshes the live customer session', () => {
  const src = apiRoutes();
  const idx = src.indexOf("router.patch('/customer/profile/phone'");
  const block = src.substring(idx, idx + 3000);
  assert.ok(block.includes('live.phone = clean') || block.includes('live.phone=clean'), 'must update live session phone');
  assert.ok(block.includes('customer_sessions SET phone'), 'must update persisted session row');
});

test('CPC-04: checkout.js defines openPhoneCompletionSheet with required copy', () => {
  const src = checkoutJs();
  assert.ok(src.includes('function openPhoneCompletionSheet'), 'openPhoneCompletionSheet must be defined');
  assert.ok(src.includes('Lengkapi nomor WhatsApp'), 'sheet title copy must match spec');
  assert.ok(src.includes('Nomor ini diperlukan untuk melanjutkan pesanan.'), 'checkout copy must match spec');
  assert.ok(src.includes('Simpan & Lanjutkan Pesanan'), 'checkout CTA copy must match spec');
});

test('CPC-05: Phone sheet saves via PATCH /customer/profile/phone', () => {
  const src = checkoutJs();
  assert.ok(src.includes("API.patch('/customer/profile/phone'"), 'sheet must PATCH /customer/profile/phone');
  assert.ok(src.includes('window.Xentra.Checkout = {'), 'Checkout export block must exist');
  const exportIdx = src.indexOf('window.Xentra.Checkout = {');
  const exportBlock = src.substring(exportIdx, exportIdx + 600);
  assert.ok(exportBlock.includes('openPhoneCompletionSheet'), 'sheet must be exposed for Profile reuse');
});

test('CPC-06: Submit path gates on phone before creating an order', () => {
  const src = checkoutJs();
  // The submit gate retries executePrePaymentAndSubmit after save (mount gates
  // do not). Find the gate occurrence inside the submit path.
  const submitFnIdx = src.indexOf('function executePrePaymentAndSubmit');
  assert.ok(submitFnIdx !== -1, 'executePrePaymentAndSubmit must exist');
  const submitBody = src.substring(submitFnIdx, submitFnIdx + 6000);
  const gateIdx = submitBody.indexOf('if (!hasValidCustomerPhone())');
  assert.ok(gateIdx !== -1, 'submit must gate on hasValidCustomerPhone()');
  const gateBlock = submitBody.substring(gateIdx, gateIdx + 500);
  assert.ok(gateBlock.includes('openPhoneStep'), 'phoneless submit must open the phone step (via openPhoneStep)');
  assert.ok(gateBlock.includes('executePrePaymentAndSubmit'), 'submit must retry after phone save');
  // Gate sits before branch resolution — recipient/phone never rematch branch.
  const branchIdx = submitBody.indexOf('var fulBranch = getFulfillmentBranch();', gateIdx);
  assert.ok(branchIdx !== -1 && branchIdx < gateIdx + 800, 'phone gate must precede branch resolution');
});

test('CPC-07: Google-auth return paths route phoneless customers to Phone Completion', () => {
  const src = checkoutJs();
  const occurrences = src.split('openPhoneStep({ mode:').length - 1;
  assert.ok(occurrences >= 3, `expected >=3 phone-step entry points (mount/submit/subscriber), found ${occurrences}`);
  // Payment context still persisted across the broker redirect.
  assert.ok(src.includes('xnt_pending_checkout_payment'), 'payment state preservation must remain');
  assert.ok(src.includes('xnt_auth_auto_retry_checkout'), 'auth auto-retry flag must remain');
});

test('CPC-08: SELF recipient display resolves phone from Customer Profile', () => {
  const src = checkoutJs();
  const fnIdx = src.indexOf('function _recipientSummaryHtml');
  assert.ok(fnIdx !== -1, '_recipientSummaryHtml must exist');
  const fnBlock = src.substring(fnIdx, fnIdx + 800);
  assert.ok(fnBlock.includes('state.customer.phone'), 'SELF display must fall back to Customer Profile phone');
  assert.ok(fnBlock.includes('Dikirim kepada'), 'recipient summary copy must remain');
});

test('CPC-09: OTHER recipient still requires name + valid phone (no OTP/account)', () => {
  const src = checkoutJs();
  assert.ok(src.includes("type === 'other'"), 'OTHER recipient type must be supported');
  assert.ok(src.includes('Nama penerima wajib') || src.includes("if (!name)"), 'OTHER name must be required');
  assert.ok(src.includes('Nomor WhatsApp/telepon penerima tidak valid.'), 'OTHER phone validation must remain');
  // Recipient snapshot still sent to the order endpoint, separate from notes/addresses.
  assert.ok(src.includes("recipient: isRecipientSelf()"), 'order payload must carry recipient snapshot');
});

test('CPC-10: Profile UI has WhatsApp row reusing the shared sheet', () => {
  const src = auxPages();
  assert.ok(src.includes('Nomor WhatsApp'), 'profile must show Nomor WhatsApp section');
  assert.ok(src.includes('Belum ditambahkan'), 'profile must show empty state');
  assert.ok(src.includes('Tambahkan nomor'), 'profile must show add CTA');
  assert.ok(src.includes('Ubah'), 'profile must show edit CTA');
  assert.ok(src.includes('/customer/profile'), 'profile must load authoritative phone');
  assert.ok(src.includes('openPhoneCompletionSheet'), 'profile must reuse the shared Bottom Sheet');
  assert.ok(!src.includes('x-profile-page-new') && !src.includes('new-profile-system'), 'must not create a new profile system');
});

test('CPC-11: API client supports PATCH', () => {
  const src = apiClient();
  assert.ok(src.includes('PATCH'), 'API client must support PATCH method');
  assert.ok(src.includes('patch: patch') || src.includes('patch,'), 'patch must be exported');
});

test('CPC-12: Checkout state preservation across Google auth still intact', () => {
  const src = checkoutJs();
  assert.ok(src.includes('Store.setRecipient(state.recipient)'), 'recipient must persist for auth round-trip');
  assert.ok(src.includes('Store.getRecipient()'), 'recipient must restore after auth round-trip');
  assert.ok(src.includes('activeDestination') || src.includes('storeState.location'), 'address must restore');
  assert.ok(src.includes('cashTendered'), 'COD cash amount preservation must remain');
});

// ── Recipient input moved to the Tambah/Detail alamat sheet (locked 2026-09-21 revision) ──

test('CPC-13: Checkout picks up recipient input entered in the Detail alamat sheet', () => {
  const src = checkoutJs();
  // The Store subscriber must react to recipient mutations, otherwise an input
  // saved in the address sheet would never reach the order payload.
  assert.ok(src.includes("mt !== 'recipient'"), 'checkout subscriber must accept recipient mutations');
  assert.ok(
    src.includes("state.recipient = Store.getRecipient() || { type: 'self', name: '', phone: '' }"),
    'checkout must sync state.recipient from the Store on recipient mutations'
  );
  // Empty recipient fields → SELF → server resolves name/phone from the profile.
  assert.ok(src.includes("isRecipientSelf() ? { type: 'self' }"), 'order payload must send SELF when no recipient input');
});

test('CPC-14: Checkout "Dikirim kepada" row is hidden (not deleted) and recipient is transaction-scoped', () => {
  const src = checkoutJs();
  // Row must no longer be rendered…
  assert.ok(!src.includes('id="x-btn-change-recipient"'), 'the rendered "Dikirim kepada" row must be hidden');
  // …but the recipient editor code stays available for reference/reuse.
  assert.ok(src.includes('function openRecipientSheet'), 'openRecipientSheet must be kept');
  assert.ok(src.includes('function _recipientSummaryHtml'), '_recipientSummaryHtml must be kept');
  // A previous order's recipient must never silently apply to the next order.
  assert.ok(src.includes('Store.clearRecipient()'), 'recipient must be cleared after a successful order');
});
