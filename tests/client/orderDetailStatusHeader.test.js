/**
 * Customer Order Detail Status Header — targeted verification.
 *
 * ODH-01  newly created delivery (pending) → MENUNGGU DITERIMA, step 1 done
 * ODH-02  preparing delivery → SEDANG DISIAPKAN, steps 1-2 done
 * ODH-03  delivering delivery → SEDANG DIANTAR, steps 1-4 done
 * ODH-04  completed delivery → SELESAI DIANTAR, all done
 * ODH-05  newly created pickup (pending) → MENUNGGU DITERIMA
 * ODH-06  preparing pickup → SEDANG DISIAPKAN
 * ODH-07  ready pickup → SIAP DIAMBIL, steps 1-3 done
 * ODH-08  completed pickup → SUDAH DIAMBIL
 * ODH-09  confirmed → PESANAN DITERIMA (existing lifecycle)
 * ODH-10  delivery never shows "Siap diambil"; pickup never shows "Sedang diantar"
 * ODH-11  title + progress come from ONE source (resolveOrderPhase)
 * ODH-12  forbidden terms absent from tracking layout
 * ODH-13  section order: title → progress → route → recipient → items → payment → note → cancel
 * ODH-14  refresh fetches from server; polling re-renders on status change
 * ODH-15  backend DTO exposes recipient snapshot (no schema/state change)
 * ODH-16  fmtDistance formats ID locale (m / km with comma)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'apps/customer-pwa/assets/js/pages/order-received.js'), 'utf8');
const apiSrc = fs.readFileSync(path.join(ROOT, 'server/routes/customer-orders.js'), 'utf8');

// The resolver now projects through the shared Fulfillment Environment contract.
// Load that browser-global module before extracting the resolver below.
globalThis.window = globalThis;
require(path.join(ROOT, 'apps/customer-pwa/assets/js/core/fulfillment-environments.js'));

// Extract the self-contained phase resolver + distance formatter and eval them.
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start !== -1, name + ' must be defined');
  // Function ends at the first "\n  }" following the start (2-space module indent).
  const end = src.indexOf('\n  }', start);
  assert.ok(end !== -1, name + ' body must terminate');
  const code = src.substring(start, end + 4) + '\nmodule.exports = ' + name + ';';
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  return mod.exports;
}

const resolveOrderPhase = extractFn('resolveOrderPhase');
const fmtDistance = extractFn('fmtDistance');

test('ODH-01: newly created delivery (pending) → MENUNGGU DITERIMA', () => {
  const ph = resolveOrderPhase('pending', 'delivery');
  assert.equal(ph.title, 'MENUNGGU DITERIMA');
  assert.equal(ph.doneCount, 1);
  assert.deepEqual(ph.steps, ['Pesanan diterima', 'Sedang disiapkan', 'Siap diantar', 'Sedang diantar', 'Selesai diantar']);
});

test('ODH-02: preparing delivery → SEDANG DISIAPKAN', () => {
  const ph = resolveOrderPhase('preparing', 'delivery');
  assert.equal(ph.title, 'SEDANG DISIAPKAN');
  assert.equal(ph.doneCount, 2);
});

test('ODH-03: delivering delivery → SEDANG DIANTAR', () => {
  const ph = resolveOrderPhase('out_for_delivery', 'delivery');
  assert.equal(ph.title, 'SEDANG DIANTAR');
  assert.equal(ph.doneCount, 4);
});

test('ODH-04: completed delivery → PESANAN SELESAI', () => {
  const ph = resolveOrderPhase('completed', 'delivery');
  assert.equal(ph.title, 'SELESAI DIANTAR');
  assert.equal(ph.doneCount, 5);
});

test('ODH-05: newly created pickup (pending) → MENUNGGU DITERIMA', () => {
  const ph = resolveOrderPhase('pending', 'pickup');
  assert.equal(ph.title, 'MENUNGGU DITERIMA');
  assert.equal(ph.doneCount, 1);
  assert.deepEqual(ph.steps, ['Pesanan diterima', 'Sedang disiapkan', 'Siap diambil', 'Sudah diambil']);
});

test('ODH-06: preparing pickup → SEDANG DISIAPKAN', () => {
  const ph = resolveOrderPhase('preparing', 'pickup');
  assert.equal(ph.title, 'SEDANG DISIAPKAN');
  assert.equal(ph.doneCount, 2);
});

test('ODH-07: ready pickup → SIAP DIAMBIL', () => {
  const ph = resolveOrderPhase('ready', 'pickup');
  assert.equal(ph.title, 'SIAP DIAMBIL');
  assert.equal(ph.doneCount, 3);
});

test('ODH-08: completed pickup → PESANAN SELESAI', () => {
  const ph = resolveOrderPhase('completed', 'pickup');
  assert.equal(ph.title, 'SUDAH DIAMBIL');
  assert.equal(ph.doneCount, 4);
});

test('ODH-09: confirmed → PESANAN DITERIMA (existing lifecycle, no new status)', () => {
  for (const t of ['delivery', 'pickup']) {
    const ph = resolveOrderPhase('confirmed', t);
    assert.equal(ph.title, 'PESANAN DITERIMA');
    assert.equal(ph.doneCount, 1);
  }
  const rdy = resolveOrderPhase('ready', 'delivery');
  assert.equal(rdy.title, 'SIAP DIANTAR');
  assert.equal(rdy.doneCount, 3);
});

test('ODH-10: delivery never shows pickup labels and vice versa', () => {
  for (const s of ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed']) {
    const d = resolveOrderPhase(s, 'delivery');
    assert.ok(!d.title.includes('DIAMBIL') && !d.steps.join('|').toLowerCase().includes('diambil'), `delivery ${s} must not mention diambil`);
    const p = resolveOrderPhase(s, 'pickup');
    assert.ok(!p.title.includes('DIANTAR') && !p.steps.join('|').includes('Sedang diantar'), `pickup ${s} must not mention Sedang diantar`);
  }
});

test('ODH-10b: delivery primary phases remain stable while delivery substate changes', () => {
  assert.equal(resolveOrderPhase('pending', 'delivery').steps.length, 5);
  assert.equal(resolveOrderPhase('ready', 'delivery').steps[2], 'Siap diantar');
  assert.equal(resolveOrderPhase('out_for_delivery', 'delivery').steps[3], 'Sedang diantar');
});

test('ODH-10c: recipient falls back to buyer identity, never a bare Saya', () => {
  const idx = src.indexOf('function renderTrackingOrder');
  const body = src.substring(idx, idx + 6000);
  assert.ok(body.includes('order.recipient_name || order.customer_name'), 'recipient name must prefer snapshot, fallback buyer');
  assert.ok(body.includes('order.recipient_phone || order.customer_phone'), 'recipient phone must prefer snapshot, fallback buyer');
  assert.ok(body.includes('customerSession'), 'owner session must be the final fallback (owner-only view)');
  assert.ok(!body.includes("'Saya'"), 'tracking layout must never render a bare Saya');
  assert.ok(!body.includes('maskPhone'), 'recipient phone must be shown as-is, never masked');
});

test('ODH-11: title + progress come from ONE source', () => {
  const idx = src.indexOf('function renderTrackingOrder');
  assert.ok(idx !== -1, 'renderTrackingOrder must exist');
  const body = src.substring(idx, idx + 12000);
  assert.ok(body.includes('resolveOrderPhase(status, orderType)'), 'must resolve phase once from status+type');
  assert.ok(body.includes('phase.title'), 'title must come from the resolved phase');
  assert.ok(body.includes('renderPhaseProgress(phase)'), 'progress must come from the same resolved phase');
});

test('ODH-12: forbidden terms absent from tracking layout', () => {
  const idx = src.indexOf('function renderTrackingOrder');
  const endIdx = src.indexOf('// ─── P7.1 AWAITING', idx);
  const body = src.substring(idx, endIdx !== -1 ? endIdx : idx + 12000);
  for (const term of ['Menunggu Konfirmasi', 'MENUNGGU KONFIRMASI', 'acceptance-countdown', 'Batas waktu konfirmasi',
    'Detail Pengantaran', 'DETAIL PENGANTARAN', 'Alamat Pengantaran', 'menunggu cabang', 'Yang Terjadi Selanjutnya']) {
    assert.ok(!body.includes(term), `tracking layout must not contain "${term}"`);
  }
});

test('ODH-13: section order is header → progress → route → recipient → items → payment → note → cancel', () => {
  const idx = src.indexOf('function renderTrackingOrder');
  const body = src.substring(idx, idx + 12000);
  // Order is determined by the final HTML assembly, not by helper-string
  // construction order above it.
  const asmIdx = body.indexOf('targetContainer.innerHTML =');
  assert.ok(asmIdx !== -1, 'tracking layout must assemble innerHTML');
  const asm = body.substring(asmIdx, asmIdx + 8000);
  const markers = ['x-order-phase-title', 'renderPhaseProgress(phase)', 'routeHtml',
    'DIKIRIM KEPADA', 'itemsHtml',
    'DETAIL PEMBAYARAN', 'CATATAN PENGANTARAN', 'x-btn-cancel-order'];
  let lastPos = -1;
  for (const m of markers) {
    const pos = asm.indexOf(m);
    assert.ok(pos !== -1, `tracking layout must contain "${m}"`);
    assert.ok(pos > lastPos, `"${m}" must appear after the previous section`);
    lastPos = pos;
  }
  // Route/location block has no heading of its own.
  assert.ok(!asm.includes('Detail Pengantaran'), 'route block must not carry a heading');
});

test('ODH-14: refresh fetches from server; polling re-renders on status change', () => {
  // mount() → renderLoading + loadOrder (server fetch, never local state).
  const mountIdx = src.indexOf('function mount(');
  const mountBody = src.substring(mountIdx, mountIdx + 800);
  assert.ok(mountBody.includes('loadOrder('), 'mount must fetch order from server (refresh-safe)');
  // schedulePolling → renderOrder on status change → title+progress update live.
  const pollIdx = src.indexOf('function schedulePolling(');
  const pollBody = src.substring(pollIdx, pollIdx + 1500);
  assert.ok(pollBody.includes('renderOrder(data)'), 'polling must re-render on status change');
});

test('ODH-15: backend DTO exposes recipient snapshot', () => {
  const getIdx = apiSrc.indexOf("router.get('/orders/:id'");
  assert.ok(getIdx !== -1, 'GET /orders/:id must exist');
  const block = apiSrc.substring(getIdx, getIdx + 12000);
  assert.ok(block.includes('recipient_type'), 'DTO must expose recipient_type');
  assert.ok(block.includes('recipient_name'), 'DTO must expose recipient_name');
  assert.ok(block.includes('recipient_phone'), 'DTO must expose recipient_phone');
  // No state-machine or schema change for this UI task.
  assert.ok(!block.includes('ADD COLUMN recipient'), 'no schema migration in this change');
});

test('ODH-16: fmtDistance formats ID locale', () => {
  assert.equal(fmtDistance(0), '');
  assert.equal(fmtDistance(800), '800 m');
  assert.equal(fmtDistance(1500), '1,5 km');
});

test('ODH-17: cancelled screen is informative with reorder CTAs, no order code', () => {
  const idx = src.indexOf('function renderCancelled(order, items)');
  assert.ok(idx !== -1, 'renderCancelled must receive items');
  const endIdx = src.indexOf('// ─── P7.5 ACCEPTED', idx);
  const body = src.substring(idx, endIdx !== -1 ? endIdx : idx + 6000);
  assert.ok(body.includes('Pesanan Dibatalkan'), 'must keep the cancelled title');
  assert.ok(body.includes('Pesan Ini Lagi'), 'must offer Pesan Ini Lagi CTA');
  assert.ok(body.includes('Pesan Menu Baru'), 'must offer Pesan Menu Baru CTA');
  assert.ok(body.includes('PESANAN YANG DIBATALKAN'), 'must show what was cancelled');
  assert.ok(!body.includes('order_number'), 'order code must not be shown to consumers');
  assert.ok(body.includes("Router.navigate('checkout'"), 'reorder must go branch-scoped to checkout');
  assert.ok(body.includes("indexOf('reward_')"), 'promo reward lines must not be copied straight into the cart');
});
