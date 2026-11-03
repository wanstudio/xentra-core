'use strict';

/**
 * MERCHANT APP — LAYOUT & DESIGN SYSTEM CONTRACT TEST GUARD
 *
 * Enforces the Mobile Layout System Contract (docs/decisions/MOBILE_LAYOUT_SYSTEM_CONTRACT.md).
 * Ensures zero styling regressions, zero margin drift, and no rogue magic numbers across tabs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHARED_CSS_PATH = path.join(ROOT, 'apps/merchant-shared/css/shared.css');
const HOME_CSS_PATH = path.join(ROOT, 'apps/merchant-app/assets/css/home.css');
const HTML_PATH = path.join(ROOT, 'apps/merchant-app/index.html');
const JS_PATH = path.join(ROOT, 'apps/merchant-app/assets/js/merchant-app.js');

const SHARED_CSS = fs.readFileSync(SHARED_CSS_PATH, 'utf8');
const HOME_CSS = fs.readFileSync(HOME_CSS_PATH, 'utf8');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');
const JS = fs.readFileSync(JS_PATH, 'utf8');

test('MERCHANT LAYOUT CONTRACT — 1. Design Tokens Definition', () => {
  // Check shared.css tokens
  assert.ok(SHARED_CSS.includes('--m-gutter: 16px'), 'shared.css must define --m-gutter: 16px');
  assert.ok(SHARED_CSS.includes('--m-bottom-nav-h: 76px'), 'shared.css must define --m-bottom-nav-h: 76px');
  assert.ok(SHARED_CSS.includes('--m-bottom-spacer'), 'shared.css must define --m-bottom-spacer');
  assert.ok(SHARED_CSS.includes('--m-icon-size: 18px'), 'shared.css must define --m-icon-size: 18px');

  // Check home.css tokens
  assert.ok(HOME_CSS.includes('--m-gutter: 16px'), 'home.css must define --m-gutter: 16px');
  assert.ok(HOME_CSS.includes('--m-bottom-nav-h: 76px'), 'home.css must define --m-bottom-nav-h: 76px');
  assert.ok(HOME_CSS.includes('--m-bottom-spacer'), 'home.css must define --m-bottom-spacer');
  assert.ok(HOME_CSS.includes('--m-icon-size: 18px'), 'home.css must define --m-icon-size: 18px');
});

test('MERCHANT LAYOUT CONTRACT — 2. Gutter Consistency (16px Flush Margin Across All Tabs)', () => {
  // Topbar padding horizontal must use token / 16px
  assert.ok(
    /\.x-merchant-app\s+\.x-dash-topbar\s*\{[^}]*padding:[^;]*var\(--m-gutter,\s*16px\)/.test(HOME_CSS) ||
    /\.x-merchant-app\s+\.x-dash-topbar\s*\{[^}]*16px/.test(HOME_CSS),
    'x-dash-topbar must enforce 16px horizontal gutter'
  );

  // Tab content active padding horizontal must use token / 16px
  assert.ok(
    /\.x-merchant-app\s+\.x-tab-content\.active\s*\{[^}]*var\(--m-gutter,\s*16px\)/.test(HOME_CSS) ||
    /\.x-merchant-app\s+\.x-tab-content\.active\s*\{[^}]*16px\s+0/.test(HOME_CSS),
    'x-tab-content.active must enforce 16px horizontal gutter'
  );

  // Beranda x-home-screen must use token / 16px
  assert.ok(
    /#tab-hari-ini\s+\.x-home-screen\s*\{[^}]*var\(--m-gutter,\s*16px\)/.test(HOME_CSS) ||
    /#tab-hari-ini\s+\.x-home-screen\s*\{[^}]*16px/.test(HOME_CSS),
    'tab-hari-ini x-home-screen must enforce 16px padding'
  );

  // Pesanan search/filter card must use token / 16px
  assert.ok(
    /\.bm-pesanan-filter-card\s*\{[^}]*var\(--m-gutter,\s*16px\)/.test(HOME_CSS) ||
    /\.bm-pesanan-filter-card\s*\{[^}]*16px\s+10px\s+16px/.test(HOME_CSS),
    'bm-pesanan-filter-card must enforce 16px horizontal margin'
  );

  // Subpage view must use token / 16px
  assert.ok(
    /is-subpage-view\s+\.x-tab-content\.active\s*\{[^}]*var\(--m-gutter,\s*16px\)/.test(HOME_CSS) ||
    /is-subpage-view\s+\.x-tab-content\.active\s*\{[^}]*16px\s+calc/.test(HOME_CSS),
    'subpage-view must enforce 16px horizontal gutter'
  );
});

test('MERCHANT LAYOUT CONTRACT — 3. Bottom Clearance & Anti-Double-Spacing Governance', () => {
  // ::after spacer must use --m-bottom-spacer
  assert.ok(
    /\.x-merchant-app\s+\.x-tab-content\.active::after\s*\{[^}]*var\(--m-bottom-spacer/.test(HOME_CSS) ||
    /\.x-merchant-app\s+\.x-tab-content\.active::after\s*\{[^}]*88px/.test(HOME_CSS),
    'active::after must use var(--m-bottom-spacer) or 88px baseline'
  );

  // Rogue 138px spacer must be eliminated
  assert.ok(!HOME_CSS.includes('138px'), 'Rogue 138px spacer must not exist in home.css');

  // Rogue 90px padding-bottom on tab-bm-pesanan must not exist
  assert.ok(
    !/#tab-bm-pesanan\s*\{[^}]*padding-bottom:\s*90px/.test(HOME_CSS),
    'tab-bm-pesanan must not have rogue padding-bottom: 90px'
  );
});

test('MERCHANT LAYOUT CONTRACT — 4. Crisp 18x18 Vector SVG Profile Icon from Official flowbite_user-solid.svg Asset', () => {
  // index.html must not use raster <image> inside profile button
  assert.ok(!HTML.includes('id="mobile-user-avatar"><svg viewBox="0 0 16 16"><image'),
    'Profile avatar must not be a 16px raster <image>');

  // Profile icon button in Beranda must contain crisp SVG matching official flowbite_user-solid.svg asset
  assert.ok(HTML.includes('id="mobile-user-profile"'), 'Beranda topbar must have mobile-user-profile');
  assert.ok(HTML.includes('id="pesanan-mobile-user-profile"'), 'Pesanan topbar must have pesanan-mobile-user-profile');
  assert.ok(HTML.includes('M8.5 0.166992'), 'User profile icon must use path from official flowbite_user-solid.svg asset');

  // home.css must style profile button svg with --m-icon-size or 18px
  assert.ok(
    /\.x-mobile-profile-btn\s+svg\s*\{[^}]*var\(--m-icon-size,\s*18px\)/.test(HOME_CSS) ||
    /\.x-mobile-profile-btn\s+svg\s*\{[^}]*width:\s*18px/.test(HOME_CSS),
    'mobile-profile-btn svg must be styled with 18px icon token'
  );
});

test('MERCHANT LAYOUT CONTRACT — 5. Bottom Navigation Bar Retention on Root Tab "Lainnya"', () => {
  // BM_SUBPAGE_ROUTES must not mark 'pengaturan' as subpage
  assert.ok(!JS.includes("'pengaturan': true"), 'pengaturan must not be marked true in BM_SUBPAGE_ROUTES');

  // home.css must hide subpage back button when settings is viewed as primary root tab
  assert.ok(
    HOME_CSS.includes('.x-merchant-app:not(.is-subpage-view) #tab-bm-settings .x-subpage-back-btn'),
    'home.css must hide back button on root tab-bm-settings'
  );
});

test('MERCHANT LAYOUT CONTRACT — 6. Elimination of Redundant In-Page Menu & Stok Switcher', () => {
  // Redundant switcher must not exist in index.html
  assert.ok(!HTML.includes('class="bm-menu-stok-switcher"'), 'bm-menu-stok-switcher must be eliminated from index.html');
});

test('MERCHANT LAYOUT CONTRACT — 7. Dynamic Brand Logo Sync & Canonical Fallback', () => {
  // Fallback logo in index.html must point to official branding
  assert.ok(HTML.includes('/assets/upload-aset/branding/Logo app mybangjo.png'),
    'index.html must point to official branding logo fallback');

  // merchant-app.js must implement dynamic brand logo sync
  assert.ok(JS.includes('function fetchAndApplyBrandLogo()'),
    'merchant-app.js must implement fetchAndApplyBrandLogo()');
  assert.ok(JS.includes('/api/v1/brand/info'),
    'fetchAndApplyBrandLogo must query /api/v1/brand/info');
});

test('MERCHANT LAYOUT CONTRACT — 8. Anti-Double-Clearance & Last-Child Margin Leaks Governance', () => {
  // 1. When navbar is hidden on subviews (bm-menu-categories-view or is-bm-menu-subview), tab ::after MUST be suppressed (display: none !important)
  assert.ok(
    /is-bm-menu-subview\s+\.x-tab-content\.active::after[^{]*\{[^}]*display:\s*none\s*!important/i.test(HOME_CSS),
    'is-bm-menu-subview must suppress .x-tab-content.active::after with display:none !important'
  );

  // 2. Beranda screen (.x-home-screen) must NOT have bottom padding
  assert.ok(
    /\.x-merchant-app\s+#tab-hari-ini\s+\.x-home-screen[^{]*\{[^}]*padding-bottom:\s*0\s*!important/i.test(HOME_CSS),
    '.x-home-screen must enforce padding-bottom: 0 !important'
  );

  // 3. Last section in Beranda must not leak bottom margin
  assert.ok(
    /\.x-merchant-app\s+#tab-hari-ini\s+\.x-home-section\[aria-labelledby="bm-home-promo-title"\][^{]*\{[^}]*margin-bottom:\s*0\s*!important/i.test(HOME_CSS),
    'Last section in Beranda must enforce margin-bottom: 0 !important'
  );

  // 4. Category cards must have margin-bottom: 0
  assert.ok(
    /\.x-menu-category-card\s*\{[^}]*margin-bottom:\s*0\s*!important/i.test(HOME_CSS),
    '.x-menu-category-card must enforce margin-bottom: 0 !important'
  );

  // 5. Category list padding-bottom must exactly account for dock height + 12px clearance
  assert.ok(
    /#bm-menu-categories-view\s+\.x-menu-category-list\s*\{[^}]*padding:\s*0\s+0\s+calc\(88px/i.test(HOME_CSS),
    'category list must use calc(88px) to match 76px dock + 12px clearance'
  );
});

test('MERCHANT LAYOUT CONTRACT — 9. Floating Bottom Action Dock Retention (Urutkan & Tambah, Staff, Edit Jam)', () => {
  // Ensure the floating action dock and green CTA buttons are NEVER stripped or reverted
  assert.ok(HTML.includes('id="bm-categories-bottom-dock"'), 'bm-categories-bottom-dock must exist in index.html');
  assert.ok(HTML.includes('id="btn-bm-categories-sort"'), 'btn-bm-categories-sort (Urutkan) must exist in index.html');
  assert.ok(HTML.includes('id="btn-bm-categories-add"'), 'btn-bm-categories-add (Tambah) must exist in index.html');
  assert.ok(HTML.includes('id="btn-bm-categories-save-order"'), 'btn-bm-categories-save-order (Simpan) must exist in index.html');
  assert.ok(HTML.includes('id="btn-bm-categories-cancel-sort"'), 'btn-bm-categories-cancel-sort (Batal) must exist in index.html');
  assert.ok(HTML.includes('id="bm-menu-category-sort-banner"'), 'bm-menu-category-sort-banner must exist in index.html');

  // Staff floating bottom action dock
  assert.ok(HTML.includes('id="bm-staff-bottom-dock"'), 'bm-staff-bottom-dock must exist in index.html');
  assert.ok(HTML.includes('id="btn-bm-staff-add-cta"'), 'btn-bm-staff-add-cta must exist in index.html');

  // Edit Jam Operasional floating bottom action dock
  assert.ok(HTML.includes('id="bm-edit-jam-bottom-dock"'), 'bm-edit-jam-bottom-dock must exist in index.html');
  assert.ok(HTML.includes('id="btn-bm-save-jam"'), 'btn-bm-save-jam must exist in index.html');
});

test('MERCHANT LAYOUT CONTRACT — 10. Menu & Stok Hub Structure & Retention', () => {
  // Ensure Menu & Stok hub contains both Kategori & Menu and Stok Porsi & Bahan Dapur
  assert.ok(HTML.includes('id="bm-menu-home-view"'), 'bm-menu-home-view must exist in index.html');
  assert.ok(HTML.includes('Menu &amp; Stok') || HTML.includes('Menu & Stok'), 'bm-menu-home-view must have Menu & Stok title');
  assert.ok(HTML.includes('id="btn-bm-menu-open-categories"'), 'btn-bm-menu-open-categories must exist in index.html');
  assert.ok(HTML.includes('Kategori dan menu'), 'Kategori dan menu row must exist in index.html');
  assert.ok(HTML.includes('id="btn-bm-menu-open-stock"'), 'btn-bm-menu-open-stock must exist in index.html');
  assert.ok(HTML.includes('Stok Porsi &amp; Bahan Dapur') || HTML.includes('Stok Porsi & Bahan Dapur'), 'Stok Porsi & Bahan Dapur must exist in index.html');
  assert.ok(HTML.includes('onclick="navigateTo(\'stok\')"'), 'Stok row must navigate to stok');
  assert.ok(HTML.includes('id="btn-bm-stock-hub-back"'), 'btn-bm-stock-hub-back must exist in index.html');
});

test('MERCHANT LAYOUT CONTRACT — 11. Pesanan Dedicated Topbar, Brand Logo & Stage Subfilters Retention', () => {
  // 1. Dedicated Pesanan topbar header with id and classes
  assert.ok(HTML.includes('id="bm-pesanan-topbar"'), 'bm-pesanan-topbar must exist in index.html');
  assert.ok(
    /class="[^"]*x-pesanan-topbar[^"]*has-subfilters[^"]*"/i.test(HTML),
    'Pesanan topbar must have x-pesanan-topbar and has-subfilters classes'
  );

  // 2. Official brand logo with onerror fallback
  assert.ok(
    HTML.includes('id="pesanan-branch-badge"'),
    'pesanan-branch-badge must exist in index.html'
  );
  assert.ok(
    HTML.includes('/assets/upload-aset/branding/Logo app mybangjo.png') &&
    HTML.includes('id="pesanan-branch-badge"'),
    'pesanan-branch-badge must use official branding logo'
  );

  // 3. 4 Status Tabs with has-subfilters class
  assert.ok(
    /class="[^"]*bm-pesanan-nav-tabs[^"]*has-subfilters[^"]*"/i.test(HTML),
    'bm-pesanan-nav-tabs must have has-subfilters class'
  );
  assert.ok(HTML.includes('data-tab-status="in_process"'), 'in_process tab button must exist');
  assert.ok(HTML.includes('data-tab-status="scheduled"'), 'scheduled tab button must exist');
  assert.ok(HTML.includes('data-tab-status="completed"'), 'completed tab button must exist');
  assert.ok(HTML.includes('data-tab-status="cancelled"'), 'cancelled tab button must exist');

  // 4. Row 4 Kitchen Stage Subfilter Bar with 4 stage buttons
  assert.ok(HTML.includes('id="bm-stage-subfilter-bar"'), 'bm-stage-subfilter-bar must exist in index.html');
  assert.ok(HTML.includes('data-stage-filter="all"'), 'Semua stage filter button must exist');
  assert.ok(HTML.includes('data-stage-filter="incoming"'), 'Masuk stage filter button must exist');
  assert.ok(HTML.includes('data-stage-filter="cooking"'), 'Dimasak stage filter button must exist');
  assert.ok(HTML.includes('data-stage-filter="ready"'), 'Siap stage filter button must exist');

  // 5. CSS ensures stage subfilter display toggle and button styles
  assert.ok(
    /\.stage-subfilter-bar/i.test(HOME_CSS),
    'home.css must define .stage-subfilter-bar'
  );
  assert.ok(
    /\.stage-subfilter-btn/i.test(HOME_CSS),
    'home.css must define .stage-subfilter-btn'
  );
});

test('MERCHANT LAYOUT CONTRACT — 12. Chat Messenger Retention & Operational Ops-Chat Wiring', () => {
  // 1. Chat buttons in both Beranda and Pesanan topbars
  assert.ok(HTML.includes('id="btn-chat"'), '#btn-chat must exist in Beranda topbar');
  assert.ok(HTML.includes('id="pesanan-btn-chat"'), '#pesanan-btn-chat must exist in Pesanan topbar');

  // 2. Both buttons hook into ops-chat engine via data-ops-chat-inbox="1" and have badges
  assert.ok(
    /<button[^>]*id="btn-chat"[^>]*data-ops-chat-inbox="1"/i.test(HTML) ||
    /id="btn-chat"[^>]*data-ops-chat-inbox="1"/.test(HTML),
    '#btn-chat must have data-ops-chat-inbox="1"'
  );
  assert.ok(
    /<button[^>]*id="pesanan-btn-chat"[^>]*data-ops-chat-inbox="1"/i.test(HTML) ||
    /id="pesanan-btn-chat"[^>]*data-ops-chat-inbox="1"/.test(HTML),
    '#pesanan-btn-chat must have data-ops-chat-inbox="1"'
  );
  assert.ok(HTML.includes('id="mobile-chat-badge"'), '#mobile-chat-badge must exist for unread counter');
  assert.ok(HTML.includes('id="pesanan-chat-badge"'), '#pesanan-chat-badge must exist for unread counter');

  // 3. Purchasing message button also wired to ops-chat
  assert.ok(HTML.includes('id="btn-purchasing-message"'), '#btn-purchasing-message must exist');
  assert.ok(
    /id="btn-purchasing-message"[^>]*data-ops-chat-inbox="1"/.test(HTML),
    '#btn-purchasing-message must have data-ops-chat-inbox="1"'
  );

  // 4. Order Detail card has contextual chat trigger
  assert.ok(HTML.includes('id="bm-detail-btn-chat"'), '#bm-detail-btn-chat must exist in Order Detail modal');

  // 5. ops-chat.js script is included and SW pre-cached
  assert.ok(
    /\/merchant-shared\/js\/ops-chat\.js\?v=2\./.test(HTML),
    'ops-chat.js must be imported in index.html'
  );
  const SW = fs.readFileSync(path.join(__dirname, '../apps/merchant-app/sw.js'), 'utf8');
  assert.ok(
    /\/merchant-shared\/js\/ops-chat\.js\?v=2\./.test(SW),
    'ops-chat.js must be cached in sw.js STATIC_ASSETS'
  );

  // 6. Navigation hiding rule when ops chat is active
  assert.ok(
    /body\.x-ops-chat-active\s+\.x-merchant-mobile-nav/.test(HOME_CSS),
    'home.css must suppress .x-merchant-mobile-nav when body.x-ops-chat-active'
  );
});
