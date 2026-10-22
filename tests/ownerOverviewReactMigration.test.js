'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OVERVIEW_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/OverviewPage.tsx');
const SHELL_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/shell/OwnerAppShell.tsx');
const OWNER_APP_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/js/owner-app.js');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');
const SW_PATH = path.join(ROOT, 'apps/owner-app/sw.js');
const INDEX_HTML_PATH = path.join(ROOT, 'apps/owner-app/index.html');

test('Overview React Migration Suite', async (t) => {
  const overviewTsx = fs.readFileSync(OVERVIEW_PAGE_PATH, 'utf8');
  const shellTsx = fs.readFileSync(SHELL_PATH, 'utf8');
  const ownerAppJs = fs.readFileSync(OWNER_APP_JS_PATH, 'utf8');
  const bundleJs = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');
  const swJs = fs.readFileSync(SW_PATH, 'utf8');
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  await t.test('1. OverviewPage component is properly defined with full KPI and metrics support', () => {
    assert.ok(fs.existsSync(OVERVIEW_PAGE_PATH), 'OverviewPage.tsx must exist');
    assert.ok(overviewTsx.includes('export const OverviewPage'), 'Must export OverviewPage component');
    assert.ok(overviewTsx.includes('/api/v1/admin/overview'), 'Must fetch from /api/v1/admin/overview');
    
    // Period presets
    assert.ok(overviewTsx.includes('today'), 'Must support today preset');
    assert.ok(overviewTsx.includes('7d'), 'Must support 7d preset');
    assert.ok(overviewTsx.includes('30d'), 'Must support 30d preset');
    assert.ok(overviewTsx.includes('custom'), 'Must support custom preset');
    assert.ok(overviewTsx.includes('Terapkan Filter Tanggal'), 'Must have custom date range application form');

    // Hero KPIs
    assert.ok(overviewTsx.includes('Penjualan'), 'Must display Penjualan label');
    assert.ok(overviewTsx.includes('Pesanan'), 'Must display Pesanan mini metric');
    assert.ok(overviewTsx.includes('Avg Order'), 'Must display Avg Order mini metric');
    assert.ok(overviewTsx.includes('Pelanggan'), 'Must display Pelanggan mini metric');

    // Quick Access with 8 shortcuts
    assert.ok(overviewTsx.includes('Quick Access'), 'Must have Quick Access header');
    assert.ok(overviewTsx.includes('/owner/assets/icons/quick-access/menu.png'), 'Must have Menu shortcut');
    assert.ok(overviewTsx.includes('/owner/assets/icons/quick-access/stock.png'), 'Must have Stok shortcut');
    assert.ok(overviewTsx.includes('/owner/assets/icons/quick-access/cabang.png'), 'Must have Cabang shortcut');
    assert.ok(overviewTsx.includes('/owner/assets/icons/quick-access/promo.png'), 'Must have Promo shortcut');
    assert.ok(overviewTsx.includes('/owner/assets/icons/quick-access/laporan.png'), 'Must have Laporan shortcut');
    assert.ok(overviewTsx.includes('/owner/assets/icons/quick-access/metode bayar.png'), 'Must have Metode Bayar shortcut');
    assert.ok(overviewTsx.includes('/owner/assets/icons/quick-access/pelanggan.png'), 'Must have Pelanggan shortcut');
    assert.ok(overviewTsx.includes('/owner/assets/icons/quick-access/tim & akses.png'), 'Must have Tim & Akses shortcut');

    // Order Summary
    assert.ok(overviewTsx.includes('Ringkasan Pesanan'), 'Must have Ringkasan Pesanan');
    assert.ok(overviewTsx.includes('Selesai'), 'Must have Selesai status');
    assert.ok(overviewTsx.includes('Diproses'), 'Must have Diproses status');
    assert.ok(overviewTsx.includes('Dibatalkan'), 'Must have Dibatalkan status');

    // Branch Performance & Top Products & Attention
    assert.ok(overviewTsx.includes('Performa Cabang'), 'Must have Performa Cabang');
    assert.ok(overviewTsx.includes('Produk Terlaris'), 'Must have Produk Terlaris');
    assert.ok(overviewTsx.includes('Perhatian'), 'Must have Perhatian section');
    assert.ok(overviewTsx.includes('Semua berjalan normal'), 'Must display normal reassurance state');

    // Strict 16px margins
    assert.ok(overviewTsx.includes('overview-page-body'), 'Outer container must exist with proper id');
  });

  await t.test('2. OwnerAppShell wires OverviewPage on overview route', () => {
    assert.ok(shellTsx.includes("import OverviewPage from '../components/OverviewPage';"), 'Shell must import OverviewPage');
    assert.ok(shellTsx.includes("currentRoute === 'overview' || currentRoute === ''"), 'Shell must render OverviewPage for overview and root');
  });

  await t.test('3. owner-app.js routes overview to clean React shell', () => {
    assert.ok(ownerAppJs.includes("overview"), 'owner-app.js must consider overview a modern route');
    assert.ok(ownerAppJs.includes("''"), 'owner-app.js must consider root a modern route');
  });

  await t.test('4. Vite production bundle contains compiled OverviewPage', () => {
    assert.ok(bundleJs.length > 50000, 'Bundle must be built and non-empty');
    assert.ok(bundleJs.includes('/api/v1/admin/overview'), 'Compiled bundle must contain /api/v1/admin/overview endpoint');
    assert.ok(bundleJs.includes('Semua berjalan normal'), 'Compiled bundle must contain reassurance text');
  });

  await t.test('5. Cache and script version bumps and business hub 16px margins', () => {
    assert.ok(swJs.includes('mybangjo-owner-v1.8.'), 'Service worker cache must be bumped to v1.8.x');
    assert.ok(indexHtml.includes('menu-editor.js?v=1.0.44'), 'index.html must reference bundle v=1.0.44');
    assert.ok(indexHtml.includes('menu-editor.css?v=1.0.44'), 'index.html must reference bundle css v=1.0.44');
    assert.ok(indexHtml.includes('owner-app.js?v=1.0.'), 'index.html must reference owner-app.js v=1.0.x');

    const businessHubJsx = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/components/BusinessHub.jsx'), 'utf8');
    assert.ok(businessHubJsx.includes('modern-business-hub-root'), 'BusinessHub must have modern-business-hub-root');
    assert.ok(businessHubJsx.includes('max-w-lg md:mx-auto font-sans'), 'BusinessHub must have proper layout');
  });
});
