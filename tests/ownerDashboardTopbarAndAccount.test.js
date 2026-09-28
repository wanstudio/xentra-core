'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const CSS_PATH = path.join(__dirname, '../apps/merchant-shared/css/dashboard.css');
const JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const js = fs.readFileSync(JS_PATH, 'utf8');

test('Owner Dashboard Topbar, Mobile Account & Scroll Unblock', async (t) => {

  // --------------------------------------------------------------------------
  // 1. Scroll Unblock Verification
  // --------------------------------------------------------------------------

  await t.test('OTA-01: html is not globally position:fixed or overflow:hidden on mobile', () => {
    // The previous bug had "html,\n  body.x-merchant-app" which froze html for all apps.
    // It must now be scoped strictly to html.x-merchant-app.
    assert.ok(!css.match(/@media\s*\(max-width:\s*768px\)\s*\{\s*html\s*,\s*body\.x-merchant-app/),
      'CSS must not freeze generic html with position:fixed on mobile');
    assert.ok(css.includes('html.x-merchant-app'),
      'CSS viewport lock must be scoped to html.x-merchant-app');
  });

  await t.test('OTA-01b: topbar stays fixed on top on mobile with generous padding', () => {
    assert.ok(!css.match(/@media\s*\(max-width:\s*768px\)\s*\{\s*\/\*[^\*]*\*\/\s*\.x-dash-topbar\s*,\s*\.x-merchant-app/),
      'Generic .x-dash-topbar must not be grouped into relative position rule');
    const afterOwnerNav = css.indexOf('OWNER DASHBOARD — Mobile Bottom Navigation');
    assert.ok(afterOwnerNav !== -1, 'Owner nav section header must exist in CSS');
    const ownerCssSection = css.substring(afterOwnerNav);
    assert.ok(ownerCssSection.includes('.x-dash-topbar') &&
              ownerCssSection.includes('position: fixed') &&
              ownerCssSection.includes('top: 0'),
      'Owner mobile section must ensure .x-dash-topbar has position: fixed and top: 0');
    assert.ok(ownerCssSection.includes('padding-top: max(') || ownerCssSection.includes('padding-top: 68px') || ownerCssSection.includes('padding-top: 64px'),
      'Owner mobile section must provide generous top spacer for fixed topbar');
  });

  // --------------------------------------------------------------------------
  // 2. Prominent Branch Context Selector in Topbar
  // --------------------------------------------------------------------------

  await t.test('OTA-02: Topbar branch selector includes pin icon and dropdown chevron', () => {
    assert.ok(html.includes('id="x-branch-selector"'),
      '#x-branch-selector must exist');
    assert.ok(html.includes('class="x-branch-pin-icon"'),
      '.x-branch-pin-icon must exist for prominent visual anchoring');
    assert.ok(html.includes('id="dash-branch-context"'),
      '#dash-branch-context select must exist inside branch selector');
    assert.ok(html.includes('class="x-branch-chevron-icon"'),
      '.x-branch-chevron-icon must exist to indicate dropdown capability');
  });

  await t.test('OTA-03: CSS styles branch selector with clean dark gray accent stroke and rounded pill', () => {
    assert.ok(css.includes('.x-branch-selector'),
      '.x-branch-selector must be defined');
    assert.ok(css.includes('.x-branch-pin-icon'),
      '.x-branch-pin-icon must be defined');
    assert.ok(css.includes('.x-branch-chevron-icon'),
      '.x-branch-chevron-icon must be defined');
    assert.ok(css.includes('border: 1.5px solid #475569'),
      'Branch selector must use clean dark gray accent border');
  });

  await t.test('OTA-03b: Topbar features twin circular stroke buttons for notifications and profile', () => {
    assert.ok(html.includes('class="x-topbar-user-icon"'),
      'Topbar user avatar must contain SVG icon matching stroke styling');
    assert.ok(css.includes('.x-avatar-stroke-round') && css.includes('.x-topbar-icon-btn-round'),
      'CSS must style twin circular stroke buttons for avatar and notification');
  });

  await t.test('OTA-03c: GoBiz-style chevron icon links are used instead of plain ASCII text', () => {
    assert.ok(html.includes('class="x-occ-link-chevron"'),
      'OCC card links must include chevron SVG icon element');
    assert.ok(css.includes('.x-occ-link-chevron'),
      'CSS must define .x-occ-link-chevron styles');
  });

  // --------------------------------------------------------------------------
  // 3. Mobile Account Page (GoBiz / Xentra Style)
  // --------------------------------------------------------------------------

  await t.test('OTA-04: Mobile account page container and header exist in index.html', () => {
    assert.ok(html.includes('id="x-mobile-account-page"'),
      '#x-mobile-account-page must exist');
    assert.ok(html.includes('id="btn-mobile-account-back"'),
      '#btn-mobile-account-back back button must exist');
    assert.ok(html.includes('<h1>Akun</h1>'),
      'Account header title "Akun" must exist');
  });

  await t.test('OTA-05: Mobile account profile card displays user info', () => {
    assert.ok(html.includes('id="mobile-account-profile-card"'),
      '#mobile-account-profile-card must exist');
    assert.ok(html.includes('id="mobile-account-name"'),
      '#mobile-account-name must exist for display name');
    assert.ok(html.includes('id="mobile-account-role"'),
      '#mobile-account-role must exist for role badge');
    assert.ok(html.includes('id="mobile-account-email"'),
      '#mobile-account-email must exist for email');
    assert.ok(html.includes('id="mobile-account-brand"'),
      '#mobile-account-brand must exist for brand name');
  });

  await t.test('OTA-06: Active mobile logout button exists with clear label "Keluar"', () => {
    assert.ok(html.includes('id="btn-mobile-account-logout"'),
      '#btn-mobile-account-logout must exist');
    assert.ok(html.includes('>Keluar</button>'),
      'Logout button text must be "Keluar"');
  });

  await t.test('OTA-07: Tab-more (Lainnya) includes shortcut to open mobile account', () => {
    const tabMoreSection = html.substring(
      html.indexOf('id="tab-more"'),
      html.indexOf('</section>', html.indexOf('id="tab-more"'))
    );
    assert.ok(tabMoreSection.includes('openMobileAccount()'),
      'tab-more must have an entry point that calls openMobileAccount()');
  });

  // --------------------------------------------------------------------------
  // 4. CSS Rules for Account Screen & Active State
  // --------------------------------------------------------------------------

  await t.test('OTA-08: CSS hides both layout and owner bottom nav when account page is open', () => {
    assert.ok(css.includes('body.x-mobile-account-open .x-owner-bottom-nav'),
      'body.x-mobile-account-open must hide .x-owner-bottom-nav');
    assert.ok(css.includes('body.x-mobile-account-open .x-dash-layout'),
      'body.x-mobile-account-open must hide .x-dash-layout');
  });

  // --------------------------------------------------------------------------
  // 5. JavaScript Wiring
  // --------------------------------------------------------------------------

  await t.test('OTA-09: dashboard.js defines openMobileAccount, closeMobileAccount, and handleLogout', () => {
    assert.ok(js.includes('function openMobileAccount()'),
      'openMobileAccount must be defined in dashboard.js');
    assert.ok(js.includes('function closeMobileAccount()'),
      'closeMobileAccount must be defined in dashboard.js');
    assert.ok(js.includes('function handleLogout()'),
      'handleLogout must be defined in dashboard.js');
  });

  await t.test('OTA-10: initAuthListeners wires both desktop and mobile logout buttons', () => {
    assert.ok(js.includes('btnMobileLogout.addEventListener(\'click\', handleLogout);'),
      'btn-mobile-account-logout must be wired to handleLogout');
    assert.ok(js.includes('btnLogout.addEventListener(\'click\', handleLogout);'),
      'btn-logout must be wired to handleLogout');
    assert.ok(js.includes('profileBtn.addEventListener(\'click\','),
      'dash-user-profile click must open mobile account');
  });

});
