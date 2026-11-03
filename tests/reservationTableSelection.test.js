'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const { DiningTableService } = require('../domains/dining');
const OrderPlacementService = require('../domains/commerce/services/OrderPlacementService');

const ORG_ID = 'org_res_pick_table';
const BRAND_ID = 'brand_res_pick_table';
const BRANCH_A = 'branch_res_pick_table_a';
const BRANCH_B = 'branch_res_pick_table_b';
const TABLE_A1 = 'tbl_res_pick_table_a1';
const TABLE_A2 = 'tbl_res_pick_table_a2';
const TABLE_B1 = 'tbl_res_pick_table_b1';

function futureDate(days = 3) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seed() {
  db.prepare(`INSERT OR REPLACE INTO organizations (id, name, slug) VALUES (?, 'Org Res Pick Table', 'org-res-pick-table')`).run(ORG_ID);
  db.prepare(`INSERT OR REPLACE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Brand Res Pick Table', 'brand-res-pick-table')`).run(BRAND_ID, ORG_ID);
  db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Branch Res A', 'branch-res-a', 'Jl. Res A', -7.25, 112.75)`).run(BRANCH_A, BRAND_ID);
  db.prepare(`INSERT OR REPLACE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, 'Branch Res B', 'branch-res-b', 'Jl. Res B', -7.26, 112.76)`).run(BRANCH_B, BRAND_ID);

  for (const [id, branchId, number] of [
    [TABLE_A1, BRANCH_A, '1'],
    [TABLE_A2, BRANCH_A, '2'],
    [TABLE_B1, BRANCH_B, '99']
  ]) {
    db.prepare(`INSERT OR REPLACE INTO branch_tables (id, branch_id, table_number, label, capacity, is_active) VALUES (?, ?, ?, ?, 4, 1)`)
      .run(id, branchId, number, `Meja ${number}`);
    db.prepare(`INSERT OR REPLACE INTO branch_table_states (table_id, operational_state, current_session_id, notes) VALUES (?, 'available', NULL, NULL)`)
      .run(id);
  }
}

test.before(() => seed());

test.after(() => {
  for (const tableId of [TABLE_A1, TABLE_A2, TABLE_B1]) {
    db.prepare('DELETE FROM branch_table_states WHERE table_id = ?').run(tableId);
    db.prepare('DELETE FROM branch_tables WHERE id = ?').run(tableId);
  }
  db.prepare('DELETE FROM orders WHERE branch_id IN (?, ?)').run(BRANCH_A, BRANCH_B);
  db.prepare('DELETE FROM branches WHERE id IN (?, ?)').run(BRANCH_A, BRANCH_B);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND_ID);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG_ID);
});

test('Reservation table selection persistence and validation', async (t) => {
  await t.test('1. Reservation without table selection defaults to null table_number and UNASSIGNED selection_mode', () => {
    const res = DiningTableService.createReservation({
      brand_id: BRAND_ID,
      branch_id: BRANCH_A,
      customer: { name: 'Customer Without Table', phone: '08120000001' },
      reservation_date: futureDate(),
      reservation_time: '14:00',
      guest_count: 2,
      order_channel: 'customer_app'
    });

    assert.equal(res.success, true);
    assert.equal(res.order.table_number, null);

    const saved = db.prepare('SELECT id, table_number, selection_mode FROM orders WHERE id = ?').get(res.order_id);
    assert.ok(saved);
    assert.equal(saved.table_number, null);
    assert.equal(saved.selection_mode, 'UNASSIGNED');
  });

  await t.test('2. Reservation with table selection persists table_number and CUSTOMER_SELECTED', () => {
    const res = DiningTableService.createReservation({
      brand_id: BRAND_ID,
      branch_id: BRANCH_A,
      customer: { name: 'Customer With Table', phone: '08120000002' },
      reservation_date: futureDate(),
      reservation_time: '15:00',
      guest_count: 4,
      table_number: '2',
      table_id: TABLE_A2,
      order_channel: 'customer_app'
    });

    assert.equal(res.success, true);
    assert.equal(res.order.table_number, '2');

    const saved = db.prepare('SELECT id, table_number, selection_mode, order_note FROM orders WHERE id = ?').get(res.order_id);
    assert.ok(saved);
    assert.equal(saved.table_number, '2');
    assert.equal(saved.selection_mode, 'CUSTOMER_SELECTED');
    assert.match(saved.order_note, /Meja 2/);
  });

  await t.test('3. Reservation with invalid table outside branch returns TABLE_NOT_FOUND', () => {
    const res = DiningTableService.createReservation({
      brand_id: BRAND_ID,
      branch_id: BRANCH_A,
      customer: { name: 'Intruder Table', phone: '08120000003' },
      reservation_date: futureDate(),
      reservation_time: '16:00',
      guest_count: 2,
      table_number: '99',
      table_id: TABLE_B1, // belongs to BRANCH_B
      order_channel: 'customer_app'
    });
    assert.equal(res.success, false);
    assert.equal(res.status, 'TABLE_NOT_FOUND');
  });

  await t.test('4. OrderPlacementService routes table_number through to createReservation', async () => {
    const submitResult = await OrderPlacementService.submitOrder({
      branch_id: BRANCH_A,
      order_type: 'reservation',
      order_channel: 'customer_app',
      customer: { name: 'Commerce Order Placement', phone: '08120000004' },
      reservation_date: futureDate(),
      reservation_time: '17:00',
      guest_count: 3,
      table_number: '1',
      table_id: TABLE_A1,
      items: []
    });

    assert.equal(submitResult.success, true);
    assert.equal(submitResult.order.table_number, '1');

    const saved = db.prepare('SELECT id, table_number, selection_mode FROM orders WHERE id = ?').get(submitResult.order_id);
    assert.ok(saved);
    assert.equal(saved.table_number, '1');
    assert.equal(saved.selection_mode, 'CUSTOMER_SELECTED');
  });

  await t.test('5. Customer App checkout reservation flow: sheet confirm saves draft, shows Ringkasan reservasi card, and Reservasi sekarang CTA submits order', async () => {
    const fs = require('fs');
    const { JSDOM } = require('jsdom');

    const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="xentra-checkout-view"></div></body></html>`, {
      url: 'https://app.mybangjo.com/customer-pwa/',
      runScripts: 'dangerously'
    });
    const win = dom.window;
    win.requestAnimationFrame = (fn) => setTimeout(fn, 0);

    let orderSubmitted = false;
    let submittedPayload = null;
    const items = [{ id: 'm1', name: 'Ayam Bakar', price: 25000, quantity: 1 }];

    win.Xentra = {
      Store: {
        getState: () => ({
          cart: { items: items },
          orderType: 'delivery',
          customerSession: { token: 'xnt_cust_test', name: 'Budi', phone: '08123456789' },
          address: { formatted_address: 'Jl. Test' }
        }),
        getOrderType: () => 'delivery',
        setOrderType: () => {},
        setOrderContext: () => {},
        getCart: () => items,
        getCartItemsForBranch: () => items,
        subscribe: () => () => {},
        getMyTable: () => null,
        getRecipient: () => ({ type: 'self', name: '', phone: '' }),
        getAddress: () => ({ formatted_address: 'Jl. Test' }),
        getNote: () => ''
      },
      UI: {
        escape: (s) => s || '',
        formatNumber: (n) => 'Rp' + n,
        toast: () => {}
      },
      API: {
        get: async () => ({ success: true, branches: [{ id: 'b1', name: 'Cabang 1', is_reservation_active: 1 }] }),
        post: async (url, body) => {
          if (url === '/checkout/create-order') {
            orderSubmitted = true;
            submittedPayload = body;
            return { success: true, order_id: 'ord_1' };
          }
          if (url === '/checkout/verify') {
            return { success: true, is_valid: true };
          }
          return { success: true, match: true };
        }
      }
    };
    win.Store = win.Xentra.Store;
    win.UI = win.Xentra.UI;
    win.API = win.Xentra.API;

    win.eval(fs.readFileSync('/home/ubuntu/xentra-core/apps/customer-pwa/assets/js/core/fulfillment-environments.js', 'utf8'));
    win.eval(fs.readFileSync('/home/ubuntu/xentra-core/apps/customer-pwa/assets/js/pages/checkout.js', 'utf8'));

    win.Xentra.Checkout.mount(win.document.getElementById('xentra-checkout-view'));

    const chooseBtn = win.document.getElementById('x-btn-choose-fulfillment');
    assert.ok(chooseBtn, 'Choose fulfillment button exists');
    chooseBtn.click();

    const overlay = win.document.querySelector('.x-overlay');
    assert.ok(overlay, 'Overlay sheet opened');

    const resPill = overlay.querySelector(`[data-type="reservation"]`);
    assert.ok(resPill, 'Reservation pill exists');
    resPill.click();

    const sheetConfirm = overlay.querySelector('#x-ful-btn-confirm');
    assert.ok(sheetConfirm, 'Confirm button in sheet exists');
    assert.equal(sheetConfirm.textContent, 'Konfirmasi', 'Sheet button must say Konfirmasi');

    const resNameInput = overlay.querySelector('#x-res-name');
    const resPhoneInput = overlay.querySelector('#x-res-phone');
    assert.ok(resNameInput && resPhoneInput);

    resNameInput.value = 'Ahmad Dani';
    resNameInput.oninput();
    resPhoneInput.value = '081299998888';
    resPhoneInput.oninput();

    assert.equal(sheetConfirm.disabled, false);

    // Click Konfirmasi on sheet
    sheetConfirm.click();
    assert.equal(orderSubmitted, false, 'Clicking Konfirmasi on sheet must NOT auto-submit to database');

    // Verify main checkout screen has Ringkasan reservasi card
    const resSummaryCard = win.document.getElementById('x-reservation-summary-card');
    assert.ok(resSummaryCard, 'Ringkasan reservasi card must exist on checkout screen');
    assert.equal(resSummaryCard.querySelector('.x-alt-summary-title').textContent, 'Ringkasan reservasi');
    assert.ok(resSummaryCard.textContent.includes('Ahmad Dani'));
    assert.ok(resSummaryCard.textContent.includes('081299998888'));

    // Verify bottom sticky CTA
    const submitBtn = win.document.getElementById('x-btn-submit-order');
    assert.ok(submitBtn, 'Submit CTA button exists');
    assert.equal(submitBtn.textContent, 'Reservasi sekarang', 'CTA button must say Reservasi sekarang');

    // Click Reservasi sekarang
    submitBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(orderSubmitted, true, 'Clicking Reservasi sekarang triggers order placement');
    assert.equal(submittedPayload.order_type, 'reservation');
    assert.equal(submittedPayload.recipient.name, 'Ahmad Dani');
    assert.equal(submittedPayload.recipient.phone, '081299998888');
  });
});
