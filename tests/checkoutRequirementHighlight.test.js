'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const CHECKOUT_JS = fs.readFileSync(path.resolve(__dirname, '../apps/customer-pwa/assets/js/pages/checkout.js'), 'utf8');

function createJSDOMEnv(initialState) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="xentra-checkout-view"></div></body></html>', {
    url: 'https://app.mybangjo.com/customer-pwa/',
    runScripts: 'dangerously'
  });
  const win = dom.window;
  win.requestAnimationFrame = (fn) => setTimeout(fn, 0);

  const toasts = [];
  const scrolledElements = [];

  const items = initialState.items !== undefined ? initialState.items : [{ id: 'm1', name: 'Nasi Goreng', price: 25000, quantity: 1, branch_id: 'b1' }];
  const storeState = {
    cart: { items: items },
    orderType: initialState.orderType || 'takeaway',
    customerSession: { token: 'xnt_cust_test', name: 'Budi', phone: '08123456789' },
    address: initialState.address || { formatted_address: 'Jl. Pemuda No. 10' },
    activeDestination: initialState.activeDestination !== undefined ? initialState.activeDestination : { formatted_address: 'Jl. Pemuda No. 10' },
    location: initialState.location !== undefined ? initialState.location : { formatted_address: 'Jl. Pemuda No. 10' },
    matchedBranch: { id: 'b1', name: 'Cabang Utama' }
  };

  win.Xentra = {
    Store: {
      getState: () => storeState,
      getOrderType: () => storeState.orderType,
      setOrderType: (t) => { storeState.orderType = t; },
      setOrderContext: () => {},
      getCart: () => storeState.cart.items,
      getCartItemsForBranch: () => storeState.cart.items,
      subscribe: () => () => {},
      getMyTable: () => null,
      getRecipient: () => ({ type: 'self', name: '', phone: '' }),
      getAddress: () => storeState.address,
      getActiveDestination: () => storeState.activeDestination,
      getNote: () => ''
    },
    UI: {
      escape: (s) => s || '',
      formatNumber: (n) => String(n),
      money: (n) => 'Rp' + n,
      toast: (msg) => { toasts.push(msg); }
    },
    API: {
      get: async () => ({ success: true, branches: [{ id: 'b1', name: 'Cabang Utama', is_delivery_active: 1, is_reservation_active: 1 }] }),
      post: async () => ({ success: true, is_valid: true, eligible: true, delivery: { fee: 10000 } })
    }
  };

  // Mock scrollIntoView in JSDOM
  win.Element.prototype.scrollIntoView = function (opts) {
    scrolledElements.push({ id: this.id, opts: opts });
  };

  win.eval(CHECKOUT_JS);

  const view = win.document.getElementById('xentra-checkout-view');
  win.Xentra.Checkout.mount(view, {});

  return { win, dom, toasts, scrolledElements };
}

test('Requirement Validation: Missing payment method triggers toast, auto-scroll and highlight on x-payment-summary-card', async () => {
  const env = createJSDOMEnv({ orderType: 'takeaway' });
  const doc = env.win.document;

  const submitBtn = doc.getElementById('x-btn-submit-order');
  assert.ok(submitBtn, 'Submit button exists');
  submitBtn.click();

  assert.ok(env.toasts.includes('Silakan pilih metode pembayaran terlebih dahulu.'), 'Toast fired for missing payment method');

  const scrollAction = env.scrolledElements.find((s) => s.id === 'x-payment-summary-card');
  assert.ok(scrollAction, 'Auto-scrolled into x-payment-summary-card');
  assert.equal(scrollAction.opts.behavior, 'smooth');
  assert.equal(scrollAction.opts.block, 'center');

  const card = doc.getElementById('x-payment-summary-card');
  assert.ok(card.classList.contains('x-card-highlight'), 'x-card-highlight class added to x-payment-summary-card');
});

test('Requirement Validation: Missing delivery address triggers toast, auto-scroll and highlight on x-card-address', async () => {
  const env = createJSDOMEnv({
    orderType: 'delivery',
    activeDestination: { formatted_address: 'Pilih alamat pengiriman' }
  });
  const doc = env.win.document;

  const submitBtn = doc.getElementById('x-btn-submit-order');
  assert.ok(submitBtn, 'Submit button exists');
  submitBtn.click();

  assert.ok(env.toasts.includes('Silakan tentukan alamat pengiriman terlebih dahulu.'), 'Toast fired for missing address');

  const scrollAction = env.scrolledElements.find((s) => s.id === 'x-card-address');
  assert.ok(scrollAction, 'Auto-scrolled into x-card-address');
  assert.equal(scrollAction.opts.behavior, 'smooth');
  assert.equal(scrollAction.opts.block, 'center');

  const card = doc.getElementById('x-card-address');
  assert.ok(card.classList.contains('x-card-highlight'), 'x-card-highlight class added to x-card-address');
});

test('Requirement Validation: Missing reservation date triggers toast, auto-scroll and highlight on x-reservation-summary-card', async () => {
  const env = createJSDOMEnv({
    orderType: 'reservation',
    items: []
  });
  const doc = env.win.document;

  const submitBtn = doc.getElementById('x-btn-submit-order');
  assert.ok(submitBtn, 'Submit button exists');
  submitBtn.click();

  assert.ok(env.toasts.includes('Silakan pilih tanggal reservasi terlebih dahulu.'), 'Toast fired for missing reservation date');

  const scrollAction = env.scrolledElements.find((s) => s.id === 'x-reservation-summary-card');
  assert.ok(scrollAction, 'Auto-scrolled into x-reservation-summary-card');
  assert.equal(scrollAction.opts.behavior, 'smooth');
  assert.equal(scrollAction.opts.block, 'center');

  const card = doc.getElementById('x-reservation-summary-card');
  assert.ok(card.classList.contains('x-card-highlight'), 'x-card-highlight class added to x-reservation-summary-card');
});
