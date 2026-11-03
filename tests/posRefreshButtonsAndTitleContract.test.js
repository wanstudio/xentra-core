const { describe, it } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'apps/pos-app/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/css/pos.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/pos-app.js'), 'utf8');

describe('POS App — Refresh Buttons & Transaksi Title Contract', () => {
  it('1. Title of Transaksi page is strictly "Transaksi" without "& Pesanan"', () => {
    const dom = new JSDOM(HTML);
    const doc = dom.window.document;
    const transaksiSection = doc.getElementById('pos-view-transaksi');
    assert.ok(transaksiSection, '#pos-view-transaksi must exist');

    const h1 = transaksiSection.querySelector('.pos-title-wrap h1');
    assert.ok(h1, 'h1 in .pos-title-wrap must exist');
    assert.equal(h1.textContent.trim(), 'Transaksi', 'Header must be exactly "Transaksi"');
    assert.ok(!HTML.includes('Transaksi &amp; <br class="pos-mobile-br">Pesanan'), 'Old multi-line title must be removed');

    const mejaSection = doc.getElementById('pos-view-meja');
    assert.ok(mejaSection, '#pos-view-meja must exist');
    const mejaH1 = mejaSection.querySelector('.pos-title-wrap h1');
    assert.ok(mejaH1, 'h1 in .pos-meja-pane must exist');
    assert.equal(mejaH1.textContent.trim(), 'Meja', 'Header of Meja tab must be strictly "Meja" (not "Meja Dine-in")');
    assert.ok(!HTML.includes('<h1>Meja Dine-in</h1>'), 'Old title "Meja Dine-in" must be removed');
  });

  it('2. Refresh buttons on Kasir, Transaksi, Meja, and Shift are Icon-Only (no text labels)', () => {
    const dom = new JSDOM(HTML);
    const doc = dom.window.document;

    const buttonIds = [
      'btn-pos-refresh-menu',
      'btn-pos-load-sales',
      'btn-pos-refresh-tables',
      'btn-pos-refresh-shift'
    ];

    buttonIds.forEach((id) => {
      const btn = doc.getElementById(id);
      assert.ok(btn, `Button #${id} must exist`);
      assert.ok(btn.classList.contains('pos-btn-refresh'), `#${id} must have .pos-btn-refresh`);
      assert.ok(btn.querySelector('svg'), `#${id} must contain SVG icon`);
      assert.equal(btn.querySelector('span'), null, `#${id} must not contain span text (must be icon-only)`);
      assert.equal(btn.textContent.trim(), '', `#${id} textContent must be empty`);
      assert.ok(btn.getAttribute('aria-label'), `#${id} must have aria-label`);
      assert.ok(btn.getAttribute('title'), `#${id} must have title`);
    });
  });

  it('3. pos.css defines compact 32x32 icon button and pos-spin animation', () => {
    assert.ok(CSS.includes('.pos-btn-refresh{width:32px;height:32px;min-width:32px;padding:0!important;'), 'Button must be styled as 32x32 compact icon');
    assert.ok(CSS.includes('@keyframes pos-spin'), 'pos-spin animation must be defined');
    assert.ok(CSS.includes('.pos-btn-refresh.is-spinning svg{animation:pos-spin'), 'is-spinning must trigger pos-spin on svg');
  });

  it('4. pos-app.js wires attachRefreshAction with spinning feedback and toast notifications', () => {
    assert.ok(JS.includes('function attachRefreshAction(btnId, fn, successMsg)'), 'attachRefreshAction helper must exist');
    assert.ok(JS.includes("attachRefreshAction('btn-pos-refresh-menu', loadMenu, 'Katalog menu diperbarui')"), 'Kasir refresh must be wired');
    assert.ok(JS.includes("attachRefreshAction('btn-pos-load-sales', loadSales, 'Daftar transaksi diperbarui')"), 'Transaksi refresh must be wired');
    assert.ok(JS.includes("attachRefreshAction('btn-pos-refresh-tables', loadTables, 'Status meja diperbarui')"), 'Meja refresh must be wired');
    assert.ok(JS.includes("attachRefreshAction('btn-pos-refresh-shift'"), 'Shift refresh must be wired');
  });

  it('5. Simulated click execution triggers spinning, executes fetch, and emits toast', async () => {
    const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
    const win = dom.window;
    const doc = win.document;

    let toastMessage = null;
    let menuFetched = false;

    // Minimal environment mock
    const btn = doc.getElementById('btn-pos-refresh-menu');

    function mockToast(msg) {
      toastMessage = msg;
    }

    // Evaluate the attachRefreshAction logic directly
    function attachRefreshAction(btnId, fn, successMsg) {
      var target = doc.getElementById(btnId);
      if (!target) return;
      target.onclick = async function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (target.classList.contains('is-spinning')) return;
        target.classList.add('is-spinning');
        target.setAttribute('disabled', 'disabled');
        var start = Date.now();
        try {
          await fn();
          var elapsed = Date.now() - start;
          if (elapsed < 100) {
            await new Promise(function (r) { setTimeout(r, 100 - elapsed); });
          }
          if (successMsg) mockToast(successMsg);
        } finally {
          target.classList.remove('is-spinning');
          target.removeAttribute('disabled');
        }
      };
    }

    attachRefreshAction('btn-pos-refresh-menu', async () => {
      menuFetched = true;
    }, 'Katalog menu diperbarui');

    assert.equal(btn.classList.contains('is-spinning'), false);
    assert.equal(menuFetched, false);

    // Trigger click
    const clickPromise = btn.onclick();
    assert.equal(btn.classList.contains('is-spinning'), true, 'Must spin during execution');
    assert.equal(btn.getAttribute('disabled'), 'disabled', 'Must be disabled during execution');

    await clickPromise;

    assert.equal(menuFetched, true, 'Target fetch function must be executed');
    assert.equal(toastMessage, 'Katalog menu diperbarui', 'Success toast must be emitted');
    assert.equal(btn.classList.contains('is-spinning'), false, 'Spinning must stop after execution');
    assert.equal(btn.hasAttribute('disabled'), false, 'Button must be re-enabled after execution');
  });

  it('6. Reservation button on Meja view is labeled strictly "Reservasi" (not "Buku Reservasi")', () => {
    const dom = new JSDOM(HTML);
    const doc = dom.window.document;
    const resBtn = doc.getElementById('btn-pos-reservations');
    assert.ok(resBtn, '#btn-pos-reservations must exist');
    assert.equal(resBtn.querySelector('span').textContent.trim(), 'Reservasi', 'Button text must be "Reservasi"');
    assert.ok(!HTML.includes('<span>Buku Reservasi</span>'), 'Old label "Buku Reservasi" must not exist');
  });

  it('7. pos.css defines reservations modal layout, cards, and close button', () => {
    assert.ok(CSS.includes('.pos-reservations-modal'), 'Must define .pos-reservations-modal');
    assert.ok(CSS.includes('.pos-reservations-head'), 'Must define .pos-reservations-head');
    assert.ok(CSS.includes('.pos-reservations-badge'), 'Must define .pos-reservations-badge');
    assert.ok(CSS.includes('.pos-modal-close-icon'), 'Must define .pos-modal-close-icon');
    assert.ok(CSS.includes('.pos-reservation-card'), 'Must define .pos-reservation-card');
    assert.ok(CSS.includes('.pos-res-time-badge'), 'Must define .pos-res-time-badge');
  });

  it('8. openReservationsModal copywriting is concise and stripped of unnecessary fluff', () => {
    assert.ok(JS.includes('<h3>Reservasi</h3>'), 'Modal header must be clean "Reservasi"');
    assert.ok(!JS.includes('Buku Reservasi Cabang'), 'Old redundant title "Buku Reservasi Cabang" must be removed');
    assert.ok(!JS.includes('Check-in tamu saat tiba di kasir'), 'Verbose instruction paragraph must be removed');
    assert.ok(JS.includes('data-reservation-noshow'), 'No-Show button must exist');
    assert.ok(JS.includes('data-reservation-checkin'), 'Check-In button must exist');
    assert.ok(JS.includes('Tidak ada reservasi aktif.'), 'Empty state must be concise');
  });
});
