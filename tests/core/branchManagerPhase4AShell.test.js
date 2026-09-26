'use strict';

/**
 * BM Phase 4A — Dashboard Shell & Context UX Reconciliation Test Suite
 *
 * Requirements Matrix (P4A-01 through P4A-12):
 * - P4A-01: Correct Portal label by role:
 *           Owner -> "Owner Portal"
 *           Brand Manager -> "Brand Portal"
 *           Branch Manager -> "Branch Portal"
 *           Cashier -> "Cashier Portal"
 * - P4A-02: Owner retains valid context selection (All Branches + all brand branches).
 * - P4A-03: Brand Manager retains authorized branch selection (scoped strictly to authorized brand_id).
 * - P4A-04: Branch Manager has NO branch dropdown (wrapper hidden, selector disabled).
 * - P4A-05: Branch Manager cannot switch branch (no switcher affordance, branch context locked to assigned branch_id).
 * - P4A-06: BM branch context remains server-authoritative (derived from authenticated session user.branch_id).
 * - P4A-07: Redundant BM topbar Brand badge is not presented (hidden in applyRoleBasedUI and applyBrandToUI).
 * - P4A-08: Search does not expose an unusable fake workflow (deceptive topbar search affordance hidden/disabled).
 * - P4A-09: Notification bell entry point (#btn-notifications) is present and accessible across viewports.
 * - P4A-10: Branch Manager sidebar navigation explicitly includes Menu (data-route="menu").
 * - P4A-11: Portal badge styling (.x-dash-badge-pro) maintains accessible contrast and avoids fluorescent lime on bright background.
 * - P4A-12: Responsive topbar CSS rules support locked branch badge on compact viewports without layout distortion.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('BM Phase 4A — Merchant Dashboard Shell & Context UX Reconciliation', () => {
  const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
  const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
  const cssPath = path.join(__dirname, '../../apps/merchant-shared/css/dashboard.css');

  const html = fs.readFileSync(htmlPath, 'utf8');
  // The Merchant App owns the Branch Manager surface; Owner/Platform stay in legacy.
  const legacyHtml = fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/index.html'), 'utf8');
  const legacyJs = fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');

  const js = fs.readFileSync(jsPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  it('P4A-01: Correct Portal label by role (Owner -> Owner Portal, Brand Manager -> Brand Portal, Branch Manager -> Branch Portal, Cashier -> Cashier Portal)', () => {
    assert.ok(legacyJs.includes("'Owner Portal'"), 'Missing Owner Portal label in legacy JS');
    assert.ok(legacyJs.includes("'Brand Portal'"), 'Missing Brand Portal label in legacy JS');
    assert.ok(legacyJs.includes("'Cashier Portal'"), 'Missing Cashier Portal label in legacy JS');
    // The Branch Manager portal label now lives in the Merchant App surface.
    assert.ok(js.includes("'Branch Portal'"), 'Missing Branch Portal label in Merchant App JS');

    assert.ok(legacyJs.includes('portalBadge.textContent ='), 'Missing portalBadge textContent assignment in applyRoleBasedUI');
    assert.ok(js.includes('portalBadge.textContent ='), 'Missing portalBadge textContent assignment in Merchant App');
  });

  it('P4A-02: Owner retains valid context selection (All Branches and all loaded branches)', () => {
    // For Owner: branchSelectorWrap is flex, bmBranchBadge is none, branchSelector is enabled
    assert.ok(legacyJs.includes("if (branchSelectorWrap) branchSelectorWrap.style.display = 'flex'"), 'Missing branchSelectorWrap display flex for owner');
    assert.ok(legacyJs.includes("if (bmBranchBadge) bmBranchBadge.style.display = 'none'"), 'Missing bmBranchBadge hide for owner');
    assert.ok(legacyJs.includes("branchSelector.disabled = false"), 'branchSelector must be enabled for owner');
    assert.ok(legacyJs.includes("sel.innerHTML = '<option value=\"all\">All Branches</option>'"), 'All Branches option must be available for owner');
  });

  it('P4A-03: Brand Manager retains authorized branch selection scoped strictly to authorized Brand', () => {
    assert.ok(legacyJs.includes("user.role === 'brand_manager' && user.brand_id"), 'Missing brand_manager scoping in populateBranchSelector');
    assert.ok(legacyJs.includes("String(b.brand_id) === String(user.brand_id)"), 'Missing brand_id comparison in populateBranchSelector');
    // Topbar brand badge is preserved for Brand Manager
    assert.ok(legacyJs.includes("topbarBrandBadge.style.display = isBM ? 'none' : 'flex'"), 'Missing topbarBrandBadge display for brand manager');
  });

  it('P4A-04: Branch Manager has NO branch dropdown', () => {
    // The Merchant App does not render a branch dropdown at all for BM.
    assert.ok(!html.includes('id="x-branch-selector"'), 'Merchant App must not render the owner branch selector');
    assert.ok(!html.includes('id="dash-branch-context"'), 'Merchant App must not render the branch context select');
    assert.ok(js.includes("branchSelectorWrap.style.display = 'none'"), 'Merchant App must defensively hide any branch selector');
  });

  it('P4A-05: Branch Manager cannot switch branch (locked to assigned branch_id, no switcher affordance)', () => {
    assert.ok(js.includes("Catalog.state.branchId = user.branch_id"), 'shared branch id must lock to user.branch_id');
    assert.ok(js.includes("if (bmBranchBadge) bmBranchBadge.style.display = 'flex'"), 'bmBranchBadge must be shown as passive indicator');
  });

  it('P4A-06: BM branch context remains server-authoritative (derived from authenticated session user.branch_id)', () => {
    assert.ok(js.includes("var user = getStoredUser();"), 'Must derive context from getStoredUser()');
    assert.ok(js.includes("user.branch_id"), 'Must derive branch context from the authenticated session');
  });

  it('P4A-07: Redundant BM topbar Brand badge is not presented', () => {
    // Hidden in applyRoleBasedUI
    assert.ok(js.includes("topbarBrandBadge.style.display = 'none'"), 'Merchant App must hide the topbar brand badge');
    // Protected against revival in applyBrandToUI (legacy Owner shell)
    assert.ok(legacyJs.includes("user.role === 'branch_manager' && $('topbar-brand-badge')"), 'legacy applyBrandToUI must keep topbar brand badge hidden for BM');
  });

  it('P4A-08: Search does not expose an unusable fake workflow (deceptive search icon hidden)', () => {
    assert.ok(html.includes('id="btn-global-search" style="display: none;"'), 'btn-global-search must be styled display: none in HTML');
    assert.ok(js.includes("searchBtn.style.display = 'none'"), 'applyRoleBasedUI must defensively enforce searchBtn hide');
  });

  it('P4A-09: Notification bell entry point is present in HTML and accessible across viewports', () => {
    assert.ok(html.includes('id="btn-notifications"'), 'Missing btn-notifications in index.html');
    assert.ok(html.includes('aria-label="Notifikasi"'), 'Missing aria-label for notifications');
    assert.ok(css.includes('#btn-notifications.x-topbar-icon-btn'), 'Missing responsive styling for btn-notifications');
  });

  it('P4A-10: Branch Manager navigation explicitly includes Menu (data-route="menu")', () => {
    assert.ok(js.includes('data-route=\\"menu\\"'), 'Missing data-route="menu" in renderBranchManagerNavigation');
    assert.ok(js.includes('<span>Menu</span>'), 'Missing Menu text in renderBranchManagerNavigation');
  });

  it('P4A-11: CSS .x-dash-badge-pro provides accessible contrast', () => {
    assert.ok(css.includes('.x-dash-badge-pro {'), 'Missing .x-dash-badge-pro selector in CSS');
    assert.ok(css.includes('color: #f1f5f9;') || css.includes('color: #ffffff;'), 'Missing high-contrast text color for portal badge');
  });

  it('P4A-12: CSS supports responsive branch context badge on mobile viewports', () => {
    assert.ok(css.includes('.x-branch-context-badge {'), 'Missing .x-branch-context-badge selector in CSS');
    assert.ok(css.includes('@media (max-width: 1023px)'), 'Missing 1023px media query');
    const mobileIndex = css.indexOf('@media (max-width: 1023px)');
    const mobileCss = css.slice(mobileIndex, mobileIndex + 9000);
    assert.ok(mobileCss.includes('.x-branch-context-badge'), 'Missing responsive styling for x-branch-context-badge in mobile query');
  });

  it('P4A-13: Cache busting asset versions are present for dashboard.css and dashboard.js', () => {
    assert.ok(/href="\/merchant-shared\/css\/dashboard\.css\?v=1\.0\.\d+"/.test(html), 'shared stylesheet must carry a version query');
    assert.ok(/src="\/merchant-app\/assets\/js\/merchant-app\.js\?v=1\.0\.\d+"/.test(html), 'merchant-app.js must carry a version query');
    assert.ok(/src="\/dashboard\/assets\/js\/dashboard\.js\?v=3\.0\.\d+"/.test(legacyHtml), 'legacy dashboard.js must keep its version query');
  });
});

