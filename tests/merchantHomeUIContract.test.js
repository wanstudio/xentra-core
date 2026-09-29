const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const HTML = read('apps/merchant-app/index.html');
const HOME_CSS = read('apps/merchant-app/assets/css/home.css');
const HOME_JS = read('apps/merchant-app/assets/js/home.js');
const HARI_INI = read('apps/merchant-app/assets/js/hari-ini.js');
const SW = read('apps/merchant-app/sw.js');

function homeSection() {
  const start = HTML.indexOf('<section id="tab-hari-ini"');
  const end = HTML.indexOf('<!-- BM-2: Pesanan & Meja Operational Surfaces -->', start);
  assert.ok(start >= 0, 'Home section must exist');
  assert.ok(end > start, 'Home section boundary must exist');
  return HTML.slice(start, end);
}

test('MERCHANT-HOME-01: Home uses the locked native composition order', () => {
  const home = homeSection();
  const sequence = [
    'x-home-greeting',
    'Penjualan Hari Ini',
    'Pesanan Baru',
    'Aksi Cepat',
    'Operasional Hari Ini',
    'Perlu Perhatian',
    'Promo Aktif',
    'Aktivitas Terakhir'
  ];

  let cursor = -1;
  for (const marker of sequence) {
    const idx = home.indexOf(marker);
    assert.ok(idx > cursor, `Home marker is out of order: ${marker}`);
    cursor = idx;
  }

  assert.ok(!/<table\b/i.test(home), 'Home must not use a desktop table as the primary mobile pattern');
  assert.ok(!home.includes('bm-tbody-pending-orders'), 'Legacy pending-order table id must not remain');
  assert.ok(!home.includes('bm-hero-branch-name'), 'Legacy Home hero id must not remain');
});

test('MERCHANT-HOME-02: Home has explicit operational and attention anchors', () => {
  const home = homeSection();
  for (const id of [
    'bm-home-branch-name',
    'bm-home-status-dot',
    'bm-home-status-badge',
    'bm-home-online-badge',
    'bm-home-date',
    'btn-bm-toggle-open',
    'btn-bm-toggle-online-orders',
    'bm-stat-net-sales-today',
    'bm-stat-average-order',
    'bm-pending-orders-list',
    'bm-badge-pending-count',
    'bm-stat-pending-orders',
    'bm-stat-active-orders',
    'bm-stat-ready-orders',
    'bm-stat-completed-orders',
    'bm-menu-attention-summary',
    'bm-stock-attention-summary',
    'bm-active-promos-container',
    'bm-recent-activity-container'
  ]) {
    assert.ok(home.includes(`id="${id}"`), `Missing Home anchor: ${id}`);
  }
});

test('MERCHANT-HOME-03: Merchant Home shell assets are render-blocking and PWA-cached', () => {
  assert.ok(HTML.includes('/merchant-app/assets/css/home.css?v=1.0.0'), 'Home CSS must be loaded');
  assert.ok(HTML.includes('/merchant-app/assets/js/home.js?v=1.0.0'), 'Home JS must be loaded');
  assert.ok(SW.includes('/merchant-app/assets/css/home.css?v=1.0.0'), 'Home CSS must be precached');
  assert.ok(SW.includes('/merchant-app/assets/js/home.js?v=1.0.0'), 'Home JS must be precached');
});

test('MERCHANT-HOME-04: Home presentation is isolated from backend authority', () => {
  assert.ok(!/fetch\s*\(/.test(HOME_JS), 'home.js must not create a parallel data-fetching path');
  assert.ok(HOME_JS.includes('merchant:home-ready'), 'Home presentation should hydrate after operational data is ready');
  assert.ok(HARI_INI.includes('window.dispatchEvent(new CustomEvent("merchant:home-ready"))'),
    'Hari Ini module must signal Home presentation readiness');
});

test('MERCHANT-HOME-05: Mobile primary navigation remains locked to five Merchant jobs', () => {
  const home = HTML.slice(HTML.indexOf('id="x-merchant-mobile-nav"'));
  const labels = ['Beranda', 'Pesanan', 'Menu', 'Stock', 'Promo'];
  for (const label of labels) assert.ok(home.includes(`<span>${label}</span>`), `Missing nav label: ${label}`);
});
